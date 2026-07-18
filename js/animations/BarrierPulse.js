/* ============================================================================
   BARRIER PULSE
   Localised ripple at a car-wall contact point: concentric arcs expanding
   outward along the wall, with count/brightness scaled by impact speed.
   ============================================================================ */
class BarrierPulse {
  constructor(x, y, intensity = 1) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.lifespan = 26;
    this.intensity = intensity;
    this.ringCount = Math.round(2 + intensity * 2);
  }

  update() {
    this.age++;
  }

  draw() {
    const t = this.age / this.lifespan;
    const baseAlpha = 200 * (1 - t) * this.intensity;

    noFill();
    for (let i = 0; i < this.ringCount; i++) {
      const ringDelay = i * 0.12;
      const ringT = constrain(t - ringDelay, 0, 1);
      if (ringT <= 0) continue;
      stroke(255, 90, 90, baseAlpha * (1 - ringDelay));
      strokeWeight(3 * (1 - ringT) + 1);
      circle(this.x, this.y, 14 + ringT * 60 * this.intensity);
    }
  }

  isDone() {
    return this.age >= this.lifespan;
  }
}
