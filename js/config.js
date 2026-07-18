/* ============================================================================
   CONFIG -- all tunable constants live here so gameplay feel and visual style
   can be tuned from a single file without touching logic elsewhere.
   Deliberately has NO dependency on p5.js globals (color(), etc.) because it
   loads before p5 finishes auto-instantiating -- palettes are plain hex
   strings, converted to p5 color objects at draw time by Car.js.
   ============================================================================ */

// ---- Matter.js module aliases (used across every other file) -------------
const Bodies = Matter.Bodies;
const Body = Matter.Body;
const World = Matter.World;
const Vector = Matter.Vector;
const Events = Matter.Events;
const Engine = Matter.Engine;
const Query = Matter.Query;
const Composite = Matter.Composite;

// ---- Canvas / arena geometry ----------------------------------------------
const CANVAS_W = 1400;
const CANVAS_H = 700;
const ARENA_MARGIN = 60;
const WALL_THICKNESS = 28;

const ARENA_CONFIG = {
  x: ARENA_MARGIN,
  y: ARENA_MARGIN,
  width: CANVAS_W - ARENA_MARGIN * 2,
  height: CANVAS_H - ARENA_MARGIN * 2,
  wallThickness: WALL_THICKNESS
};

const START_ZONE_CONFIG = {
  marginX: 20,
  marginY: 20,
  width: 220
};

// Barrier friction is uniform across every mode -- only restitution varies
// per physics profile (see PHYSICS_PROFILES below).
const BARRIER_FRICTION = 0.4;

// ---- Per-mode physics profiles ----------------------------------------------
// GameManager applies one of these wholesale when a mode is built: to the
// barrier bodies (restitution) and to every car body (restitution, and
// optionally friction/frictionAir -- null means "leave each CAR_TYPE's own
// per-type value alone", which is what modes 1-3 do so Standard/Slow keep
// their differentiated handling). Demolition overrides friction/frictionAir
// uniformly across types, trading that differentiation for arcade chaos.
//
// "standard" intentionally mirrors the exact values this project already
// used before per-mode profiles existed (barrier restitution 0.48, car
// restitution 0.35, per-type friction/frictionAir untouched) -- modes 1-3
// must stay bit-for-bit identical, so nothing here is allowed to drift from
// those numbers.
const PHYSICS_PROFILES = {
  standard: {
    barrierRestitution: 0.48,
    carRestitution: 0.35,
    carFriction: null,
    carFrictionAir: null,
    carGrip: null,              // null = use each CAR_TYPE's own grip (0.86 standard / 0.97 slow)
    throttleForceMultiplier: 1, // no boost -- engineForce applies exactly as specified per type
    damageScale: 1.0,
    dentPushMultiplier: 1.0,
    recoveryRateMultiplier: 1.0,
    bounceKick: 0,
    bounceKickSpeedThreshold: Infinity,
    initialSpeedFactor: 0,      // unused outside demolition's opponent spawn kick
    maxSpeed: Infinity,
    engineSubsteps: 1,
    allowSleeping: false,       // matches matter.js's own Engine.create() default
    visualIntensityScale: 1.0,
    screenShakeScale: 1.0
  },
  demolition: {
    barrierRestitution: 0.9,
    carRestitution: 0.88,
    carFriction: 0.02,          // lower -- cars skate and keep momentum
    carFrictionAir: 0.006,      // much lower -- momentum persists for seconds, not one hop
    // A skating-rink grip, uniform across types regardless of steering.
    // NOTE on the number: TyreModel.apply() actually RETAINS `grip` fraction
    // of the lateral component each frame (grippedLateral = lateral * grip),
    // so grip close to 1 means "almost nothing corrected -- keeps sliding"
    // and grip close to 0 means "fully corrected -- full traction". That is
    // backwards from the plain-English word and from TyreModel's own
    // docstring (fixed as a comment-only correction, not a formula change --
    // CAR_TYPES.standard/slow's grip values were tuned against the CURRENT
    // formula regardless of how it's labelled, so flipping the formula would
    // silently retune modes 1-3 handling). A HIGH value here is what actually
    // produces "slides constantly": 0.15 would have done the opposite (85%
    // of lateral motion cancelled every frame -- more traction, not less).
    carGrip: 0.97,
    throttleForceMultiplier: 1.6, // RAM_BOOST -- punchier throttle, hits land harder
    damageScale: 1.0,           // kept at parity with "standard" -- see commentary: approach-velocity
                                 // decoupling means damage no longer depends on restitution at all,
                                 // so no compensating factor is needed here.
    dentPushMultiplier: 1.6,    // bigger transient (visual) deformation per hit
    recoveryRateMultiplier: 1.7,// faster spring-back -- a visible "pop" rather than a slow settle
    bounceKick: 0.15,           // extra over-unity nudge along the collision normal, car-car only
    bounceKickSpeedThreshold: 3,// minimum approach speed before the kick applies
    initialSpeedFactor: 0.5,    // opponents spawn already moving, physics-driven from the start
    maxSpeed: 18,               // ~2x a standard car's own maxForwardSpeed (9) -- also the tunnelling guard
    engineSubsteps: 2,          // half-step twice per frame -- high restitution + speed tunnels otherwise
    allowSleeping: false,
    visualIntensityScale: 1.6,
    screenShakeScale: 1.8
  }
};

