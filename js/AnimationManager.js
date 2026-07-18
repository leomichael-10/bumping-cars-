/* ============================================================================
   ANIMATION MANAGER
   Owns all one-shot animation instances (impact flashes, barrier pulses) in a
   single array, exposing one update()/draw() pair so sketch.js never needs
   to know which animation classes exist.
   ============================================================================ */
class AnimationManager {
  #effects = [];

  spawnImpactFlash(x, y, intensity) {
    this.#effects.push(new ImpactFlash(x, y, intensity));
  }

  spawnBarrierPulse(x, y, intensity) {
    this.#effects.push(new BarrierPulse(x, y, intensity));
  }

  update() {
    for (const effect of this.#effects) effect.update();
    this.#effects = this.#effects.filter(effect => !effect.isDone());
  }

  draw() {
    for (const effect of this.#effects) effect.draw();
  }

  clear() {
    this.#effects = [];
  }
}
