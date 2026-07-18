/* ============================================================================
   IMPACT FLASH
   One-shot spark burst + expanding ring at a car-car contact point.
   Self-contained lifecycle: update()/draw()/isDone(), fades over ~20 frames.
   Particle count/speed and ring size scale with the collision's intensity.
   ============================================================================ */
class ImpactFlash {
  constructor(x, y, intensity = 1) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.lifespan = 20;
    this.intensity = intensity;
    this.particles = [];

    const particleCount = Math.round(8 + intensity * 6);
    for (let i = 0; i < particleCount; i++) {
      const angle = (TWO_PI / particleCount) * i + random(-0.2, 0.2);
      const speed = random(2, 5) * intensity;
      this.particles.push({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        x, y
      });
    }
  }

  update() {
    this.age++;
    for (const p of this.particles) {
      // Gravity-free drift: particles simply decelerate, no downward pull,
      // since this is a top-down arena.
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
  }

  draw() {
    const t = this.age / this.lifespan;
    const alpha = 255 * (1 - t);

    noFill();
    stroke(255, 230, 120, alpha);
    strokeWeight(2);
    circle(this.x, this.y, 10 + t * 46 * this.intensity);

    noStroke();
    fill(255, 200, 90, alpha);
    for (const p of this.particles) {
      circle(p.x, p.y, 4 * (1 - t) * this.intensity);
    }
  }

  isDone() {
    return this.age >= this.lifespan;
  }
}
