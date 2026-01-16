import { createPathfinder } from "./core.js";

let GRID_W = 256;
let GRID_H = 144;
let cpuCells = null;
let pathfinder = null;

self.onmessage = function (event) {
  const { type, data } = event.data;

  switch (type) {
    case "init":
      GRID_W = data.gridW;
      GRID_H = data.gridH;
      cpuCells = new Uint32Array(data.cells);
      pathfinder = createPathfinder({
        gridW: GRID_W,
        gridH: GRID_H,
        getCell: (x, y) => cpuCells[y * GRID_W + x],
      });
      self.postMessage({ type: "ready" });
      break;

    case "updateCells":
      cpuCells = new Uint32Array(data.cells);
      break;

    case "findPath":
      if (!pathfinder) return;
      const { requestId, startX, startY, endX, endY } = data;
      const path = pathfinder.findPath(startX, startY, endX, endY);
      self.postMessage({
        type: "pathResult",
        data: { requestId, path },
      });
      break;
  }
};