// Set true to log spawn-time physics values, active behaviour class, and
// periodic slip ratios to the console -- diagnostic only, off by default.
const DEBUG_PHYSICS = false;

const SCREEN_SHAKE_CONFIG = {
  impulseThreshold: 6,  // summed per-frame collision intensity below this triggers no shake
  gain: 1.4,            // how strongly excess impulse converts into shake magnitude
  maxMagnitude: 14,      // px, hard ceiling
  decay: 0.85            // per-frame multiplicative decay
};

// ---- Required global: number of opponent cars -----------------------------
var carNumbers = 4;

// ---- Car type specs --------------------------------------------------------
// NOTE on naming: `width` is the car's LENGTH (its extent along the heading,
// since a car at heading 0 faces +X) and `height` is its LENGTH's
// perpendicular -- its actual side-to-side WIDTH. This matches the existing
// Bodies.rectangle(x, y, width, height) convention used everywhere else in
// the codebase (TyreModel, wheel positions, etc.), so the art-direction
// spec's "CAR_LENGTH"/"CAR_WIDTH" map onto `width`/`height` respectively.
const CAR_TYPES = {
  standard: {
    width: 56, height: 40,       // sleeker, longer than wide
    density: 0.0018,
    frictionAir: 0.06,
    friction: 0.02,
    restitution: 0.35,
    engineForce: 0.011,
    maxForwardSpeed: 9,
    maxReverseSpeed: 4.5,
    turnRate: 0.045,
    grip: 0.86,          // tyre grip -- lower means more lateral slide (drift)
    slipThreshold: 0.16, // |lateral|/|speed| above which the tyre is "sliding"
    chamferRadiusFactor: 0.34, // hull corner radius, relative to `height` -- lozenge silhouette
    shellInsetFactor: 1.0,     // multiplier on CAR_RENDER_CONFIG.shell's base ratios
    rivetSizeFactor: 1.0
  },
  slow: {
    // Heavier + weaker engine (visibly slower); squat, near-square silhouette
    // with a chunkier bumper and heavier rivets, so the type reads at a
    // glance from silhouette ALONE, before colour or motion. High grip means
    // it plows/understeers instead of drifting -- a felt handling difference,
    // not just a speed difference.
    width: 52, height: 46,
    density: 0.0034,
    frictionAir: 0.09,
    friction: 0.03,
    restitution: 0.35,
    engineForce: 0.0065,
    maxForwardSpeed: 5,
    maxReverseSpeed: 2.5,
    turnRate: 0.038,
    grip: 0.97,
    slipThreshold: 0.3,
    chamferRadiusFactor: 0.34,
    shellInsetFactor: 1.3,  // shell sits further inside the hull -- reads as a thicker bumper
    rivetSizeFactor: 1.3
  }
};

