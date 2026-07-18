/* ============================================================================
   CAR (base class)
   Wraps a matter.js body with a physical spec and a layered, motion-reactive
   rendering pipeline built around ONE architectural rule: the physics hull
   and the decoration are drawn separately.
     - drawHull()       draws the LIVE matter.js vertex list (body.vertices)
                         -- the bumper's outer edge. It dents, because it IS
                         the same data DamageModel feeds into Body.setVertices.
     - drawDecoration()  draws the shell/cockpit/lights/chevron in the body's
                         LOCAL frame, clipped to the hull path so a caved-in
                         bumper visually crops the shell rather than letting
                         decoration float outside a dented hull.
   Composes two extension components rather than implementing their logic
   inline, so either can be swapped or removed without touching this class:
     - DamageModel: owns the live collision polygon (dents, recovery).
     - TyreModel:   owns lateral grip/slip correction.
   PlayerCar and OpponentCar extend this with distinct control logic; they
   only pass a different palette/marking, never touch the drawing geometry.
   ============================================================================ */
class Car {
  #spec;
  #trail;
  #palette;       // { base, light, dark, accent } as p5 color objects (for fill/stroke)
  #paletteHex;     // same four values as raw hex strings (for canvas gradients)
  #markingText;    // "P1" for the player, opponent number otherwise
  #damageModel;
  #tyreModel;
  #baseFrictionAir; // profile override (if any) or the car type's own default -- see update()
  #throttleForceMultiplier;
  #prevSpeed = 0;
  #reversing = false;
  #brakeActive = false;
  #rollAngle = 0;
  #idlePhase;

  // `profile` is one of PHYSICS_PROFILES (see config.js) -- required, not
  // optional, so every car is always built under an explicit, known set of
  // restitution/friction/damage/recovery rules rather than an implicit default.
  constructor(type, paletteKey, x, y, heading, world, profile, markingText) {
    this.type = type;
    this.heading = heading;
    this.#spec = CAR_TYPES[type];
    this.#trail = new Trail();
    this.#paletteHex = CAR_PALETTES[paletteKey];
    this.#palette = this.#buildPaletteColors(this.#paletteHex);
    this.#markingText = markingText;
    this.#baseFrictionAir = profile.carFrictionAir ?? this.#spec.frictionAir;
    this.#throttleForceMultiplier = profile.throttleForceMultiplier ?? 1;
    this.#idlePhase = random(TWO_PI);

    this.body = Bodies.rectangle(x, y, this.#spec.width, this.#spec.height, {
      chamfer: { radius: this.#spec.height * this.#spec.chamferRadiusFactor },
      density: this.#spec.density,
      friction: profile.carFriction ?? this.#spec.friction,
      frictionAir: this.#baseFrictionAir,
      restitution: profile.carRestitution,
      angle: heading
    });
    this.body.carRef = this; // lets CollisionManager map a matter.js body back to its Car
    if (!profile.allowSleeping) this.body.sleepThreshold = Infinity; // per-body guard, defense in depth
    World.add(world, this.body);

    this.#damageModel = new DamageModel(this.body, heading, profile);
    // profile.carGrip overrides the per-type default uniformly (Demolition's
    // skating-rink grip applies regardless of Standard/Slow) -- null means
    // "leave each CAR_TYPE's own grip alone", same null-passthrough pattern
    // as carFriction/carFrictionAir above.
    this.#tyreModel = new TyreModel(profile.carGrip ?? this.#spec.grip, this.#spec.slipThreshold);

    if (DEBUG_PHYSICS) {
      console.log(`[spawn] ${type}/${paletteKey} restitution=${this.body.restitution} friction=${this.body.friction} frictionAir=${this.body.frictionAir.toFixed(4)} density=${this.body.density} grip=${profile.carGrip ?? this.#spec.grip} throttleMult=${this.#throttleForceMultiplier}`);
    }
  }

