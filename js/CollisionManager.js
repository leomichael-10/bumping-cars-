/* ============================================================================
   COLLISION MANAGER
   The single place matter.js collision events are subscribed to (collision-
   Start/Active/End). It routes each pair to the opponent heading policy,
   feeds DamageModel a contact point + impact strength via Car.registerImpact
   (barrier hits scaled softer than car-car hits), triggers the matching
   animation, and -- for car-car pairs only -- forwards a lightweight contact
   event to any registered listeners. SurvivalMode uses that feed to track
   hunter/player grapple duration without installing its own Events.on
   listener, so this remains the only collision-event registrar in the app.

   Impact strength is derived from APPROACH VELOCITY -- the closing speed
   along the collision normal, read at collisionStart before the solver
   responds -- not from a post-solve impulse. See DamageModel's commentary
   for why that distinction matters once restitution gets high.
   ============================================================================ */
class CollisionManager {
  #animationManager;
  #contactListeners = [];
  #headingPolicyExemption = () => false;
  #profile = PHYSICS_PROFILES.standard;
  #pendingKicks = [];
  #frameImpulseTotal = 0;

  constructor(engine, animationManager) {
    this.#animationManager = animationManager;
    Events.on(engine, "collisionStart", (event) => this.#handleCollisionStart(event));
    Events.on(engine, "collisionActive", (event) => this.#handleCollisionPhase(event, "active"));
    Events.on(engine, "collisionEnd", (event) => this.#handleCollisionPhase(event, "end"));
  }

  setPhysicsProfile(profile) {
    this.#profile = profile;
  }

  // SurvivalMode (or any future consumer) subscribes here instead of adding
  // its own matter.js listener. Callback receives { type, carA, carB, impulse }.
  onContactEvent(callback) {
    this.#contactListeners.push(callback);
  }

  // predicateFn(car, otherCar) => true means "skip the +-90 car-car heading
  // policy for `car` in this specific pairing" -- used by SurvivalMode to
  // exempt a grappling Hunter from being knocked off its target. The 180
  // degree barrier-reversal policy is never affected by this hook.
  setHeadingPolicyExemption(predicateFn) {
    this.#headingPolicyExemption = predicateFn;
  }

  // Applies queued elastic-kick nudges (Demolition only) -- called by
  // GameManager once per frame AFTER Engine.update() has fully resolved
  // that step's collisions, so the extra pop adds to a properly resolved
  // bounce instead of fighting the solver mid-resolve.
  drainPendingKicks() {
    for (const kick of this.#pendingKicks) {
      const { bodyA, bodyB, normal, magnitude } = kick;
      Body.setVelocity(bodyA, {
        x: bodyA.velocity.x - normal.x * magnitude,
        y: bodyA.velocity.y - normal.y * magnitude
      });
      Body.setVelocity(bodyB, {
        x: bodyB.velocity.x + normal.x * magnitude,
        y: bodyB.velocity.y + normal.y * magnitude
      });
    }
    this.#pendingKicks = [];
  }

  // Sum of this frame's collision intensities, for GameManager's screen-
  // shake accumulator. Consuming resets it, so each frame only counts once.
  consumeFrameImpulse() {
    const total = this.#frameImpulseTotal;
    this.#frameImpulseTotal = 0;
    return total;
  }

  #handleCollisionStart(event) {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const normal = pair.collision.normal;
      const contact = pair.collision.supports[0] || Vector.mult(Vector.add(a.position, b.position), 0.5);

      const approachSpeed = this.#approachSpeed(a, b, normal);
      if (!isFinite(approachSpeed)) continue; // a degenerate pair must never feed damage or animation

      const aCar = a.carRef;
      const bCar = b.carRef;
      const baseIntensity = this.#speedToIntensity(approachSpeed);
      const visualIntensity = baseIntensity * this.#profile.visualIntensityScale;
      this.#frameImpulseTotal += baseIntensity;

      if ((a.isBarrier && bCar) || (b.isBarrier && aCar)) {
        const car = a.isBarrier ? bCar : aCar;
        const damageImpulse = this.#intensityToImpulse(baseIntensity) * COLLISION_IMPULSE_SCALE.wall;

        this.#notifyBarrierContact(car);
        car.registerImpact(contact, damageImpulse);
        this.#animationManager.spawnBarrierPulse(contact.x, contact.y, visualIntensity);
      } else if (aCar && bCar) {
        const damageImpulse = this.#intensityToImpulse(baseIntensity) * COLLISION_IMPULSE_SCALE.car;

        this.#notifyCarContact(aCar, bCar);
        this.#notifyCarContact(bCar, aCar);
        aCar.registerImpact(contact, damageImpulse);
        bCar.registerImpact(contact, damageImpulse);
        this.#animationManager.spawnImpactFlash(contact.x, contact.y, visualIntensity);

        this.#dispatchContactEvent("start", aCar, bCar, damageImpulse);
        this.#queueElasticKick(a, b, normal, approachSpeed);
      }
    }
  }

  // A small over-unity nudge along the collision normal, gated to profiles
  // that opt in (bounceKick > 0) and only above a minimum closing speed, so
  // gentle taps don't pop. Clamped implicitly by the profile's own maxSpeed
  // ceiling (applied separately by GameManager every frame) -- this alone
  // can't make the system gain energy indefinitely.
  #queueElasticKick(bodyA, bodyB, normal, approachSpeed) {
    if (this.#profile.bounceKick <= 0 || approachSpeed < this.#profile.bounceKickSpeedThreshold) return;
    this.#pendingKicks.push({ bodyA, bodyB, normal, magnitude: approachSpeed * this.#profile.bounceKick });
  }

  // collisionActive/collisionEnd only matter for the car-car contact-duration
  // feed (grapple tracking) -- they never re-trigger the heading policy or
  // damage, which stay tied exclusively to the start transition.
  #handleCollisionPhase(event, type) {
    for (const pair of event.pairs) {
      const aCar = pair.bodyA.carRef;
      const bCar = pair.bodyB.carRef;
      if (aCar && bCar) this.#dispatchContactEvent(type, aCar, bCar, 0);
    }
  }

  #dispatchContactEvent(type, carA, carB, impulse) {
    for (const listener of this.#contactListeners) {
      listener({ type, carA, carB, impulse });
    }
  }

  // Closing speed along the collision normal -- works uniformly for car-car
  // (both velocities live) and car-barrier (the static body's velocity is
  // always {0,0}), and is read here before matter.js's solver has touched
  // either body this step.
  #approachSpeed(bodyA, bodyB, normal) {
    const relVelX = bodyA.velocity.x - bodyB.velocity.x;
    const relVelY = bodyA.velocity.y - bodyB.velocity.y;
    return Math.abs(relVelX * normal.x + relVelY * normal.y);
  }

  #speedToIntensity(speed) {
    return constrain(speed / 9, 0.3, 1.6); // 9 ~= a standard car's max forward speed
  }

  // DamageModel wants an impulse-like magnitude; collisionStart fires before
  // matter.js resolves the actual constraint impulse, so this converts our
  // approach-speed-derived "intensity" into a comparable push-strength estimate.
  #intensityToImpulse(intensity) {
    return intensity * 9;
  }

  #notifyBarrierContact(car) {
    if (car instanceof OpponentCar) car.onBarrierContact();
  }

  #notifyCarContact(car, otherCar) {
    if (car instanceof OpponentCar && !this.#headingPolicyExemption(car, otherCar)) {
      car.onCarContact();
    }
  }
}
