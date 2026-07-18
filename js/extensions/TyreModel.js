/* ============================================================================
   TYRE MODEL (Extension 2, part A -- lateral slip / grip)

   Composed by Car, one instance per body. Runs BEFORE Engine.update() each
   frame (see GameManager.update): matter.js only gives bodies uniform
   frictionAir, which damps speed but does nothing to stop a car sliding
   sideways like a frictionless puck. This decomposes velocity into
   forward/lateral components relative to heading and cancels a fraction of
   the lateral component directly -- a simplified tyre force model matter.js
   does not provide out of the box.
   ============================================================================ */
class TyreModel {
  #grip;
  #slipThreshold;
  #slipRatio = 0;
  #sliding = false;

  constructor(grip, slipThreshold) {
    this.#grip = grip;
    this.#slipThreshold = slipThreshold;
  }

  get slipRatio() { return this.#slipRatio; }
  get isSliding() { return this.#sliding; }

  apply(body, heading) {
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    const lateral = { x: -forward.y, y: forward.x };
    const v = body.velocity;

    const forwardComponent = v.x * forward.x + v.y * forward.y;
    const lateralComponent = v.x * lateral.x + v.y * lateral.y;
    const speed = Math.hypot(v.x, v.y);

    this.#slipRatio = speed > 0.05 ? Math.abs(lateralComponent) / speed : 0;
    this.#sliding = this.#slipRatio > this.#slipThreshold;

    // grippedLateral RETAINS `grip` fraction of the lateral component --
    // grip == 1 keeps all of it (no correction, maximum slide); grip == 0
    // removes all of it (full traction, no slide). Counter-intuitively
    // named ("grip" reads as "how gripped", but a HIGH number here means
    // LESS traction) -- documented explicitly since it's easy to reach for
    // the opposite value by instinct. Left as-is rather than flipped: every
    // CAR_TYPES grip constant is tuned against this exact formula.
    const grippedLateral = lateralComponent * this.#grip;
    Body.setVelocity(body, {
      x: forward.x * forwardComponent + lateral.x * grippedLateral,
      y: forward.y * forwardComponent + lateral.y * grippedLateral
    });
  }
}
