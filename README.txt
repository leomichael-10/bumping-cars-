DODGEM ARENA SIMULATION
========================

HOW TO RUN
----------
Open index.html directly in a browser (Chrome/Edge/Firefox). No server,
no build step, no internet connection required -- p5.js and matter.js are
vendored locally in /lib.

CONTROLS
--------
Arrow Up / Down   Throttle forward / reverse
Arrow Left/Right  Steer (only effective while moving)
I                 Arm spawn, then click inside the Start Zone to place your car
D                 Toggle debug ray visualisation (Hunter mode only)

MODES
-----
1   Practice           -- opponents parked static in the Start Zone
2   Random Opponents    -- opponents cruise on random straight paths
3   Advanced (Sine)      -- opponents weave on sine-wave trajectories
4   Demolition          -- high-restitution arcade chaos, cars ricochet freely

SURVIVAL ROUND
--------------
H   Start a Survival round -- the nearest Standard opponent becomes the
    Hunter and gives chase. Survive 60 seconds without your damage
    reaching 100% or getting caught to win. Requires a spawned player car.
R   Reset the round after it ends (win/loss), before starting a new one.
