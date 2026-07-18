/* ============================================================================
   FREE BOUNCE BEHAVIOUR (Mode 4 -- Demolition)
   Never sets velocity -- matter.js's own restitution/friction drives the
   motion (bouncy, chaotic, decaying only via frictionAir) instead of a
   scripted heading/speed overriding it every frame, the way
   StraightBehaviour/SineBehaviour do. CarFactory gives the car a one-time
   initial velocity kick at spawn; everything after that is pure physics.

   It DOES still track heading, though -- every frame, heading is snapped to
   the car's actual velocity direction. This matters: TyreModel decomposes
   velocity relative to `car.heading` to figure out what's "forward" versus
   "lateral slip". A behaviour that never updates heading leaves it stuck at
   whatever it was after the last collision-policy snap, while the real
   post-bounce velocity vector keeps changing -- TyreModel then reads almost
   all of that velocity as sideways slip and cancels it, killing the car
   dead on first contact. Tracking heading = velocity direction here is what
   keeps grip correction inert for a purely physics-driven car, which is
   what "physics owns this car's motion" actually requires in practice.
   ============================================================================ */
class FreeBounceBehaviour {
  update(opponent) {
    const v = opponent.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > 0.4) {
      opponent.setHeadingAngle(Math.atan2(v.y, v.x));
    }
  }

  onHeadingShift(_deltaAngle) { /* no base heading to track */ }
}