// ---- Colour palettes (base/light/dark/accent) -- every drawn colour in
// Car.js derives from one of these or from CAR_MATERIALS; no hex literals
// appear in the drawing code itself. --------------------------------------
const CAR_PALETTES = {
  player: { dark: "#8E1F1F", base: "#D93636", light: "#F26161", accent: "#FFD34D" },
  blue:   { dark: "#14487A", base: "#2E7FD0", light: "#6BB0F0", accent: "#BFE3FF" },
  green:  { dark: "#1E5C2A", base: "#3E9E52", light: "#7FD08E", accent: "#D6F5DC" },
  amber:  { dark: "#8A5A0B", base: "#D69220", light: "#F0BE5E", accent: "#FFEBC2" },
  violet: { dark: "#4A2472", base: "#8148C2", light: "#B48AE0", accent: "#E6D5FA" }
};

const OPPONENT_PALETTE_SEQUENCE = ["blue", "green", "amber", "violet"];
const OPPONENT_TYPE_SEQUENCE = ["standard", "standard", "slow", "slow"];
const OPPONENT_MARKING_SEQUENCE = ["2", "3", "4", "5"]; // player is always "P1"

// ---- Shared, non-livery material colours (rubber, glass, metal, lights) ----
const CAR_MATERIALS = {
  bumperFill: "#26262B",
  bumperStroke: "#4A4A52",
  bumperHighlight: "#6E6E78",
  rivetTop: "#5C5C66",
  rivetBottom: "#48484F",
  cockpitFill: "#1A1A1E",
  cockpitStroke: "#3D3D44",
  seatBack: "#55555E",
  wheelStroke: "#6E6E78",
  stripeFill: "#F5F0E6",
  chevronColor: "#FFD34D",
  headlightCore: "#FFF3C4",
  headlightBloom: "#FFE066",
  brakeLight: "#E62020",
  poleOuter: "#1A1A1E",
  poleRing: "#4A4A52",
  shadowColor: "#000000"
};

// ---- Car rendering geometry/tuning -- every ratio the draw pipeline uses ----
const CAR_RENDER_CONFIG = {
  shadow: { rxFactor: 0.54, ryFactor: 0.54, offset: 3, alpha: 46, speedGrowth: 0.10 },
  hull: { strokeWeight: 2, highlightAlpha: 140, highlightWeight: 3 },
  rivets: { count: 5, radiusFactor: 0.09, spanFactor: 0.62 },
  shell: {
    rearInsetFactor: 0.12, sideInsetFactor: 0.12, frontInsetFactor: 0.30,
    noseWidthFactor: 0.55, sampleCount: 14,
    rimHighlightAlpha: 178, rimHighlightWeight: 2.5, innerShadowWeight: 2
  },
  stripe: { heightFactor: 0.17, widthFactor: 0.7, alpha: 230 },
  cockpit: {
    rxFactor: 0.19, ryFactor: 0.15, rearOffsetFactor: 0.08,
    seatBackWeight: 7, wheelRadius: 5, wheelForwardOffsetFactor: 0.05
  },
  headlight: {
    offsetFactor: 0.35, coreRadius: 4,
    bloomBaseRadius: 6, bloomSpeedRadiusGain: 10,
    bloomBaseAlpha: 60, bloomSpeedAlphaGain: 120,
    brakeRadius: 4
  },
  chevron: { offsetFactor: 0.06, sizeFactor: 0.16, halfAngle: 0.6, weight: 4 },
  pole: { outerRadius: 3.2, innerRadius: 1.4, ringRadius: 4.4 }
};

// ---- Modes -------------------------------------------------------------------
const MODE = {
  PRACTICE: 1,
  RANDOM: 2,
  ADVANCED: 3,
  DEMOLITION: 4
};

// ---- Spawn / motion tuning ----------------------------------------------------
const SPAWN_SEPARATION = 70;        // min distance between opponents when spawning
const PLAYER_SPAWN_SEPARATION = 60; // min distance required for a valid player spawn

const OPPONENT_MOTION = {
  cruiseSpeedFactor: 0.55,   // fraction of a car's max forward speed used in modes 2/3
  sineAmplitude: 0.55,       // radians of lateral heading swing in mode 3
  sineFrequency: 0.045,      // radians/frame phase advance in mode 3
  hunterSpeedFactor: 0.62,   // cruise speed used while in hunter/pursuit mode
  hunterMaxTurnRate: 0.04,   // capped turn rate (rad/frame) for pursuit steering
  hunterPredictionFrames: 26 // how far ahead (frames) the hunter predicts the player's position
};

