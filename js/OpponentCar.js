/* ============================================================================
   OPPONENT CAR
   Delegates per-frame motion to a swappable "behaviour" object (strategy
   pattern -- see js/behaviours/). OpponentCar itself only knows how to react
   to collisions (the shared heading policy) and how to ask its current
   behaviour to update it; it never needs to know which mode is active.
   ============================================================================ */
class OpponentCar extends Car {
  #behavior = new StaticBehaviour();

  setBehavior(behavior) {
    this.#behavior = behavior;
  }

  get behavior() { return this.#behavior; }

  update() {
    super.update();
    this.#behavior.update(this);
  }

  // ---- Heading policy (shared by all modes) --------------------------------
  // Note: no explicit squash trigger here -- DamageModel's live-vertex
  // deformation (driven by CollisionManager's registerImpact call) already
  // provides the visual "impact" reaction, so the heading policy only needs
  // to handle the heading itself.
  onBarrierContact() {
    const shift = Math.PI;
    this.setHeadingAngle(this.heading + shift);
    this.#behavior.onHeadingShift(shift);
  }

  onCarContact() {
    const shift = (Math.random() < 0.5 ? 1 : -1) * HALF_PI;
    this.setHeadingAngle(this.heading + shift);
    this.#behavior.onHeadingShift(shift);
  }
}
