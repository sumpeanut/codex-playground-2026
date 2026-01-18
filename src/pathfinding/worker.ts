import { GRID_H, GRID_W } from "../domain/grid.ts";
import { createPathfinder, type Pathfinder } from "./astar.ts";

type InitMessage = { type: "init"; data: { gridW: number; gridH: number; cells: ArrayBuffer } };

type UpdateCellsMessage = { type: "updateCells"; data: { cells: ArrayBuffer } };

type FindPathMessage = {
  type: "findPath";
  data: { requestId: number; startX: number; startY: number; endX: number; endY: number };
};

type FindPathBatchMessage = {
  type: "findPathBatch";
  data: {
    requests: Array<{ requestId: number; startX: number; startY: number; endX: number; endY: number }>;
  };
};

type IncomingMessage = InitMessage | UpdateCellsMessage | FindPathMessage | FindPathBatchMessage;

type ReadyMessage = { type: "ready" };

type PathResultMessage = {
  type: "pathResult";
  data: { requestId: number; path: Array<{ x: number; y: number }> };
};

type PathResultBatchMessage = {
  type: "pathResultBatch";
  data: { results: Array<{ requestId: number; path: Array<{ x: number; y: number }> }> };
};

type OutgoingMessage = ReadyMessage | PathResultMessage | PathResultBatchMessage;

let gridW = GRID_W;
let gridH = GRID_H;
let cpuCells: Uint32Array | null = null;
let pathfinder: Pathfinder | null = null;

self.onmessage = function (event: MessageEvent<IncomingMessage>) {
  const { type, data } = event.data;

  switch (type) {
    case "init":
      gridW = data.gridW;
      gridH = data.gridH;
      cpuCells = new Uint32Array(data.cells);
      pathfinder = createPathfinder({
        gridW,
        gridH,
        getCell: (x, y) => cpuCells?.[y * gridW + x] ?? 0,
      });
      self.postMessage({ type: "ready" } satisfies OutgoingMessage);
      break;

    case "updateCells":
      cpuCells = new Uint32Array(data.cells);
      break;

    case "findPath": {
      if (!pathfinder) return;
      const { requestId, startX, startY, endX, endY } = data;
      const path = pathfinder.findPath(startX, startY, endX, endY);
      self.postMessage({
        type: "pathResult",
        data: { requestId, path },
      } satisfies OutgoingMessage);
      break;
    }

    case "findPathBatch": {
      if (!pathfinder) return;
      const results = data.requests.map((request) => ({
        requestId: request.requestId,
        path: pathfinder.findPath(request.startX, request.startY, request.endX, request.endY),
      }));
      self.postMessage({
        type: "pathResultBatch",
        data: { results },
      } satisfies OutgoingMessage);
      break;
    }
  }
};
