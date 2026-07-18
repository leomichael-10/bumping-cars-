/* ============================================================================
   PURSUIT BEHAVIOUR (Extension 3, part B -- "Hunter" mode, key H)

   Steering-behaviour navigation, not a beeline. Combines three weighted
   vectors every frame:
     PURSUE   -- intercepts where the target WILL be (position + velocity *
                 time-to-intercept), not where it is now.
     AVOID    -- repulsion from RaycastSensor's fan of rays, weighted by the
                 inverse of each ray's free distance (closer obstacle =
                 stronger push away from it).
     SEPARATE -- mild repulsion from nearby opponents, so hunters don't pile
                 into each other or the target as a single blob.
   The result is turned toward with a capped turn rate (it must carve an
   actual line, not pivot instantly), then layered on top of the same
   collision heading policy every opponent obeys -- a wall or car hit still
   knocks it around; pursuit simply resumes computing from wherever it ends
   up next frame.
   ============================================================================ */
class PursuitBehaviour {
  #speed;
  #getTarget;
  #getOpponents;
  #getWorld;
  #sensor;
  #maxTurnRate;
  #leadFrames;
  #weights;
  #lastRays = [];

  constructor(speed, targetProviderFn, opponentsProviderFn, worldProviderFn, sensor) {
    this.#speed = speed;
    this.#getTarget = targetProviderFn;
    this.#getOpponents = opponentsProviderFn;
    this.#getWorld = worldProviderFn;
    this.#sensor = sensor || new RaycastSensor();
    this.#maxTurnRate = OPPONENT_MOTION.hunterMaxTurnRate;
    this.#leadFrames = OPPONENT_MOTION.hunterPredictionFrames;
    this.#weights = { ...PURSUIT_WEIGHTS };
  }

  get lastRays() { return this.#lastRays; }

  // Lets an external difficulty curve (SurvivalMode's escalation) push new
  // aggression values in every frame without PursuitBehaviour knowing
  // anything about rounds, timers, or escalation -- it just always steers
  // using whatever its current profile is. Any field left out keeps its
  // current value, so partial updates are safe.
  setProfile({ speed, maxTurnRate, leadFrames, weights } = {}) {
    if (speed !== undefined) this.#speed = speed;
    if (maxTurnRate !== undefined) this.#maxTurnRate = maxTurnRate;
    if (leadFrames !== undefined) this.#leadFrames = leadFrames;
    if (weights !== undefined) this.#weights = { ...this.#weights, ...weights };
  }

  update(opponent) {
    const target = this.#getTarget();
    if (!target) return;

    const pursue = this.#pursueVector(opponent, target);
    const avoid = this.#avoidVector(opponent);
    const separate = this.#separateVector(opponent);

    const combined = {
      x: pursue.x * this.#weights.pursue + avoid.x * this.#weights.avoid + separate.x * this.#weights.separate,
      y: pursue.y * this.#weights.pursue + avoid.y * this.#weights.avoid + separate.y * this.#weights.separate
    };
    if (Math.hypot(combined.x, combined.y) < 0.0001) return;

    const desiredHeading = Math.atan2(combined.y, combined.x);
    let diff = desiredHeading - opponent.heading;
    while (diff > Math.PI) diff -= TWO_PI;
    while (diff < -Math.PI) diff += TWO_PI;

    opponent.heading += constrain(diff, -this.#maxTurnRate, this.#maxTurnRate);
    opponent.setVelocityAlongHeading(this.#speed);
  }

  // Time-to-intercept is estimated as distance / closing speed, where
  // closing speed approximates how fast the target is closing the gap
  // toward the hunter (its velocity component along the line to the
  // hunter) offset by the hunter's own pace -- a standard, cheap
  // approximation rather than solving the exact intercept quadratic.
  // #leadFrames caps how far ahead that estimate is allowed to reach, which
  // is what Survival Mode's escalation curve scales over the round.
  #pursueVector(opponent, target) {
    const toTarget = Vector.sub(target.position, opponent.position);
    const distance = Math.hypot(toTarget.x, toTarget.y) || 1;
    const towardHunter = Vector.normalise(Vector.mult(toTarget, -1));
    const closingSpeed = Math.max(this.#speed - Vector.dot(target.velocity, towardHunter), 1.5);
    const timeToIntercept = constrain(distance / closingSpeed, 0, this.#leadFrames);

    const predicted = {
      x: target.position.x + target.velocity.x * timeToIntercept,
      y: target.position.y + target.velocity.y * timeToIntercept
    };
    return this.#normalise(Vector.sub(predicted, opponent.position));
  }

  #avoidVector(opponent) {
    const rays = this.#sensor.sense(opponent, this.#getWorld());
    this.#lastRays = rays;

    const avoid = { x: 0, y: 0 };
    for (const ray of rays) {
      const clearness = 1 - constrain(ray.distance / RAYCAST_CONFIG.range, 0, 1);
      if (clearness <= 0) continue;
      const weight = clearness * clearness; // inverse-distance-like: near obstacles dominate
      avoid.x -= Math.cos(ray.angle) * weight;
      avoid.y -= Math.sin(ray.angle) * weight;
    }
    return this.#normalise(avoid);
  }

  #separateVector(opponent) {
    const radius = this.#weights.separationRadius || PURSUIT_WEIGHTS.separationRadius;
    const push = { x: 0, y: 0 };

    for (const other of this.#getOpponents()) {
      if (other === opponent) continue;
      const d = dist(opponent.position.x, opponent.position.y, other.position.x, other.position.y);
      if (d > 0 && d < radius) {
        const weight = (radius - d) / radius;
        push.x += ((opponent.position.x - other.position.x) / d) * weight;
        push.y += ((opponent.position.y - other.position.y) / d) * weight;
      }
    }
    return this.#normalise(push);
  }

  #normalise(v) {
    const mag = Math.hypot(v.x, v.y);
    return mag > 0.0001 ? { x: v.x / mag, y: v.y / mag } : { x: 0, y: 0 };
  }

  onHeadingShift(_deltaAngle) {
    // Pursuit recomputes its desired heading from live target/sensor data
    // every frame, so a collision-driven heading kick is naturally absorbed
    // on the next update() -- nothing to track here.
  }
}
