/* ============================================================================
   GAME MANAGER
   Owns world state (engine, arena, cars, animations, skid layer) and
   orchestrates mode switching, spawn arming/placement, and Survival Mode.
   This is the only class sketch.js talks to directly.
   ============================================================================ */
class GameManager {
  #engine;
  #world;
  #arena;
  #animationManager;
  #collisionManager;
  #carFactory;
  #skidLayer;
  #survivalMode;

  #cars = [];
  #player = null;
  #mode = MODE.PRACTICE;
  #activeProfile = PHYSICS_PROFILES.standard;
  #spawnArmed = false;
  #debugRays = false;
  #spawnRejectTimer = 0;
  #screenShakeMagnitude = 0;

  init() {
    this.#engine = Engine.create();
    this.#world = this.#engine.world;
    this.#world.gravity.y = 0; // top-down arena -- no gravity

    this.#arena = new Arena();
    this.#animationManager = new AnimationManager();
    this.#collisionManager = new CollisionManager(this.#engine, this.#animationManager);
    this.#carFactory = new CarFactory(this.#world);
    this.#skidLayer = new SkidLayer(); // created once; reused across mode switches

    this.#survivalMode = new SurvivalMode({
      getPlayer: () => this.#player,
      getOpponents: () => this.#cars,
      getWorld: () => this.#world,
      collisionManager: this.#collisionManager,
      restoreBehaviorFn: (car) => this.#buildModeBehavior(car)
    });
    this.#collisionManager.setHeadingPolicyExemption(
      (car, otherCar) => this.#survivalMode.isHeadingPolicyExempt(car, otherCar)
    );

    this.setMode(MODE.PRACTICE);
  }

  setMode(mode) {
    this.#survivalMode?.abort(); // switching modes aborts any active round cleanly
    this.#teardown();
    this.#mode = mode;
    this.#activeProfile = mode === MODE.DEMOLITION ? PHYSICS_PROFILES.demolition : PHYSICS_PROFILES.standard;

    this.#engine.enableSleeping = this.#activeProfile.allowSleeping;
    this.#carFactory.setPhysicsProfile(this.#activeProfile);
    this.#collisionManager.setPhysicsProfile(this.#activeProfile);

    this.#arena.build(this.#world, this.#activeProfile);
    this.#cars = this.#carFactory.createOpponentSet(mode, this.#arena);
    this.#player = null;
    this.#spawnArmed = false;
    this.#skidLayer.clear();
    this.#screenShakeMagnitude = 0;

    if (DEBUG_PHYSICS) {
      for (const car of this.#cars) {
        const behaviorName = car instanceof OpponentCar ? car.behavior?.constructor?.name : "n/a (player not yet spawned)";
        console.log(`[mode ${mode}] ${car.type} behaviour=${behaviorName}`);
      }
    }
  }

  #teardown() {
    if (this.#world) {
      this.#arena?.teardown(this.#world);
      World.clear(this.#world, false);
      Engine.clear(this.#engine);
    }
    this.#cars = [];
    this.#animationManager?.clear();
  }

  armSpawn() {
    this.#spawnArmed = !this.#spawnArmed;
  }

  trySpawnPlayerAt(x, y) {
    if (!this.#spawnArmed) return;
    if (!this.#arena.isInsideArena(x, y) || !this.#arena.isInsideStartZone(x, y)) return;

    if (this.#carFactory.overlapsAny(x, y, this.#cars, PLAYER_SPAWN_SEPARATION)) {
      this.#spawnRejectTimer = 18; // visual rejection feedback
      return;
    }

    this.#player = this.#carFactory.createPlayer(x, y);
    this.#cars.push(this.#player);
    this.#spawnArmed = false;
  }

  // "h" -- starts a Survival round rather than a plain toggle. Rejected
  // silently (with an on-screen reminder) if there's no player yet, or
  // ignored outright if a round is already active (no re-arming mid-round).
  startSurvivalRound() {
    return this.#survivalMode.start();
  }

  // "r" -- only meaningful once a round has ended.
  resetSurvivalRound() {
    this.#survivalMode.reset();
  }

  toggleDebugRays() {
    this.#debugRays = !this.#debugRays;
  }

  // Shared by SurvivalMode (reverting a hunter after WON/LOST/abort) and
  // could equally be reused anywhere else a car needs to fall back to its
  // mode-appropriate default behaviour.
  #buildModeBehavior(car) {
    if (this.#mode === MODE.PRACTICE) return new StaticBehaviour();
    if (this.#mode === MODE.DEMOLITION) return new FreeBounceBehaviour();
    const cruiseSpeed = car.spec.maxForwardSpeed * OPPONENT_MOTION.cruiseSpeedFactor;
    return this.#mode === MODE.RANDOM
      ? new StraightBehaviour(cruiseSpeed)
      : new SineBehaviour(cruiseSpeed, car.heading);
  }

  handleInput() {
    if (!this.#player || this.#survivalMode.isInputFrozen()) return;

    this.#player.setReversing(false); // reset every frame; only DOWN sets it true below
    if (keyIsDown(UP_ARROW)) this.#player.applyThrottle(false);
    if (keyIsDown(DOWN_ARROW)) {
      this.#player.applyThrottle(true);
      this.#player.setReversing(true);
    }
    if (keyIsDown(LEFT_ARROW)) this.#player.steer(-1);
    if (keyIsDown(RIGHT_ARROW)) this.#player.steer(1);
  }

  update() {
    // Input/forces and the tyre-grip correction both need to happen BEFORE
    // matter.js integrates this step, so lateral slip is corrected on the
    // same velocity the engine is about to apply.
    this.handleInput();
    for (const car of this.#cars) car.applyTyreGrip();
    this.#stampSkidMarks();

    // Sub-stepping: Demolition halves the frame delta and steps twice
    // (engineSubsteps: 2) -- high restitution plus high speed is the classic
    // tunnelling case, and this is what stops a car crossing a whole wall in
    // one integration step. Standard's engineSubsteps: 1 makes this loop
    // identical to a single Engine.update() call, unchanged from before.
    const steps = this.#activeProfile.engineSubsteps;
    const subDt = (1000 / 60) / steps;
    for (let i = 0; i < steps; i++) Engine.update(this.#engine, subDt);

    this.#collisionManager.drainPendingKicks();
    this.#applyMaxSpeedClamp();
    this.#updateScreenShake();

    for (const car of this.#cars) car.update();
    this.#animationManager.update();
    this.#skidLayer.fade();
    this.#survivalMode.update(1000 / 60);
    if (this.#spawnRejectTimer > 0) this.#spawnRejectTimer--;
  }

  // Hard velocity ceiling (Demolition only -- standard's maxSpeed is
  // Infinity, so isFinite() skips this entirely, a no-op). This is what
  // stops repeated wall/elastic-kick bounces compounding into a runaway
  // energy gain, and doubles as tunnelling protection alongside sub-stepping.
  #applyMaxSpeedClamp() {
    const maxSpeed = this.#activeProfile.maxSpeed;
    if (!isFinite(maxSpeed)) return;
    for (const car of this.#cars) {
      const v = car.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        Body.setVelocity(car.body, { x: v.x * scale, y: v.y * scale });
      }
    }
  }

  // Decays every frame; spikes when this frame's summed collision intensity
  // (from CollisionManager) exceeds a threshold -- scales with the active
  // profile so a single hard hit in standard modes can still nudge it, but
  // Demolition's frequent violent collisions make it far more pronounced.
  #updateScreenShake() {
    this.#screenShakeMagnitude *= SCREEN_SHAKE_CONFIG.decay;
    const frameImpulse = this.#collisionManager.consumeFrameImpulse();
    if (frameImpulse > SCREEN_SHAKE_CONFIG.impulseThreshold) {
      const added = frameImpulse * SCREEN_SHAKE_CONFIG.gain * this.#activeProfile.screenShakeScale;
      this.#screenShakeMagnitude = Math.min(SCREEN_SHAKE_CONFIG.maxMagnitude, this.#screenShakeMagnitude + added);
    }
  }

  #stampSkidMarks() {
    for (const car of this.#cars) {
      if (!car.isSliding) continue;
      const alpha = SKID_CONFIG.markAlphaBase + car.slipRatio * SKID_CONFIG.markAlphaSlipScale;
      for (const wheel of car.getWheelWorldPositions()) {
        this.#skidLayer.stamp(wheel.x, wheel.y, car.heading, alpha);
      }
    }
  }

  draw() {
    background(18, 20, 24);

    const shakeX = this.#screenShakeMagnitude > 0.05 ? random(-this.#screenShakeMagnitude, this.#screenShakeMagnitude) : 0;
    const shakeY = this.#screenShakeMagnitude > 0.05 ? random(-this.#screenShakeMagnitude, this.#screenShakeMagnitude) : 0;

    push();
    translate(shakeX, shakeY);
    this.#arena.draw(this.#spawnRejectTimer);
    image(this.#skidLayer.graphics, 0, 0); // painted onto the floor, under the cars -- persists through result screens
    for (const car of this.#cars) car.draw();
    this.#animationManager.draw();
    this.#survivalMode.draw();
    if (this.#debugRays) this.#drawDebugRays();
    pop();
  }

  #drawDebugRays() {
    push();
    strokeWeight(1);
    for (const hunter of this.#survivalMode.getHunters()) {
      const behavior = hunter.behavior;
      if (!(behavior instanceof PursuitBehaviour)) continue;
      for (const ray of behavior.lastRays) {
        const hit = ray.distance < RAYCAST_CONFIG.range;
        stroke(hit ? color(255, 80, 60, 180) : color(80, 220, 120, 100));
        const endX = ray.start.x + Math.cos(ray.angle) * ray.distance;
        const endY = ray.start.y + Math.sin(ray.angle) * ray.distance;
        line(ray.start.x, ray.start.y, endX, endY);
      }
    }
    pop();
  }

  // ---- Read-only state for HUD ----------------------------------------------
  get mode() { return this.#mode; }
  get spawnArmed() { return this.#spawnArmed; }
  get player() { return this.#player; }
  get survivalState() { return this.#survivalMode.getState(); }
}
