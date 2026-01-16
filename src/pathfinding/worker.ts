import { createPathfinder, type Pathfinder } from "./core.js";

type InitMessage = { type: "init"; data: { gridW: number; gridH: number; cells: ArrayBuffer } };

type UpdateCellsMessage = { type: "updateCells"; data: { cells: ArrayBuffer } };

type FindPathMessage = {
  type: "findPath";
  data: { requestId: number; startX: number; startY: number; endX: number; endY: number };
};

type IncomingMessage = InitMessage | UpdateCellsMessage | FindPathMessage;

type ReadyMessage = { type: "ready" };

type PathResultMessage = {
  type: "pathResult";
  data: { requestId: number; path: Array<{ x: number; y: number }> };
};

type OutgoingMessage = ReadyMessage | PathResultMessage;

let GRID_W = 256;
let GRID_H = 144;
let cpuCells: Uint32Array | null = null;
let pathfinder: Pathfinder | null = null;

self.onmessage = function (event: MessageEvent<IncomingMessage>) {
  const { type, data } = event.data;

  switch (type) {
    case "init":
      GRID_W = data.gridW;
      GRID_H = data.gridH;
      cpuCells = new Uint32Array(data.cells);
      pathfinder = createPathfinder({
        gridW: GRID_W,
        gridH: GRID_H,
        getCell: (x, y) => cpuCells?.[y * GRID_W + x] ?? 0,
      });
      self.postMessage({ type: "ready" } satisfies OutgoingMessage);
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
      } satisfies OutgoingMessage);
      break;
  }
};
