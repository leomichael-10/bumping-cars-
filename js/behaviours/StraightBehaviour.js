/* ============================================================================
   STRAIGHT BEHAVIOUR (Mode 2 -- Random Opponents)
   Constant-speed straight-line travel. Velocity is force-set from the
   current heading every frame, so frictionAir never decays the car's pace.
   ============================================================================ */
class StraightBehaviour {
  constructor(speed) {
    this.speed = speed;
  }

  update(opponent) {
    opponent.setVelocityAlongHeading(this.speed);
  }

  onHeadingShift(_deltaAngle) { /* no base heading to track -- heading IS the course */ }
}
