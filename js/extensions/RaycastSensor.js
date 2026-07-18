/* ============================================================================
   RAYCAST SENSOR (Extension 3, part A -- spatial query for autonomous nav)

   Casts a fan of rays from a car's nose and reports, per ray, the free
   distance before it meets another body. Built on Matter.Query.ray -- a
   genuine spatial query against the live physics world (so it automatically
   respects barriers AND every car's actual current hull, including dented
   ones from DamageModel) rather than a hand-rolled distance/angle check
   against cached positions.
   ============================================================================ */
class RaycastSensor {
  #rayCount;
  #fanAngle;
  #range;
  #lastRays = [];

  constructor(rayCount = RAYCAST_CONFIG.rayCount, fanAngle = RAYCAST_CONFIG.fanAngle, range = RAYCAST_CONFIG.range) {
    this.#rayCount = rayCount;
    this.#fanAngle = fanAngle;
    this.#range = range;
  }

  get lastRays() { return this.#lastRays; }

  sense(car, world) {
    const bodies = Composite.allBodies(world).filter(b => b !== car.body);
    const start = car.position;
    const results = [];

    for (let i = 0; i < this.#rayCount; i++) {
      const t = this.#rayCount === 1 ? 0.5 : i / (this.#rayCount - 1);
      const offset = (t - 0.5) * this.#fanAngle;
      const angle = car.heading + offset;
      const end = {
        x: start.x + Math.cos(angle) * this.#range,
        y: start.y + Math.sin(angle) * this.#range
      };

      const distance = this.#nearestHitDistance(bodies, start, end, angle, car.body);
      results.push({ angleOffset: offset, angle, distance, start, end });
    }

    this.#lastRays = results;
    return results;
  }

  #nearestHitDistance(bodies, start, end, angle, selfBody) {
    // Matter.Query.ray builds a thin rectangular "ray body" internally and
    // runs full SAT collision against each candidate, so collision.supports
    // gives a genuine contact point -- the same field CollisionManager uses
    // for its impact-flash placement, reused here for consistency.
    const collisions = Query.ray(bodies, start, end);
    let nearest = this.#range;

    for (const collision of collisions) {
      const hitBody = collision.bodyB;
      if (!hitBody || hitBody === selfBody) continue;
      const point = (collision.supports && collision.supports[0]) || hitBody.position;
      const d = dist(start.x, start.y, point.x, point.y);
      if (d < nearest) nearest = d;
    }
    return nearest;
  }
}
