/* ============================================================================
   SINE BEHAVIOUR (Mode 3 -- Advanced Opponents)
   Sinusoidal lateral oscillation layered on a stored base heading, with a
   per-car phase offset so opponents don't all weave in lockstep. Velocity is
   rebuilt at a fixed magnitude every frame, so speed stays constant "by
   construction" even as direction sweeps back and forth.
   ============================================================================ */
class SineBehaviour {
  constructor(speed, baseHeading) {
    this.speed = speed;
    this.baseHeading = baseHeading;
    this.phase = random(TWO_PI); // per-car phase offset
  }

  update(opponent) {
    this.phase += OPPONENT_MOTION.sineFrequency;
    const oscillation = Math.sin(this.phase) * OPPONENT_MOTION.sineAmplitude;
    opponent.heading = this.baseHeading + oscillation;
    opponent.setVelocityAlongHeading(this.speed);
  }

  onHeadingShift(deltaAngle) {
    // Keep the oscillation centred on the new course after a collision
    // response, instead of fighting it back toward the old heading.
    this.baseHeading += deltaAngle;
  }
}
