/* ============================================================================
   PLAYER CAR
   Arrow-key controlled Standard car. Force-based throttle with direction-
   aware velocity clamping; steering only takes effect while moving.
   Distinguished visually by the "player" palette (bright red) and the "P1"
   stripe marking -- the shared Car draw pipeline handles everything else.
   ============================================================================ */
class PlayerCar extends Car {
  constructor(x, y, world, profile) {
    super("standard", "player", x, y, 0, world, profile, "P1");
  }

  get isPlayer() { return true; }

  applyThrottle(reverse) {
    this.applyForwardForce(reverse);
    this.clampSpeed();
  }

  steer(direction) {
    if (this.speed < 0.3) return; // steering requires motion, for realism
    // A damaged hull steers noisily -- see DamageModel's handling penalty.
    this.setHeadingAngle(this.heading + direction * this.spec.turnRate + this.steeringBiasNoise());
  }
}
