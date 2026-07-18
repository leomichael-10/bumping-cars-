/*

   This file is intentionally thin: it only wires up the p5.js lifecycle
   (setup/draw/input) to GameManager. All simulation logic lives in js/.
   ============================================================================ */

let gameManager;

function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  gameManager = new GameManager();
  gameManager.init();
}

function draw() {
  gameManager.update();
  gameManager.draw();
  HUD.draw(gameManager);
}

function keyPressed() {
  if (key === "i" || key === "I") {
    gameManager.armSpawn();
  } else if (key === "1") {
    gameManager.setMode(MODE.PRACTICE);
  } else if (key === "2") {
    gameManager.setMode(MODE.RANDOM);
  } else if (key === "3") {
    gameManager.setMode(MODE.ADVANCED);
  } else if (key === "4") {
    gameManager.setMode(MODE.DEMOLITION);
  } else if (key === "h" || key === "H") {
    gameManager.startSurvivalRound();
  } else if (key === "r" || key === "R") {
    gameManager.resetSurvivalRound();
  } else if (key === "d" || key === "D") {
    gameManager.toggleDebugRays();
  }
}

function mousePressed() {
  gameManager.trySpawnPlayerAt(mouseX, mouseY);
}

/* ============================================================================
   COMMENTARY (required, <=500 words)
   ============================================================================

   1. PHYSICS (brief)
   Restitution/friction live in per-mode PHYSICS_PROFILES (config.js):
   "standard" (modes 1-3) mirrors the project's original absorbed-impact
   numbers exactly; "demolition" (mode 4) is far more elastic. GameManager
   applies the active profile to barrier and car bodies when a mode is
   built, so nothing mode-specific is hardcoded elsewhere. Throttle is
   force-based; clampSpeed() dot-products velocity with heading to classify
   forward/reverse before rescaling to the relevant max.

   2. OPPONENT LOGIC, MODES 2/3 (brief)
   CarFactory rejection-samples spawn points clear of the Start Zone and
   separated from placed cars. Mode 2 force-sets velocity from a fixed
   heading/speed each frame; Mode 3 adds heading = baseHeading + sin(phase)
   * amplitude, so speed stays constant "by construction"; both implement
   onHeadingShift(). Mode 4 instead uses FreeBounceBehaviour, a deliberate
   no-op -- an initial kick at spawn, then pure physics.

   3. ANIMATIONS (brief)
   Trail is a per-car ring buffer of {x,y,speed}; ImpactFlash/BarrierPulse
   are self-contained classes fed a real contact point, scaled by a
   profile's visualIntensityScale (bigger/faster in Demolition) and by a
   screen-shake accumulator driven by frame impulse.

   4. CREATIVE EXTENSION -- vehicle dynamics + persistent damage, harnessed
   by Survival Mode (largest share here). All three edit the simulation
   BELOW matter.js's convenience API.

   DamageModel captures each body's pristine polygon in a LOCAL frame, then
   pushes vertices inward -- along their OWN radial direction toward the
   centroid -- by a Gaussian falloff kernel centred on the contact, so
   nearby vertices dent hard and distant ones barely move; sliding only
   along a fixed angular ray, clamped to a minimum radius, means the
   polygon can never self-intersect or invert, which would break the SAT
   solver. Two parallel vertex sets give squash-and-stretch AND permanent
   damage from one mechanism: #liveVerts springs quickly toward #permVerts
   (the lasting dent), which itself creeps very slowly back toward rest --
   light taps buff out, heavy hits stay. The live shape is pushed into the
   body every frame via Body.setVertices(), which recomputes mass/inertia
   and silently re-centres it; position/angle are restored so denting never
   teleports the car. Crucially, deformation is driven by APPROACH VELOCITY
   (closing speed along the collision normal, sampled before the solver
   responds), not post-solve impulse: as restitution rises, more impulse is
   returned as bounce instead of absorbed, so an impulse-driven model would
   have made Demolition's 0.9-restitution hits the LEAST damaging of any
   mode -- backwards. Approach velocity doesn't care what the solver does
   afterward, so a bouncy hit and an absorbed hit at equal closing speed now
   wreck the car comparably.

   TyreModel stops bodies behaving like frictionless pucks: before each
   Engine.update(), it splits velocity into forward/lateral components and
   cancels a fraction of the lateral one via a per-type grip constant (grip
   1 = no slide, Standard 0.86 vs Slow 0.97). SkidLayer stamps marks at the
   four wheel corners into a persistent p5.Graphics buffer once slip exceeds
   threshold, fading every frame via p5's erase() render-target mode.

   RaycastSensor + PursuitBehaviour give the Hunter real navigation: 7 rays
   fanned ~120 degrees through Matter.Query.ray feed an AVOID vector weighted
   by squared ray-closeness, blended with PURSUE (an intercept point from
   velocity x time-to-intercept) and a mild SEPARATE, turned toward with a
   capped turn rate.

   Survival Mode (H) makes the three systems consequential: it ends the
   round at damage 1.0; breaking a Hunter's contact timer is easiest via a
   TyreModel drift; the Hunter's aggression feeds PursuitBehaviour's weights.
   ============================================================================ */
