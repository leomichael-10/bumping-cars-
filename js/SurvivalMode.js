/* ============================================================================
   SURVIVAL MODE
   A self-contained round state machine layered on top of the simulation.
   GameManager composes one instance and calls start()/update()/draw()/abort();
   nothing else reaches into it, and it never reaches into Car internals --
   it only ever calls public Car getters (position, velocity, damage,
   recentlyHit) and the public Behaviour/CollisionManager surface.

   If this file were deleted, GameManager would simply stop offering the "h"
   round (a one-line no-op guard is all that's needed there) and every other
   system -- physics, modes, animations, the three extensions -- would run
   completely unaffected. That's deliberate: Survival Mode reads state and
   swaps one behaviour, it does not introduce any new physics or mutate
   bodies itself.
   ============================================================================ */
class SurvivalMode {
  static #STATE = Object.freeze({
    IDLE: "IDLE",
    ACTIVE: "ACTIVE",
    WON: "WON",
    LOST_DAMAGE: "LOST_DAMAGE",
    LOST_CAUGHT: "LOST_CAUGHT"
  });

  #getPlayer;
  #getOpponents;
  #getWorld;
  #collisionManager;
  #restoreBehaviorFn;

  #state = SurvivalMode.#STATE.IDLE;
  #elapsedMs = 0;
  #hunters = [];
  #contactDurationMs = new Map(); // hunterCar -> ms of continuous contact with the player
  #pendingCatchHunter = null;     // set by the contact listener, resolved in update()
  #secondHunterAnnounced = false;
  #secondHunterBannerFrames = 0;
  #spawnReminderFrames = 0;

  constructor({ getPlayer, getOpponents, getWorld, collisionManager, restoreBehaviorFn }) {
    this.#getPlayer = getPlayer;
    this.#getOpponents = getOpponents;
    this.#getWorld = getWorld;
    this.#collisionManager = collisionManager;
    this.#restoreBehaviorFn = restoreBehaviorFn;

    // Registered once, for the lifetime of the app -- CollisionManager stays
    // the only class that ever calls Matter.Events.on for collisions.
    this.#collisionManager.onContactEvent((event) => this.#onContactEvent(event));
  }

  getState() { return this.#state; }
  isActive() { return this.#state === SurvivalMode.#STATE.ACTIVE; }
  isInputFrozen() {
    return this.#state === SurvivalMode.#STATE.WON ||
      this.#state === SurvivalMode.#STATE.LOST_DAMAGE ||
      this.#state === SurvivalMode.#STATE.LOST_CAUGHT;
  }
  getHunters() { return [...this.#hunters]; }
  get remainingMs() { return Math.max(0, SURVIVAL_CONFIG.durationMs - this.#elapsedMs); }
  get elapsedMs() { return this.#elapsedMs; }

  // ---- Round lifecycle -------------------------------------------------------
  start() {
    if (this.#state === SurvivalMode.#STATE.ACTIVE) return false; // no re-arming mid-round

    const player = this.#getPlayer();
    if (!player) {
      this.#spawnReminderFrames = 90;
      return false;
    }

    const nearest = this.#findNearestStandardOpponent(player, []);
    if (!nearest) return false; // no eligible opponent to hunt with

    this.#state = SurvivalMode.#STATE.ACTIVE;
    this.#elapsedMs = 0;
    this.#hunters = [];
    this.#contactDurationMs.clear();
    this.#pendingCatchHunter = null;
    this.#secondHunterAnnounced = false;
    this.#secondHunterBannerFrames = 0;

    this.#assignHunter(nearest);
    return true;
  }

  // Called when the mode (1/2/3) changes mid-round -- reverts any hunter to
  // a harmless static/no-op state (GameManager rebuilds opponents right
  // after this anyway) and resets to IDLE with no result screen.
  abort() {
    if (this.#state === SurvivalMode.#STATE.ACTIVE) this.#revertHunters();
    this.#state = SurvivalMode.#STATE.IDLE;
    this.#elapsedMs = 0;
    this.#hunters = [];
    this.#contactDurationMs.clear();
    this.#pendingCatchHunter = null;
    this.#secondHunterAnnounced = false;
    this.#secondHunterBannerFrames = 0;
    this.#spawnReminderFrames = 0;
  }

  // "r" key after a round has ended -- clears the result screen so "h" can
  // start a fresh round. Deliberately does NOT touch damage/skid marks/car
  // state; those are consequences of the simulation, not of the round UI.
  reset() {
    if (this.#state === SurvivalMode.#STATE.ACTIVE || this.#state === SurvivalMode.#STATE.IDLE) return;
    this.abort();
  }

  #findNearestStandardOpponent(player, exclude) {
    let best = null;
    let bestDist = Infinity;
    for (const car of this.#getOpponents()) {
      if (!(car instanceof OpponentCar) || car.type !== "standard" || exclude.includes(car)) continue;
      const d = dist(player.position.x, player.position.y, car.position.x, car.position.y);
      if (d < bestDist) { bestDist = d; best = car; }
    }
    return best;
  }

  #assignHunter(car) {
    car.setBehavior(new PursuitBehaviour(
      car.spec.maxForwardSpeed * SURVIVAL_CONFIG.escalation.stalking.speedFactor,
      () => this.#getPlayer(),
      () => this.#getOpponents().filter(c => c instanceof OpponentCar),
      () => this.#getWorld(),
      new RaycastSensor()
    ));
    this.#hunters.push(car);
    this.#applyEscalationProfile(car, 0);
  }

  #revertHunters() {
    for (const hunter of this.#hunters) {
      hunter.setBehavior(this.#restoreBehaviorFn(hunter));
    }
    this.#hunters = [];
    this.#contactDurationMs.clear();
  }

  // ---- Per-frame update --------------------------------------------------------
  update(dtMs) {
    if (this.#spawnReminderFrames > 0) this.#spawnReminderFrames--;
    if (this.#secondHunterBannerFrames > 0) this.#secondHunterBannerFrames--;

    if (this.#state !== SurvivalMode.#STATE.ACTIVE) return;

    // A catch flagged by the contact listener is resolved here, not inside
    // the collision event itself -- state transitions are cheap, but this
    // keeps the rule simple and uniform: nothing acts on a collision event
    // synchronously except reading data out of it.
    if (this.#pendingCatchHunter) {
      this.#endRound(SurvivalMode.#STATE.LOST_CAUGHT);
      return;
    }

    const player = this.#getPlayer();
    if (!player || player.damage >= 1) {
      this.#endRound(SurvivalMode.#STATE.LOST_DAMAGE);
      return;
    }

    this.#elapsedMs += dtMs;

    const t = constrain(this.#elapsedMs / SURVIVAL_CONFIG.durationMs, 0, 1);
    for (const hunter of this.#hunters) this.#applyEscalationProfile(hunter, t);

    if (!this.#secondHunterAnnounced && this.#elapsedMs >= SURVIVAL_CONFIG.secondHunterTimeMs && this.#hunters.length < 2) {
      this.#secondHunterAnnounced = true;
      const candidate = this.#findNearestStandardOpponent(player, this.#hunters);
      if (candidate) {
        this.#assignHunter(candidate);
        this.#applyEscalationProfile(candidate, t);
        this.#secondHunterBannerFrames = 150; // ~2.5s banner at 60fps
      }
    }

    if (this.#elapsedMs >= SURVIVAL_CONFIG.durationMs) {
      this.#endRound(SurvivalMode.#STATE.WON);
    }
  }

  #applyEscalationProfile(hunterCar, t) {
    const { stalking, aggressive } = SURVIVAL_CONFIG.escalation;
    const lerp = (a, b) => a + (b - a) * t;

    hunterCar.behavior.setProfile({
      speed: hunterCar.spec.maxForwardSpeed * lerp(stalking.speedFactor, aggressive.speedFactor),
      maxTurnRate: lerp(stalking.maxTurnRate, aggressive.maxTurnRate),
      leadFrames: Math.round(lerp(stalking.leadFrames, aggressive.leadFrames)),
      weights: {
        pursue: lerp(stalking.weights.pursue, aggressive.weights.pursue),
        avoid: lerp(stalking.weights.avoid, aggressive.weights.avoid),
        separate: lerp(stalking.weights.separate, aggressive.weights.separate)
      }
    });
  }

  #endRound(state) {
    this.#state = state;
    this.#pendingCatchHunter = null;
    this.#revertHunters();
  }

  // ---- Contact feed from CollisionManager (Extension 3 exemption + catch) ----
  // Also where the Hunter's exemption from the +-90 car-car heading policy
  // is decided -- CollisionManager calls this predicate synchronously during
  // its own event handling, so it must stay a pure read, no mutation.
  isHeadingPolicyExempt(car, otherCar) {
    return this.#state === SurvivalMode.#STATE.ACTIVE &&
      this.#hunters.includes(car) &&
      otherCar === this.#getPlayer();
  }

  #onContactEvent({ type, carA, carB, impulse }) {
    if (this.#state !== SurvivalMode.#STATE.ACTIVE) return;

    const player = this.#getPlayer();
    const hunter = carA === player ? carB : (carB === player ? carA : null);
    if (!hunter || !this.#hunters.includes(hunter)) return;

    if (type === "start") {
      this.#contactDurationMs.set(hunter, 0);
      if (impulse >= SURVIVAL_CONFIG.catchImpulseThreshold) this.#pendingCatchHunter = hunter;
    } else if (type === "active") {
      const nextMs = (this.#contactDurationMs.get(hunter) || 0) + (1000 / 60);
      this.#contactDurationMs.set(hunter, nextMs);
      if (nextMs >= SURVIVAL_CONFIG.catchContactMs) this.#pendingCatchHunter = hunter;
    } else if (type === "end") {
      this.#contactDurationMs.set(hunter, 0);
    }
  }

  // Grapple-meter progress (0-1) against the most-advanced current contact,
  // used both for the reticle pulse rate and the radial catch-progress fill.
  #grappleProgress() {
    let maxMs = 0;
    for (const ms of this.#contactDurationMs.values()) maxMs = Math.max(maxMs, ms);
    return constrain(maxMs / SURVIVAL_CONFIG.catchContactMs, 0, 1);
  }

  // ---- Rendering ----------------------------------------------------------------
  draw() {
    if (this.#state === SurvivalMode.#STATE.ACTIVE) {
      this.#drawThreatVignette();
      this.#drawHunterTells();
      this.#drawTimer();
    }
    if (this.#secondHunterBannerFrames > 0) this.#drawSecondHunterBanner();
    if (this.#spawnReminderFrames > 0) this.#drawSpawnReminder();
    if (this.isInputFrozen()) this.#drawResultScreen();
  }

  #nearestHunterDistance(player) {
    let best = Infinity;
    for (const hunter of this.#hunters) {
      best = Math.min(best, dist(player.position.x, player.position.y, hunter.position.x, hunter.position.y));
    }
    return best;
  }

  // Edge-glow vignette whose intensity scales with inverse distance to the
  // nearest hunter -- built the same way Arena's own vignette is (concentric
  // stroked rects), just red instead of the arena's ambient shading.
  #drawThreatVignette() {
    const player = this.#getPlayer();
    if (!player || this.#hunters.length === 0) return;

    const d = this.#nearestHunterDistance(player);
    const closeness = 1 - constrain(d / SURVIVAL_CONFIG.vignetteMaxDistance, 0, 1);
    if (closeness <= 0) return;

    push();
    noFill();
    const rings = 8;
    for (let i = 0; i < rings; i++) {
      const inset = i * 5;
      stroke(220, 30, 30, closeness * closeness * 10);
      strokeWeight(6);
      rect(inset, inset, CANVAS_W - inset * 2, CANVAS_H - inset * 2);
    }
    pop();
  }

  #drawHunterTells() {
    const player = this.#getPlayer();
    const grapple = this.#grappleProgress();

    push();
    for (const hunter of this.#hunters) {
      const pulse = 4 + Math.sin(frameCount * 0.15) * 3;
      noFill();
      stroke(255, 60, 40, 200);
      strokeWeight(2.5);
      circle(hunter.position.x, hunter.position.y, 44 + pulse);
    }
    pop();

    if (!player) return;

    // Reticle pulse speeds up from reticlePulseMinHz to reticlePulseMaxHz as
    // the grapple meter fills -- it visually communicates "break away now".
    const hz = SURVIVAL_CONFIG.reticlePulseMinHz + (SURVIVAL_CONFIG.reticlePulseMaxHz - SURVIVAL_CONFIG.reticlePulseMinHz) * grapple;
    const pulsePhase = (frameCount / 60) * hz * TWO_PI;
    const reticleR = 26 + Math.sin(pulsePhase) * 4;

    push();
    const p = player.position;
    stroke(255, 60, 40, 180);
    strokeWeight(1.5);
    noFill();
    circle(p.x, p.y, reticleR);
    line(p.x - 18, p.y, p.x - 8, p.y);
    line(p.x + 8, p.y, p.x + 18, p.y);
    line(p.x, p.y - 18, p.x, p.y - 8);
    line(p.x, p.y + 8, p.x, p.y + 18);

    // Explicit catch-progress radial fill while any hunter is in contact --
    // the player must BREAK AWAY, not just tolerate the touch.
    if (grapple > 0) {
      noFill();
      stroke(255, 200, 60, 220);
      strokeWeight(3);
      arc(p.x, p.y, 40, 40, -HALF_PI, -HALF_PI + grapple * TWO_PI);
    }
    pop();
  }

  #drawTimer() {
    const seconds = this.remainingMs / 1000;
    const urgent = seconds < 10;
    const pulse = urgent ? 1 + Math.sin(frameCount * 0.3) * 0.15 : 1;

    push();
    textAlign(CENTER, TOP);
    textSize(28 * pulse);
    fill(urgent ? color(230, 60, 50) : color(255, 240, 200));
    text(seconds.toFixed(1) + "s", CANVAS_W / 2, 10);
    pop();
  }

  #drawSecondHunterBanner() {
    push();
    textAlign(CENTER, TOP);
    fill(255, 90, 60, constrain(this.#secondHunterBannerFrames * 4, 0, 255));
    textSize(20);
    text("SECOND HUNTER JOINING", CANVAS_W / 2, 46);
    pop();
  }

  #drawSpawnReminder() {
    push();
    textAlign(CENTER, TOP);
    fill(255, 230, 90, constrain(this.#spawnReminderFrames * 6, 0, 255));
    textSize(16);
    text("Spawn your car first", CANVAS_W / 2, 46);
    pop();
  }

  // Deliberately does NOT clear skid marks or dented hulls -- the wrecked
  // car sitting in its own skid-mark history is the intended payoff of the
  // three technical systems, not something to hide behind a menu.
  #drawResultScreen() {
    push();
    noStroke();
    fill(0, 0, 0, 140);
    rect(0, 0, CANVAS_W, CANVAS_H);

    const labels = {
      WON: "SURVIVED",
      LOST_DAMAGE: "DESTROYED",
      LOST_CAUGHT: "CAUGHT"
    };
    const colours = {
      WON: color(120, 230, 140),
      LOST_DAMAGE: color(230, 90, 60),
      LOST_CAUGHT: color(230, 60, 200)
    };

    textAlign(CENTER, CENTER);
    fill(colours[this.#state]);
    textSize(48);
    text(labels[this.#state], CANVAS_W / 2, CANVAS_H / 2 - 20);

    fill(230);
    textSize(18);
    text("Time survived: " + (this.#elapsedMs / 1000).toFixed(1) + "s", CANVAS_W / 2, CANVAS_H / 2 + 24);
    textSize(14);
    fill(200);
    text("Press R to reset   1 / 2 / 3 to change mode", CANVAS_W / 2, CANVAS_H / 2 + 52);
    pop();
  }
}
