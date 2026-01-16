import { encodeTile, getTileSolid } from "../domain/tile.ts";

export function createDefaultWorld({ gridW, gridH }) {
  const cellCount = gridW * gridH;
  const cells = new Uint32Array(cellCount);

  function setSolid(x, y, dmg = 0, passable = false) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return;
    cells[y * gridW + x] = encodeTile({ damage: dmg, solid: true, passable });
  }

  function getSolid(x, y) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return false;
    return getTileSolid(cells[y * gridW + x]);
  }

  const groundY = gridH - 10;
  for (let y = groundY; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) setSolid(x, y, 0);
  }

  function rect(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) setSolid(x, y, 0);
    }
  }

  function floor(x0, y, w, thickness = 2) {
    for (let t = 0; t < thickness; t++) {
      for (let x = x0; x < x0 + w; x++) setSolid(x, y + t, 0, true);
    }
  }

  function door(x, y, h = 6) {
    for (let dy = 0; dy < h; dy++) {
      setSolid(x, y + dy, 0, true);
      setSolid(x + 1, y + dy, 0, true);
    }
  }

  function column(centerX, topY, bottomY, width = 2) {
    for (let y = topY; y <= bottomY; y++) {
      const hasFloorHere = getSolid(centerX, y) || getSolid(centerX + 1, y);
      const hasFloorLeft = getSolid(centerX - 1, y);
      const hasFloorRight = getSolid(centerX + width, y);
      const atFloor = hasFloorHere || hasFloorLeft || hasFloorRight || y === topY || y === bottomY;

      if (atFloor) {
        for (let w = -1; w < width + 1; w++) {
          if (!getSolid(centerX + w, y)) {
            setSolid(centerX + w, y, 0, true);
          }
        }
      } else {
        const shaftX = centerX + Math.floor(width / 2);
        if (!getSolid(shaftX, y)) {
          setSolid(shaftX, y, 0, true);
        }
      }
    }
  }

  const b1x = 20;
  const b1w = 40;
  const floorHeight = 20;
  const wallThick = 2;
  const roofY1 = groundY - 3 * floorHeight;

  for (let floorNum = 0; floorNum < 3; floorNum++) {
    const floorY = groundY - (floorNum + 1) * floorHeight;
    floor(b1x, floorY + floorHeight - wallThick, b1w, wallThick);
  }
  floor(b1x, roofY1, b1w, wallThick);

  rect(b1x, roofY1, wallThick, groundY - roofY1);
  rect(b1x + b1w - wallThick, roofY1, wallThick, groundY - roofY1);

  door(b1x, groundY - 8, 8);
  door(b1x + b1w - wallThick, groundY - 8, 8);

  column(b1x + 10, roofY1, groundY - 1, 3);
  column(b1x + 20, roofY1, groundY - 1, 3);
  column(b1x + 30, roofY1, groundY - 1, 3);

  const b2x = 80;
  const b2w = 30;
  const roofY2 = groundY - 2 * floorHeight;

  for (let floorNum = 0; floorNum < 2; floorNum++) {
    const floorY = groundY - (floorNum + 1) * floorHeight;
    floor(b2x, floorY + floorHeight - wallThick, b2w, wallThick);
  }
  floor(b2x, roofY2, b2w, wallThick);

  rect(b2x, roofY2, wallThick, groundY - roofY2);
  rect(b2x + b2w - wallThick, roofY2, wallThick, groundY - roofY2);

  door(b2x + b2w - wallThick, groundY - 8, 8);

  column(b2x + 10, roofY2, groundY - 1, 3);
  column(b2x + 20, roofY2, groundY - 1, 3);

  const b3x = 130;
  const b3w = 25;
  const roofY3 = groundY - 4 * floorHeight;

  for (let floorNum = 0; floorNum < 4; floorNum++) {
    const floorY = groundY - (floorNum + 1) * floorHeight;
    floor(b3x, floorY + floorHeight - wallThick, b3w, wallThick);
  }
  floor(b3x, roofY3, b3w, wallThick);

  rect(b3x, roofY3, wallThick, groundY - roofY3);
  rect(b3x + b3w - wallThick, roofY3, wallThick, groundY - roofY3);

  door(b3x, groundY - 8, 8);
  door(b3x + b3w - wallThick, groundY - 8, 8);

  column(b3x + 8, roofY3, groundY - 1, 3);
  column(b3x + 16, roofY3, groundY - 1, 3);

  floor(b1x + b1w, groundY - floorHeight - 5, 20, 2);
  column(b1x + b1w + 10, groundY - floorHeight - 5, groundY - 1, 3);

  floor(b2x + b2w, groundY - floorHeight - 5, b3x - b2x - b2w, 2);
  column(b2x + b2w + Math.floor((b3x - b2x - b2w) / 2), groundY - floorHeight - 5, groundY - 1, 3);

  const bondsH = new Uint32Array((gridW - 1) * gridH);
  const bondsV = new Uint32Array(gridW * (gridH - 1));
  bondsH.fill(255);
  bondsV.fill(255);

  return { cells, bondsH, bondsV };
}
