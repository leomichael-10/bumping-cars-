/* ============================================================================
   DAMAGE MODEL (Extension 1 -- vertex-level persistent deformation)

   Composed by Car, one instance per body. This does not sit on top of
   matter.js's convenience API: it edits the body's actual collision polygon
   at runtime via Body.setVertices(), so a dent is not a decal -- subsequent
   collisions genuinely resolve against the damaged hull.

   Two parallel vertex sets model "squash-and-stretch now, permanent dent
   later" with a single mechanism:
     - #liveVerts  : what's currently rendered AND what the physics body uses.
                     Springs quickly toward #permVerts (short-term deformation).
     - #permVerts  : the lasting damage. Springs extremely slowly toward the
                     pristine #restVerts (so light taps eventually buff out,
                     heavy ones don't within a play session).
   ============================================================================ */
class DamageModel {
  #body;
  #profile;
  #restVerts = [];  // pristine local-frame offsets from centroid, heading-independent
  #restRadii = [];
  #liveVerts = [];
  #permVerts = [];
  #damage = 0;
  #hitFlashFrames = 0; // brief "just took a hit" signal, read by HUD to flash the damage bar

  constructor(body, headingAtBuild, profile) {
    this.#body = body;
    this.#profile = profile;

    // Capture the pristine shape in a LOCAL frame: subtract the body's
    // current position, then rotate by -heading, so the shape is described
    // independent of the body's orientation at any later point in time.
    const cx = body.position.x;
    const cy = body.position.y;
    const cos = Math.cos(-headingAtBuild);
    const sin = Math.sin(-headingAtBuild);

    for (const v of body.vertices) {
      const dx = v.x - cx;
      const dy = v.y - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      this.#restVerts.push({ x: lx, y: ly });
      this.#restRadii.push(Math.hypot(lx, ly) || 1);
    }
    this.#liveVerts = this.#restVerts.map(v => ({ ...v }));
    this.#permVerts = this.#restVerts.map(v => ({ ...v }));
  }

