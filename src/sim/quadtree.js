export function buildQuadTree({ gridW, gridH, cpuCells, getSolid, maxDepth = 6, depth = 0, x = 0, y = 0, w = gridW, h = gridH }) {
  let allSolid = true;
  let allEmpty = true;

  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= gridH) {
      allSolid = false;
      continue;
    }
    const row = yy * gridW;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= gridW) {
        allSolid = false;
        continue;
      }
      const solid = getSolid(cpuCells[row + xx]);
      if (solid) {
        allEmpty = false;
      } else {
        allSolid = false;
      }
      if (!allSolid && !allEmpty) break;
    }
    if (!allSolid && !allEmpty) break;
  }

  const uniform = allSolid || allEmpty;
  if (uniform || depth >= maxDepth || (w <= 4 && h <= 4)) {
    return { x, y, w, h, state: allSolid ? "solid" : "empty", children: null };
  }

  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  return {
    x,
    y,
    w,
    h,
    state: "mixed",
    children: [
      buildQuadTree({ gridW, gridH, cpuCells, getSolid, maxDepth, depth: depth + 1, x, y, w: hw, h: hh }),
      buildQuadTree({ gridW, gridH, cpuCells, getSolid, maxDepth, depth: depth + 1, x: x + hw, y, w: w - hw, h: hh }),
      buildQuadTree({ gridW, gridH, cpuCells, getSolid, maxDepth, depth: depth + 1, x, y: y + hh, w: hw, h: h - hh }),
      buildQuadTree({ gridW, gridH, cpuCells, getSolid, maxDepth, depth: depth + 1, x: x + hw, y: y + hh, w: w - hw, h: h - hh }),
    ],
  };
}

export function drawQuadTree({ node, overlayCtx, overlay, gridW, gridH }) {
  if (!node) return;
  if (node.children) {
    node.children.forEach((child) => drawQuadTree({ node: child, overlayCtx, overlay, gridW, gridH }));
    return;
  }
  if (node.state === "empty") return;
  const scaleX = overlay.width / gridW;
  const scaleY = overlay.height / gridH;
  overlayCtx.strokeStyle = node.state === "solid" ? "rgba(120, 200, 255, 0.5)" : "rgba(255, 200, 120, 0.5)";
  overlayCtx.strokeRect(
    node.x * scaleX + 0.5,
    node.y * scaleY + 0.5,
    node.w * scaleX,
    node.h * scaleY
  );
}
