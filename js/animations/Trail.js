/* ============================================================================
   TRAIL
   Per-car motion trail: a small ring buffer of recent positions/speeds.
   Owned by each Car instance (not the AnimationManager) since it's tied to
   that specific body's history rather than a one-shot effect.
   ============================================================================ */
class Trail {
  #points = [];
  #maxLength = 24;

  record(x, y, speed) {
    this.#points.push({ x, y, speed });
    if (this.#points.length > this.#maxLength) this.#points.shift();
  }

  draw(colorValue, maxSpeed) {
    noFill();
    for (let i = 1; i < this.#points.length; i++) {
      const p0 = this.#points[i - 1];
      const p1 = this.#points[i];
      const recency = i / this.#points.length;
      const speedFrac = constrain(p1.speed / maxSpeed, 0, 1);
      const alpha = recency * 90 * speedFrac;

      stroke(red(colorValue), green(colorValue), blue(colorValue), alpha);
      strokeWeight(2 + speedFrac * 3);
      line(p0.x, p0.y, p1.x, p1.y);
    }
  }
}