  get damage() { return this.#damage; }

  // True for a handful of frames right after a non-trivial impact -- purely
  // a UI signal (HUD flashes the damage bar on it), computed from the same
  // registerImpact call that already knows whether a hit actually landed.
  get recentImpact() { return this.#hitFlashFrames > 0; }

  // Already local-frame offsets, so Car can hand these straight to
  // beginShape()/vertex() inside its own rotated drawing context.
  get localVertices() { return this.#liveVerts; }

  // worldContactPoint / impactMagnitude come from CollisionManager, and are
  // now derived from APPROACH VELOCITY (closing speed along the collision
  // normal, sampled at collisionStart before the solver responds) rather
  // than post-solve impulse. That decoupling matters: with restitution as
  // high as Demolition's, most of that impulse gets RETURNED to the bodies
  // as bounce instead of absorbed, so an impulse-driven damage model would
  // have made the bounciest mode the least damaging -- exactly backwards.
  // Approach velocity doesn't care what the solver does afterward, so a
  // 0.9-restitution hit and a 0.4-restitution hit at the same closing speed
  // now do comparable damage; only the bounce differs.
  registerImpact(worldContactPoint, impactMagnitude) {
    if (!isFinite(impactMagnitude)) return; // rests/grazes must never accumulate damage

    const angle = this.#body.angle;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = worldContactPoint.x - this.#body.position.x;
    const dy = worldContactPoint.y - this.#body.position.y;
    const localContact = { x: dx * cos - dy * sin, y: dx * sin + dy * cos };

    const pushStrength = constrain(impactMagnitude * this.#profile.damageScale, 0, 14);
    if (pushStrength < 0.4) return; // ignore negligible taps

    for (let i = 0; i < this.#restVerts.length; i++) {
      this.#deformVertex(i, localContact, pushStrength);
    }
    this.#recomputeDamageScalar();
    this.#hitFlashFrames = 12;
  }

  // Gaussian falloff kernel centred on the local contact point: vertices
  // near the impact deform the most, neighbours deform progressively less.
  #deformVertex(index, localContact, pushStrength) {
    const rest = this.#restVerts[index];
    const restRadius = this.#restRadii[index];
    const distToContact = Math.hypot(rest.x - localContact.x, rest.y - localContact.y);
    const sigma = Math.max(restRadius * DAMAGE_CONFIG.falloffSigmaFactor, 4);
    const weight = Math.exp(-(distToContact * distToContact) / (2 * sigma * sigma));
    if (weight < 0.02) return;

    // Push purely along this vertex's own radial (outward) direction,
    // negated -- i.e. straight toward the centroid. This is what guarantees
    // vertices can only move along a fixed angular ray from the centre, so
    // their angular ORDER around the polygon never changes: the outline
    // stays a simple (non-self-intersecting) polygon and can't invert or
    // break the SAT collision solver, regardless of how it's dented.
    const inward = { x: -rest.x / restRadius, y: -rest.y / restRadius };
    const maxPush = restRadius * DAMAGE_CONFIG.maxPushFraction;
    const basePush = Math.min(pushStrength * weight, maxPush);
    const minRadius = restRadius * DAMAGE_CONFIG.minRadiusFraction;

    // dentPushMultiplier only exaggerates the LIVE (transient/visual) pop --
    // the permanent set below is still derived from the un-multiplied
    // basePush, so a bouncier profile doesn't also mean faster wrecking;
    // damageScale (applied to pushStrength above) is what governs that.
    const livePush = basePush * this.#profile.dentPushMultiplier;
    this.#liveVerts[index] = this.#pushRadially(this.#liveVerts[index], inward, livePush, minRadius);

    const permPush = basePush * DAMAGE_CONFIG.permanentSetFraction;
    this.#permVerts[index] = this.#pushRadially(this.#permVerts[index], inward, permPush, minRadius);
  }

  #pushRadially(vertex, inwardDir, amount, minRadius) {
    let nx = vertex.x + inwardDir.x * amount;
    let ny = vertex.y + inwardDir.y * amount;
    const radius = Math.hypot(nx, ny);
    if (radius < minRadius) {
      const scale = minRadius / (radius || 1);
      nx *= scale;
      ny *= scale;
    }
    return { x: nx, y: ny };
  }

  #recomputeDamageScalar() {
    let totalDeform = 0;
    for (let i = 0; i < this.#restVerts.length; i++) {
      totalDeform += Math.hypot(
        this.#restVerts[i].x - this.#permVerts[i].x,
        this.#restVerts[i].y - this.#permVerts[i].y
      );
    }
    const avgRadius = this.#restRadii.reduce((a, b) => a + b, 0) / this.#restRadii.length;
    const avgDeform = totalDeform / this.#restVerts.length;
    // damageScalarGain is a pure difficulty tuning knob (see config.js) --
    // it scales the same physical deformation measurement, it doesn't change
    // what's being measured.
    this.#damage = constrain((avgDeform / (avgRadius * 0.6)) * DAMAGE_CONFIG.damageScalarGain, 0, 1);
  }

  // Elastic recovery, then rebuild the actual matter.js collision shape from
  // the live vertex list every frame, so the physics body and the rendered
  // hull are always literally the same data.
  update() {
    // Same mechanism as standard, just a faster spring-back in bouncier
    // profiles (clamped well below 1 so it can never overshoot/oscillate).
    const quickRate = Math.min(DAMAGE_CONFIG.quickRecoveryRate * this.#profile.recoveryRateMultiplier, 0.9);

    for (let i = 0; i < this.#liveVerts.length; i++) {
      const live = this.#liveVerts[i];
      const perm = this.#permVerts[i];
      live.x += (perm.x - live.x) * quickRate;
      live.y += (perm.y - live.y) * quickRate;

      const rest = this.#restVerts[i];
      perm.x += (rest.x - perm.x) * DAMAGE_CONFIG.slowRecoveryRate;
      perm.y += (rest.y - perm.y) * DAMAGE_CONFIG.slowRecoveryRate;
    }
    this.#recomputeDamageScalar();
    this.#applyLiveShapeToBody();
    if (this.#hitFlashFrames > 0) this.#hitFlashFrames--;
  }

  #applyLiveShapeToBody() {
    const body = this.#body;
    const posBefore = { x: body.position.x, y: body.position.y };
    const angleBefore = body.angle;

    const cos = Math.cos(angleBefore);
    const sin = Math.sin(angleBefore);
    const worldVerts = this.#liveVerts.map(v => ({
      x: posBefore.x + (v.x * cos - v.y * sin),
      y: posBefore.y + (v.x * sin + v.y * cos)
    }));

    Body.setVertices(body, worldVerts);

    // Body.setVertices recomputes area/centroid from the new outline and
    // re-anchors the body there internally, which would otherwise make the
    // car visibly "teleport" a fraction of a pixel every time it dents.
    // Since the outline was already built around posBefore/angleBefore, we
    // simply snap both back -- the dent is purely a shape change, not a
    // position change.
    Body.setPosition(body, posBefore);
    Body.setAngle(body, angleBefore);
  }
}
