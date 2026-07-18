/* ============================================================================
   CAR FACTORY
   Creates Standard/Slow player and opponent cars from the config specs, and
   handles non-overlapping spawn placement so GameManager doesn't need to
   know how bodies or separation checks work. Also owns the currently active
   PHYSICS_PROFILES entry (set by GameManager on every mode switch) so every
   car it builds is constructed under the right restitution/friction rules.
   ============================================================================ */
class CarFactory {
  #profile = PHYSICS_PROFILES.standard;

  constructor(world) {
    this.world = world;
  }

  setPhysicsProfile(profile) {
    this.#profile = profile;
  }

  createPlayer(x, y) {
    return new PlayerCar(x, y, this.world, this.#profile);
  }

  createOpponentSet(mode, arena) {
    if (mode === MODE.PRACTICE) return this.#createParkedOpponents(arena);
    return this.#createMovingOpponents(mode, arena);
  }

  // Two existing cars are considered overlapping if closer than minSeparation.
  overlapsAny(x, y, carsList, minSeparation) {
    for (const car of carsList) {
      if (dist(x, y, car.position.x, car.position.y) < minSeparation) return true;
    }
    return false;
  }

  #createParkedOpponents(arena) {
    const opponents = [];
    const zone = arena.getStartZone();
    const startX = zone.x + 40;
    const gapY = zone.h / (carNumbers + 1);

    for (let i = 0; i < carNumbers; i++) {
      const y = zone.y + gapY * (i + 1);
      const car = new OpponentCar(OPPONENT_TYPE_SEQUENCE[i], OPPONENT_PALETTE_SEQUENCE[i], startX, y, 0, this.world, this.#profile, OPPONENT_MARKING_SEQUENCE[i]);
      Body.setStatic(car.body, true);
      car.setBehavior(new StaticBehaviour());
      opponents.push(car);
    }
    return opponents;
  }

  #createMovingOpponents(mode, arena) {
    const opponents = [];

    for (let i = 0; i < carNumbers; i++) {
      const pos = this.#findNonOverlappingPosition(arena, opponents);
      const heading = random(TWO_PI);
      const car = new OpponentCar(OPPONENT_TYPE_SEQUENCE[i], OPPONENT_PALETTE_SEQUENCE[i], pos.x, pos.y, heading, this.world, this.#profile, OPPONENT_MARKING_SEQUENCE[i]);

      if (mode === MODE.DEMOLITION) {
        // No scripted cruise here -- give it a one-time push and let
        // restitution/friction (and the elastic kick on hard hits) keep it
        // moving from then on, via FreeBounceBehaviour's no-op update().
        const kickSpeed = car.spec.maxForwardSpeed * this.#profile.initialSpeedFactor;
        Body.setVelocity(car.body, { x: Math.cos(heading) * kickSpeed, y: Math.sin(heading) * kickSpeed });
        car.setBehavior(new FreeBounceBehaviour());
      } else {
        const cruiseSpeed = car.spec.maxForwardSpeed * OPPONENT_MOTION.cruiseSpeedFactor;
        car.setBehavior(
          mode === MODE.RANDOM
            ? new StraightBehaviour(cruiseSpeed)
            : new SineBehaviour(cruiseSpeed, heading)
        );
      }
      opponents.push(car);
    }
    return opponents;
  }

  // Rejection-sampling placement: retries until a point clears the arena
  // margin, sits outside the Start Zone, and keeps separation from every
  // already-placed car (the barrier walls are handled by the margin itself).
  #findNonOverlappingPosition(arena, placedCars) {
    const margin = 40;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = random(ARENA_CONFIG.x + margin, ARENA_CONFIG.x + ARENA_CONFIG.width - margin);
      const y = random(ARENA_CONFIG.y + margin, ARENA_CONFIG.y + ARENA_CONFIG.height - margin);
      if (arena.isInsideStartZone(x, y)) continue;
      if (!this.overlapsAny(x, y, placedCars, SPAWN_SEPARATION)) return { x, y };
    }
    // Fallback after exhausting attempts: arena centre (should be effectively unreachable).
    return { x: ARENA_CONFIG.x + ARENA_CONFIG.width / 2, y: ARENA_CONFIG.y + ARENA_CONFIG.height / 2 };
  }
}
