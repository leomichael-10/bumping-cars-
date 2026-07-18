/* ============================================================================
   ARENA
   Owns the four static barrier bodies and the Start Zone geometry. Exposes
   only what other modules need (spawn queries, drawing) -- nothing outside
   this class reaches into barrier body internals directly.
   ============================================================================ */
class Arena {
  #barrierBodies = [];
  #startZone;

  constructor() {
    this.#startZone = {
      x: ARENA_CONFIG.x + START_ZONE_CONFIG.marginX,
      y: ARENA_CONFIG.y + START_ZONE_CONFIG.marginY,
      w: START_ZONE_CONFIG.width,
      h: ARENA_CONFIG.height - START_ZONE_CONFIG.marginY * 2
    };
  }

  build(world, profile) {
    const opts = { isStatic: true };
    const { x, y, width, height, wallThickness } = ARENA_CONFIG;

    const top = Bodies.rectangle(x + width / 2, y - wallThickness / 2, width + wallThickness * 2, wallThickness, opts);
    const bottom = Bodies.rectangle(x + width / 2, y + height + wallThickness / 2, width + wallThickness * 2, wallThickness, opts);
    const left = Bodies.rectangle(x - wallThickness / 2, y + height / 2, wallThickness, height + wallThickness * 2, opts);
    const right = Bodies.rectangle(x + width + wallThickness / 2, y + height / 2, wallThickness, height + wallThickness * 2, opts);

    this.#barrierBodies = [top, bottom, left, right];
    for (const b of this.#barrierBodies) {
      b.isBarrier = true;
      // matter.js's Body.setStatic (triggered internally by isStatic: true
      // during Body.create) unconditionally hardcodes restitution=0 and
      // friction=1 on static bodies, discarding whatever was passed in the
      // constructor options -- restitution/friction MUST be reassigned here,
      // after construction, or the profile's barrier values are silently
      // ignored entirely (this was true even before per-mode profiles
      // existed: BARRIER_PHYSICS.restitution was never actually reaching
      // the body).
      b.restitution = profile.barrierRestitution;
      b.friction = BARRIER_FRICTION;
    }
    World.add(world, this.#barrierBodies);
  }

  teardown(world) {
    if (this.#barrierBodies.length) World.remove(world, this.#barrierBodies);
    this.#barrierBodies = [];
  }

  isInsideStartZone(x, y) {
    const z = this.#startZone;
    return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
  }

  isInsideArena(x, y) {
    return x >= ARENA_CONFIG.x && x <= ARENA_CONFIG.x + ARENA_CONFIG.width &&
      y >= ARENA_CONFIG.y && y <= ARENA_CONFIG.y + ARENA_CONFIG.height;
  }

  getStartZone() {
    return { ...this.#startZone };
  }

  draw(spawnRejectTimer) {
    this.#drawFloor();
    for (const b of this.#barrierBodies) this.#drawBarrierSegment(b);
    this.#drawStartZone(spawnRejectTimer);
  }

  #drawFloor() {
    const { x, y, width, height } = ARENA_CONFIG;

    noStroke();
    fill(36, 40, 46);
    rect(x, y, width, height);

    // Faint radial sheen -- suggests polished metal under overhead light.
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.7;
    const steps = 6;
    noFill();
    for (let i = steps; i > 0; i--) {
      const t = i / steps;
      stroke(255, 255, 255, (1 - t) * 10);
      strokeWeight(maxR / steps);
      circle(cx, cy, maxR * t);
    }

    // Subtle floor grid.
    stroke(255, 255, 255, 12);
    strokeWeight(1);
    for (let gx = x; gx <= x + width; gx += 40) line(gx, y, gx, y + height);
    for (let gy = y; gy <= y + height; gy += 40) line(x, gy, x + width, gy);

    // Soft ambient shading toward the edges (vignette).
    noFill();
    for (let i = 0; i < 10; i++) {
      const inset = i * 4;
      stroke(0, 0, 0, 6);
      strokeWeight(4);
      rect(x + inset, y + inset, width - inset * 2, height - inset * 2, 4);
    }
  }

  #drawBarrierSegment(body) {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    const horizontal = w >= h;

    push();
    translate(body.position.x, body.position.y);
    rectMode(CENTER);

    // Inner shadow cast onto the floor, drawn slightly before the rail itself.
    noStroke();
    fill(0, 0, 0, 50);
    rect(0, horizontal ? (body.position.y < ARENA_CONFIG.y + ARENA_CONFIG.height / 2 ? 6 : -6) : 0,
      horizontal ? w : w + 10,
      horizontal ? h + 10 : h, 4);

    // Outer rail (structural steel look).
    noStroke();
    fill(70, 74, 82);
    rect(0, 0, w, h);

    // Diagonal caution stripes, clipped to the segment.
    const stripeSize = 22;
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(-w / 2, -h / 2, w, h);
    drawingContext.clip();
    fill(230, 180, 40);
    noStroke();
    const span = horizontal ? w : h;
    for (let i = -span; i < span; i += stripeSize * 2) {
      if (horizontal) {
        quad(i, -h / 2, i + stripeSize, -h / 2, i + stripeSize - h, h / 2, i - h, h / 2);
      } else {
        quad(-w / 2, i, -w / 2, i + stripeSize, w / 2, i + stripeSize - w, w / 2, i - w);
      }
    }
    drawingContext.restore();

    // Inner rubber padding strip facing the arena interior.
    const padThickness = 6;
    fill(30, 30, 34);
    if (horizontal) {
      const dir = body.position.y < ARENA_CONFIG.y + ARENA_CONFIG.height / 2 ? 1 : -1;
      rect(0, dir * (h / 2 - padThickness / 2), w - 4, padThickness, 3);
    } else {
      const dir = body.position.x < ARENA_CONFIG.x + ARENA_CONFIG.width / 2 ? 1 : -1;
      rect(dir * (w / 2 - padThickness / 2), 0, padThickness, h - 4, 3);
    }

    // Inner highlight edge for a layered look.
    noFill();
    stroke(255, 255, 255, 40);
    strokeWeight(2);
    rect(0, 0, w - 6, h - 6);
    pop();
  }

  #drawStartZone(spawnRejectTimer) {
    const z = this.#startZone;

    // Floor tint.
    noStroke();
    fill(255, 230, 90, 14);
    rect(z.x, z.y, z.w, z.h);

    // Hatched diagonal pattern for a "parking bay" feel.
    push();
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(z.x, z.y, z.w, z.h);
    drawingContext.clip();
    stroke(255, 230, 90, 25);
    strokeWeight(1);
    for (let i = -z.h; i < z.w; i += 16) {
      line(z.x + i, z.y, z.x + i + z.h, z.y + z.h);
    }
    drawingContext.restore();
    pop();

    // Dashed outline.
    push();
    noFill();
    stroke(255, 230, 90);
    strokeWeight(2);
    drawingContext.setLineDash([8, 6]);
    rect(z.x, z.y, z.w, z.h, 6);
    drawingContext.setLineDash([]);
    pop();

    noStroke();
    fill(255, 230, 90);
    textAlign(CENTER);
    textSize(14);
    text("START ZONE", z.x + z.w / 2, z.y + 18);

    if (spawnRejectTimer > 0) {
      noFill();
      stroke(255, 60, 60, spawnRejectTimer * 12);
      strokeWeight(4);
      rect(z.x, z.y, z.w, z.h, 6);

      noStroke();
      fill(255, 70, 70, spawnRejectTimer * 12);
      textAlign(CENTER);
      textSize(13);
      text("SPAWN REJECTED - too close to another car", z.x + z.w / 2, z.y + z.h / 2);
    }
  }
}
