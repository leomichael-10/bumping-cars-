/* ============================================================================
   STATIC BEHAVIOUR (Mode 1 -- Practice)
   Parked opponents. Matter.js's own isStatic flag stops physical motion, so
   this behaviour intentionally does nothing each frame -- it exists so
   OpponentCar always has a well-defined current behaviour to call into.
   ============================================================================ */
class StaticBehaviour {
  update(_opponent) { /* no-op: body is static */ }
  onHeadingShift(_deltaAngle) { /* no-op: no base heading to track */ }
}
