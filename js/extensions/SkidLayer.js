/* ============================================================================
   SKID LAYER (Extension 2, part B -- persistent skid-mark render target)

   A single off-screen p5.Graphics buffer that accumulates skid marks across
   an entire mode session. This is a render-target technique, not per-frame
   redrawing: marks are stamped once when laid down, and the WHOLE buffer is
   uniformly faded a little every frame via p5's erase() mode, rather than
   every individual mark being tracked/aged/redrawn. That's what lets the
   arena floor accumulate a visible "history" of the fight cheaply.
   ============================================================================ */
class SkidLayer {
  #graphics;

  constructor() {
    this.#graphics = createGraphics(CANVAS_W, CANVAS_H);
    this.#graphics.clear();
  }

  get graphics() { return this.#graphics; }

  stamp(x, y, heading, alpha) {
    const g = this.#graphics;
    g.push();
    g.translate(x, y);
    g.rotate(heading);
    g.noStroke();
    g.fill(15, 15, 18, alpha);
    g.ellipse(0, 0, 6, 2.5);
    g.pop();
  }

  // erase()/noErase() is p5's render-target alpha-erase mode: it reduces the
  // existing pixels' alpha by `strength` wherever the following shape is
  // drawn, instead of painting black over them (which would just tint the
  // floor grey over time). One rect covering the whole buffer each frame
  // fades everything uniformly and cheaply.
  fade() {
    const g = this.#graphics;
    g.erase(SKID_CONFIG.fadeAmount, 255);
    g.noStroke();
    g.rect(0, 0, g.width, g.height);
    g.noErase();
  }

  // Reused (not recreated) across mode switches -- GameManager calls this on
  // setMode() so old marks don't bleed into a new session without allocating
  // a fresh graphics buffer every time (which would leak canvas memory).
  clear() {
    this.#graphics.clear();
  }
}