// ---- Motion-reactive rendering tuning -----------------------------------------
const CAR_FX = {
  brakeDecelThreshold: 0.35, // speed drop/frame that counts as "hard braking"
  idleBobAmplitude: 1,       // px
  idleBobSpeedThreshold: 0.3,
  rollMaxAngle: 0.07,        // ~4 degrees, radians
  rollAngularVelScale: 6
};

// ---- Extension 1: vertex-level deformation (see js/extensions/DamageModel.js) --
const DAMAGE_CONFIG = {
  minRadiusFraction: 0.55,   // a vertex can never be pushed closer than this fraction of its rest radius
  quickRecoveryRate: 0.14,   // per-frame lerp of the live (rendered/physics) hull toward the permanent set
  slowRecoveryRate: 0.0016,  // per-frame lerp of the permanent set back toward the pristine rest shape
  permanentSetFraction: 0.32,// fraction of each impact's push that becomes lasting damage
  falloffSigmaFactor: 0.6,   // gaussian falloff width, relative to each vertex's own rest radius
  maxPushFraction: 0.3,      // per-impact cap on how far a single vertex can move, relative to its rest radius
  frictionAirPenalty: 0.6,   // effective frictionAir = base * (1 + damage * this)
  steeringBiasScale: 0.05,   // max random steering noise injected at damage = 1
  // Pure difficulty tuning on top of the physical deformation measurement --
  // calibrated (see calibration notes in the commentary) so a run of solid,
  // near-max-impulse car-car hits destroys the car in roughly 6 hits.
  damageScalarGain: 3
};

// ---- Extension 2: tyre grip / skid marks (see js/extensions/TyreModel.js, SkidLayer.js) --
const SKID_CONFIG = {
  fadeAmount: 3,        // p5.Graphics erase() strength per frame -- slow accumulation, not instant marks
  markAlphaBase: 40,
  markAlphaSlipScale: 130
};

// ---- Extension 3: raycast-guided pursuit (see js/extensions/RaycastSensor.js, PursuitBehaviour.js) --
const RAYCAST_CONFIG = {
  rayCount: 7,
  fanAngle: Math.PI * (2 / 3), // ~120 degrees total spread, fanned about the heading
  range: 220
};

const PURSUIT_WEIGHTS = {
  pursue: 1.0,
  avoid: 1.4,
  separate: 0.6,
  separationRadius: 90
};

// Barrier hits deal less DamageModel impulse than car-car hits, so grazing
// the wall is a viable (if imperfect) escape tool during Survival Mode
// rather than an equally costly mistake. Applied by CollisionManager to the
// impulse estimate it already derives from impact speed.
const COLLISION_IMPULSE_SCALE = {
  wall: 0.5,
  car: 1.0
};

// ---- Survival Mode (see js/SurvivalMode.js) ------------------------------------
const SURVIVAL_CONFIG = {
  durationMs: 60000,
  catchContactMs: 600,        // continuous hunter-player contact needed to be CAUGHT
  catchImpulseThreshold: 12,  // OR a single hit at/above this impulse estimate is an instant catch
  secondHunterTimeMs: 40000,  // a second hunter joins at this elapsed time
  // Hunter aggression escalates by interpolating between these two profiles
  // over the round's duration -- t=0 is "stalking", t=durationMs is "aggressive".
  escalation: {
    stalking: {
      speedFactor: 0.52,     // fraction of the hunter's own maxForwardSpeed
      maxTurnRate: 0.026,    // rad/frame steering cap
      leadFrames: 14,        // how far ahead the intercept prediction looks
      weights: { pursue: 0.75, avoid: 1.5, separate: 0.6 }
    },
    aggressive: {
      speedFactor: 0.8,
      maxTurnRate: 0.052,
      leadFrames: 36,
      weights: { pursue: 1.35, avoid: 1.05, separate: 0.6 }
    }
  },
  reticlePulseMinHz: 1.2,     // reticle pulse speed with no contact
  reticlePulseMaxHz: 5,       // reticle pulse speed at full grapple-meter contact duration
  vignetteMaxDistance: 420    // beyond this distance to the nearest hunter, no threat vignette
};