  #buildPaletteColors(hexPalette) {
    return {
      base: color(hexPalette.base),
      light: color(hexPalette.light),
      dark: color(hexPalette.dark),
      accent: color(hexPalette.accent)
    };
  }

  // Re-derives a p5 color with a custom alpha from a hex string, without
  // relying on 8-digit hex-with-alpha parsing support.
  #withAlpha(hex, alpha) {
    const c = color(hex);
    return color(red(c), green(c), blue(c), alpha);
  }

  // ---- Public read-only accessors used by other modules --------------------
  get spec() { return this.#spec; }
  get position() { return this.body.position; }
  get velocity() { return this.body.velocity; }
  get speed() { return Math.hypot(this.body.velocity.x, this.body.velocity.y); }
  get isPlayer() { return false; }
  get damage() { return this.#damageModel.damage; }
  get recentlyHit() { return this.#damageModel.recentImpact; }
  get isSliding() { return this.#tyreModel.isSliding; }
  get slipRatio() { return this.#tyreModel.slipRatio; }

  // ---- Shared motion helpers (used by subclasses/behaviours) ---------------
  applyForwardForce(reverse) {
    const dir = reverse ? -1 : 1;
    const headingVec = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const force = this.#spec.engineForce * dir * this.#throttleForceMultiplier;
    Body.applyForce(this.body, this.body.position, Vector.mult(headingVec, force));
  }

  setHeadingAngle(angle) {
    this.heading = angle;
    Body.setAngle(this.body, angle);
  }

  setVelocityAlongHeading(speedMagnitude) {
    const dir = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    Body.setVelocity(this.body, { x: dir.x * speedMagnitude, y: dir.y * speedMagnitude });
    Body.setAngle(this.body, this.heading);
  }

  // Direction-aware clamp: classifies current velocity as forward/reverse
  // relative to heading, then rescales down to the relevant max if exceeded.
  clampSpeed() {
    const v = this.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed === 0) return;
    const headingVec = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const forwardComponent = v.x * headingVec.x + v.y * headingVec.y;
    const limit = forwardComponent >= 0 ? this.#spec.maxForwardSpeed : this.#spec.maxReverseSpeed;
    if (speed > limit) {
      const scale = limit / speed;
      Body.setVelocity(this.body, { x: v.x * scale, y: v.y * scale });
    }
  }

  setReversing(isReversing) {
    this.#reversing = isReversing;
  }

  // Extension 2: called by GameManager BEFORE Engine.update() each frame, so
  // the lateral-grip correction happens on the pre-integration velocity.
  applyTyreGrip() {
    this.#tyreModel.apply(this.body, this.heading);
  }

  // Extension 1: called by CollisionManager on every collision involving
  // this car (barrier or car-car).
  registerImpact(worldContactPoint, impactMagnitude) {
    this.#damageModel.registerImpact(worldContactPoint, impactMagnitude);
  }

  // Extension 2: approximate wheel contact points in world space, used by
  // GameManager to stamp SkidLayer marks while sliding.
  getWheelWorldPositions() {
    const hw = this.#spec.width * 0.42;
    const hh = this.#spec.height * 0.48;
    const cos = Math.cos(this.body.angle);
    const sin = Math.sin(this.body.angle);
    const corners = [{ x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: -hh }, { x: -hw, y: hh }];
    return corners.map(c => ({
      x: this.body.position.x + c.x * cos - c.y * sin,
      y: this.body.position.y + c.x * sin + c.y * cos
    }));
  }

  remove(world) {
    World.remove(world, this.body);
  }

  update() {
    const currentSpeed = this.speed;
    this.#trail.record(this.body.position.x, this.body.position.y, currentSpeed);

    // Brake lights: lit on deliberate reverse throttle OR sudden deceleration
    // (e.g. bouncing off a wall/car), not just "not accelerating".
    const deceleration = this.#prevSpeed - currentSpeed;
    this.#brakeActive = this.#reversing || deceleration > CAR_FX.brakeDecelThreshold;
    this.#prevSpeed = currentSpeed;

    // Body roll: lean opposite the angular velocity, smoothed -- this ONLY
    // affects the decoration layer (see draw()), never the physics hull.
    const targetRoll = constrain(-this.body.angularVelocity * CAR_FX.rollAngularVelScale, -CAR_FX.rollMaxAngle, CAR_FX.rollMaxAngle);
    this.#rollAngle += (targetRoll - this.#rollAngle) * 0.2;

    // Damage recovery + collision-shape rebuild (Extension 1).
    this.#damageModel.update();

    // Damage has a real handling cost: a battered car loses air resistance
    // efficiency (drifts/coasts worse) and its steering gets noisier. Uses
    // #baseFrictionAir (the profile override, if any) rather than the car
    // type's raw default, otherwise this per-frame recompute would silently
    // erase a demolition-mode frictionAir override every single frame.
    this.body.frictionAir = this.#baseFrictionAir * (1 + this.#damageModel.damage * DAMAGE_CONFIG.frictionAirPenalty);

    if (DEBUG_PHYSICS && frameCount % 60 === 0) {
      console.log(`[slip] ${this.type} speed=${this.speed.toFixed(2)} slipRatio=${this.#tyreModel.slipRatio.toFixed(2)} sliding=${this.#tyreModel.isSliding}`);
    }
  }

  // Random steering noise that grows with damage -- used by PlayerCar.steer()
  // to simulate a car whose wheels no longer track true after enough hits.
  steeringBiasNoise() {
    return (Math.random() - 0.5) * 2 * DAMAGE_CONFIG.steeringBiasScale * this.#damageModel.damage;
  }

  /* ==========================================================================
     RENDERING
     Draw order: shadow -> trail -> hull -> [clip] shell -> stripe -> cockpit
     -> lights -> chevron -> pole -> [unclip]. Every layer wraps its own
     push()/pop() and sets its own noStroke()/strokeWeight() explicitly.
     ========================================================================== */
  draw() {
    const speed = this.speed;
    const speedFrac = constrain(speed / this.#spec.maxForwardSpeed, 0, 1);
    const isIdle = speed < CAR_FX.idleBobSpeedThreshold;
    const bobOffset = isIdle ? Math.sin(frameCount * 0.08 + this.#idlePhase) * CAR_FX.idleBobAmplitude : 0;

    this.#drawGroundShadow(speedFrac);
    this.#trail.draw(this.#palette.base, this.#spec.maxForwardSpeed);
    this.#drawHull();

    drawingContext.save();
    this.#clipToHull();
    this.#drawDecoration(speedFrac, bobOffset);
    drawingContext.restore();
  }

  #drawGroundShadow(speedFrac) {
    const cfg = CAR_RENDER_CONFIG.shadow;
    const w = this.#spec.width, h = this.#spec.height;
    const offsetX = -Math.cos(this.body.angle) * cfg.offset;
    const offsetY = -Math.sin(this.body.angle) * cfg.offset;
    const grow = 1 + speedFrac * cfg.speedGrowth;

    push();
    translate(this.body.position.x + offsetX, this.body.position.y + offsetY);
    noStroke();
    fill(this.#withAlpha(CAR_MATERIALS.shadowColor, cfg.alpha));
    ellipse(0, 0, w * cfg.rxFactor * 2 * grow, h * cfg.ryFactor * 2 * grow);
    pop();
  }

  // ---- HULL PASS: the live, possibly-dented collision polygon -------------
  #drawHull() {
    const verts = this.body.vertices;
    if (verts.length < 3) return;

    noStroke();
    fill(CAR_MATERIALS.bumperFill);
    beginShape();
    for (const v of verts) vertex(v.x, v.y);
    endShape(CLOSE);

    noFill();
    stroke(CAR_MATERIALS.bumperStroke);
    strokeWeight(CAR_RENDER_CONFIG.hull.strokeWeight);
    beginShape();
    for (const v of verts) vertex(v.x, v.y);
    endShape(CLOSE);

    // Highlight arc + rivets are decorative accents drawn from IDEALISED
    // rest geometry in the body's own (un-rolled) rotated frame -- the fill
    // above, from the real vertex data, is what actually shows the dent;
    // these small details intentionally stay clean on top of it.
    push();
    translate(this.body.position.x, this.body.position.y);
    rotate(this.body.angle);
    this.#drawHullHighlight();
    this.#drawRivets();
    pop();
  }

  #drawHullHighlight() {
    const cfg = CAR_RENDER_CONFIG.hull;
    const w = this.#spec.width, h = this.#spec.height;
    noFill();
    stroke(this.#withAlpha(CAR_MATERIALS.bumperHighlight, cfg.highlightAlpha));
    strokeWeight(cfg.highlightWeight);
    strokeCap(ROUND);
    // Local +X is "front"; an arc from -HALF_PI to HALF_PI sweeps the
    // front-facing half of the ellipse -- this single arc is what sells the
    // ring as rubber catching light, rather than a flat black outline.
    arc(0, 0, w, h, -HALF_PI, HALF_PI);
  }

  #drawRivets() {
    const cfg = CAR_RENDER_CONFIG.rivets;
    const w = this.#spec.width, h = this.#spec.height;
    const span = w * cfg.spanFactor;
    const radius = h * cfg.radiusFactor * this.#spec.rivetSizeFactor;

    noStroke();
    for (let i = 0; i < cfg.count; i++) {
      const t = cfg.count === 1 ? 0.5 : i / (cfg.count - 1);
      const x = -span / 2 + span * t;
      fill(CAR_MATERIALS.rivetTop);
      circle(x, -h / 2, radius * 2);
      fill(CAR_MATERIALS.rivetBottom);
      circle(x, h / 2, radius * 2);
    }
  }

  // Clips subsequent drawing to the live hull path -- established in WORLD
  // space (the body.vertices are already world coordinates) BEFORE the
  // decoration layer's own translate/rotate, so the clip region stays
  // correctly anchored regardless of the extra roll rotation applied inside.
  #clipToHull() {
    const verts = this.body.vertices;
    if (verts.length < 3) return;
    drawingContext.beginPath();
    drawingContext.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) drawingContext.lineTo(verts[i].x, verts[i].y);
    drawingContext.closePath();
    drawingContext.clip();
  }

  // ---- DECORATION PASS: local frame, does not deform -----------------------
  #drawDecoration(speedFrac, bobOffset) {
    push();
    translate(this.body.position.x, this.body.position.y + bobOffset);
    rotate(this.body.angle + this.#rollAngle); // roll only affects decoration, never the hull

    const shellPath = this.#buildShellPath();
    this.#drawShellFill(shellPath);
    this.#drawShellStrokes(shellPath);
    this.#drawStripe();
    this.#drawCockpit();
    this.#drawLights(speedFrac);
    this.#drawChevron();
    this.#drawPole();

    pop();
  }

  // Tapered "shield" outline: full width at the rear, easing (smoothstep)
  // down to a narrower, rounded nose -- sampled rather than a hand-tuned
  // bezier, but smooth enough at this scale to read as a curve, not a rect.
  #buildShellPath() {
    const cfg = CAR_RENDER_CONFIG.shell;
    const w = this.#spec.width, h = this.#spec.height;
    const insetMul = this.#spec.shellInsetFactor;

    const rearHalfW = h / 2 - h * cfg.sideInsetFactor * insetMul;
    const rearX = -w / 2 + w * cfg.rearInsetFactor * insetMul;
    const frontX = w / 2 - w * cfg.frontInsetFactor * insetMul;
    const noseHalfW = rearHalfW * cfg.noseWidthFactor;
    const n = cfg.sampleCount;

    const points = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const eased = t * t * (3 - 2 * t); // smoothstep
      points.push({ x: rearX + (frontX - rearX) * t, y: -(rearHalfW + (noseHalfW - rearHalfW) * eased) });
    }
    points.push({ x: frontX + w * 0.02, y: 0 }); // rounded nose cap
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const eased = t * t * (3 - 2 * t);
      points.push({ x: frontX - (frontX - rearX) * t, y: noseHalfW + (rearHalfW - noseHalfW) * eased });
    }
    return points;
  }

  // Front-lit horizontal gradient (rear dark -> base -> front light). p5's
  // fill() has no gradient support, so this replays the same path through
  // the raw canvas 2D API -- the SAME technique Arena.js already uses for
  // its clip regions, just for a gradient fill instead.
  #drawShellFill(path) {
    const ctx = drawingContext;
    const rearX = path[0].x;
    const frontX = path[Math.floor(path.length / 2)].x;

    const gradient = ctx.createLinearGradient(rearX, 0, frontX, 0);
    gradient.addColorStop(0, this.#paletteHex.dark);
    gradient.addColorStop(0.5, this.#paletteHex.base);
    gradient.addColorStop(1, this.#paletteHex.light);

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  #drawShellStrokes(path) {
    const cfg = CAR_RENDER_CONFIG.shell;

    // Inner shadow: the full shell outline, in livery.dark.
    noFill();
    stroke(this.#palette.dark);
    strokeWeight(cfg.innerShadowWeight);
    beginShape();
    for (const p of path) vertex(p.x, p.y);
    endShape(CLOSE);

    // Rim highlight: ONLY the top-front edge, not the whole outline -- the
    // back half of the top run through the nose cap.
    const topRunStart = Math.floor(cfg.sampleCount * 0.35);
    const noseIndex = cfg.sampleCount + 1;
    stroke(this.#withAlpha(this.#paletteHex.light, cfg.rimHighlightAlpha));
    strokeWeight(cfg.rimHighlightWeight);
    strokeCap(ROUND);
    noFill();
    beginShape();
    for (let i = topRunStart; i <= noseIndex; i++) vertex(path[i].x, path[i].y);
    endShape();
  }

  #drawStripe() {
    const cfg = CAR_RENDER_CONFIG.stripe;
    const w = this.#spec.width, h = this.#spec.height;
    const stripeH = h * cfg.heightFactor;

    noStroke();
    rectMode(CENTER);
    fill(this.#withAlpha(CAR_MATERIALS.stripeFill, cfg.alpha));
    rect(0, 0, w * cfg.widthFactor, stripeH, stripeH * 0.3);

    fill(this.#palette.dark);
    textAlign(CENTER, CENTER);
    textSize(stripeH * 0.75);
    text(this.#markingText, 0, 0);
  }

  #drawCockpit() {
    const cfg = CAR_RENDER_CONFIG.cockpit;
    const w = this.#spec.width, h = this.#spec.height;
    const cx = -w * cfg.rearOffsetFactor; // slightly REAR of centre (rear = local -X)
    const rx = w * cfg.rxFactor, ry = h * cfg.ryFactor;

    push();
    translate(cx, 0);

    noStroke();
    fill(CAR_MATERIALS.cockpitFill);
    ellipse(0, 0, rx * 2, ry * 2);

    noFill();
    stroke(CAR_MATERIALS.cockpitStroke);
    strokeWeight(1.2);
    ellipse(0, 0, rx * 2, ry * 2);

    // Seat back: thick curved stroke on the REAR side of the recess.
    stroke(CAR_MATERIALS.seatBack);
    strokeWeight(cfg.seatBackWeight);
    strokeCap(ROUND);
    noFill();
    arc(0, 0, rx * 1.3, ry * 1.5, HALF_PI, HALF_PI + PI);

    // Steering wheel: forward of centre within the recess.
    const wheelX = rx * cfg.wheelForwardOffsetFactor * 4;
    noFill();
    stroke(CAR_MATERIALS.wheelStroke);
    strokeWeight(1.4);
    circle(wheelX, 0, cfg.wheelRadius * 2);
    noStroke();
    fill(CAR_MATERIALS.wheelStroke);
    circle(wheelX, 0, cfg.wheelRadius * 0.5);

    pop();
  }

  #drawLights(speedFrac) {
    const cfg = CAR_RENDER_CONFIG.headlight;
    const w = this.#spec.width, h = this.#spec.height;
    const nose = w / 2, rear = -w / 2;
    const offsetY = h * cfg.offsetFactor;

    noStroke();
    const bloomAlpha = cfg.bloomBaseAlpha + speedFrac * cfg.bloomSpeedAlphaGain;
    const bloomRadius = cfg.bloomBaseRadius + speedFrac * cfg.bloomSpeedRadiusGain;
    for (const side of [-1, 1]) {
      fill(this.#withAlpha(CAR_MATERIALS.headlightBloom, bloomAlpha));
      circle(nose, side * offsetY, bloomRadius * 2);
      fill(CAR_MATERIALS.headlightCore);
      circle(nose, side * offsetY, cfg.coreRadius * 2);
    }

    const brakeAlpha = this.#brakeActive ? 255 : 0;
    fill(this.#withAlpha(CAR_MATERIALS.brakeLight, brakeAlpha));
    for (const side of [-1, 1]) circle(rear, side * offsetY, cfg.brakeRadius * 2);
  }

  // Open ">" stroke at the nose -- the unambiguous heading indicator. Never
  // a filled triangle: an open chevron reads better at speed.
  #drawChevron() {
    const cfg = CAR_RENDER_CONFIG.chevron;
    const w = this.#spec.width;
    const tipX = w / 2 + w * cfg.offsetFactor;
    const armLen = w * cfg.sizeFactor;
    const backX = tipX - Math.cos(cfg.halfAngle) * armLen;
    const armY = Math.sin(cfg.halfAngle) * armLen;

    noFill();
    stroke(CAR_MATERIALS.chevronColor);
    strokeWeight(cfg.weight);
    strokeCap(ROUND);
    strokeJoin(ROUND);
    beginShape();
    vertex(backX, -armY);
    vertex(tipX, 0);
    vertex(backX, armY);
    endShape();
  }

  // Ceiling pole seen top-down: a small dark base with a bright livery-accent
  // inner dot and a ring, sitting at the rear centre.
  #drawPole() {
    const cfg = CAR_RENDER_CONFIG.pole;
    const w = this.#spec.width;
    const x = -w / 2 + w * 0.08;

    noStroke();
    fill(CAR_MATERIALS.poleOuter);
    circle(x, 0, cfg.outerRadius * 2);

    noFill();
    stroke(CAR_MATERIALS.poleRing);
    strokeWeight(1);
    circle(x, 0, cfg.ringRadius * 2);

    noStroke();
    fill(this.#palette.accent);
    circle(x, 0, cfg.innerRadius * 2);
  }
}
