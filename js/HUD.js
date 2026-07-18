/* ============================================================================
   HUD
   Pure presentation layer: reads GameManager's/Car's public getters and
   draws the overlay. Holds no state of its own.
   ============================================================================ */
class HUD {
  static #MODE_NAMES = {
    1: "Practice",
    2: "Random Opponents",
    3: "Advanced (Sine)",
    4: "Demolition"
  };

  static draw(gameManager) {
    HUD.#drawPanel(gameManager);
    if (gameManager.spawnArmed) HUD.#drawSpawnBanner();
  }

  static #drawPanel(gameManager) {
    push();
    noStroke();
    fill(0, 0, 0, 150);
    rect(0, 0, 300, 230);

    fill(255);
    textSize(14);
    textAlign(LEFT, TOP);

    let y = 10;
    const lineH = 18;

    text(`Mode ${gameManager.mode}: ${HUD.#MODE_NAMES[gameManager.mode]}`, 10, y); y += lineH;
    text(`Spawn armed: ${gameManager.spawnArmed ? "YES (click Start Zone)" : "no (press I)"}`, 10, y); y += lineH;
    text(`Survival: ${HUD.#survivalLabel(gameManager.survivalState)}   Debug rays: (D)`, 10, y); y += lineH;
    text(`Player active: ${gameManager.player ? "yes" : "no"}`, 10, y); y += lineH * 1.1;

    y = HUD.#drawSpeedBar(gameManager, 10, y) + 6;
    y = HUD.#drawDamageBar(gameManager, 10, y) + 6;
    y = HUD.#drawSlipIndicator(gameManager, 10, y) + 10;

    textSize(12);
    fill(200);
    text("Arrows: throttle / steer   1/2/3: mode   I: arm spawn   H: survival   R: reset round", 10, y);
    pop();
  }

  static #survivalLabel(state) {
    switch (state) {
      case "ACTIVE": return "ACTIVE (H locked)";
      case "WON": return "SURVIVED";
      case "LOST_DAMAGE": return "DESTROYED";
      case "LOST_CAUGHT": return "CAUGHT";
      default: return "idle (H to start)";
    }
  }

  static #drawSpeedBar(gameManager, x, y) {
    const barW = 150;
    const barH = 10;
    const speed = gameManager.player ? gameManager.player.speed : 0;
    const maxSpeed = gameManager.player ? gameManager.player.spec.maxForwardSpeed : 9;
    const frac = constrain(speed / maxSpeed, 0, 1);

    fill(255);
    textSize(13);
    text(`Speed: ${speed.toFixed(2)}`, x, y);

    const barY = y + 17;
    noStroke();
    fill(255, 255, 255, 40);
    rect(x, barY, barW, barH, 4);
    fill(lerpColor(color(90, 220, 120), color(230, 70, 60), frac));
    rect(x, barY, barW * frac, barH, 4);
    return barY + barH;
  }

  static #drawDamageBar(gameManager, x, y) {
    const barW = 150;
    const barH = 10;
    const player = gameManager.player;
    const damage = player ? player.damage : 0;
    const flashing = player ? player.recentlyHit : false;

    fill(flashing ? color(255, 255, 255) : color(255));
    textSize(13);
    text(`Damage: ${(damage * 100).toFixed(0)}%`, x, y);

    const barY = y + 17;
    noStroke();
    fill(255, 255, 255, 40);
    rect(x, barY, barW, barH, 4);

    // Past 0.7 damage the bar commits hard to red (a real warning, not a
    // gradient reading) instead of continuing to lerp toward it.
    const fillColour = damage > 0.7
      ? color(230, 20, 20)
      : lerpColor(color(230, 200, 60), color(200, 30, 30), damage / 0.7);
    fill(fillColour);
    rect(x, barY, barW * damage, barH, 4);

    if (flashing) {
      noFill();
      stroke(255, 255, 255, 200);
      strokeWeight(2);
      rect(x, barY, barW, barH, 4);
      noStroke();
    }
    return barY + barH;
  }

  static #drawSlipIndicator(gameManager, x, y) {
    const sliding = gameManager.player ? gameManager.player.isSliding : false;
    const slip = gameManager.player ? gameManager.player.slipRatio : 0;

    noStroke();
    fill(sliding ? color(255, 120, 40) : color(150));
    textSize(13);
    text(`Grip: ${sliding ? "SLIDING" : "gripped"} (slip ${(slip * 100).toFixed(0)}%)`, x, y);
    return y + 4;
  }

  static #drawSpawnBanner() {
    push();
    noStroke();
    fill(255, 230, 90);
    textAlign(CENTER);
    textSize(16);
    text("SPAWN ARMED - click inside the Start Zone", CANVAS_W / 2, 20);
    pop();
  }
}
