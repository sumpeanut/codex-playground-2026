import { GRID_H, GRID_W } from "../domain/grid.ts";
import { createPathfinder, type Pathfinder } from "./astar.ts";
import { createHierarchicalPathfinder, type HierarchicalPathfinder } from "./hpa.ts";

type InitMessage = { type: "init"; data: { gridW: number; gridH: number; cells: ArrayBuffer } };

type UpdateCellsMessage = { type: "updateCells"; data: { cells: ArrayBuffer } };

type FindPathMessage = {
  type: "findPath";
  data: {
    requestId: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    mode?: "astar" | "hpa" | "compare";
  };
};

type SetModeMessage = { type: "setMode"; data: { mode: "astar" | "hpa" | "compare" } };

type IncomingMessage = InitMessage | UpdateCellsMessage | FindPathMessage | SetModeMessage;

type ReadyMessage = { type: "ready" };

type PathResultMessage = {
  type: "pathResult";
  data: {
    requestId: number;
    path: Array<{ x: number; y: number }>;
    stats?: {
      mode: "astar" | "hpa" | "compare";
      astarMs?: number;
      hpaMs?: number;
      portals?: number;
      abstractNodes?: number;
      abstractEdges?: number;
      abstractExpanded?: number;
      localSearches?: number;
      localExpanded?: number;
    };
  };
};

type OutgoingMessage = ReadyMessage | PathResultMessage;

let gridW = GRID_W;
let gridH = GRID_H;
let cpuCells: Uint32Array | null = null;
let pathfinder: Pathfinder | null = null;
let hierarchicalPathfinder: HierarchicalPathfinder | null = null;
let mode: "astar" | "hpa" | "compare" = "astar";

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
      hierarchicalPathfinder = createHierarchicalPathfinder({
        gridW,
        gridH,
        chunkSize: 16,
        getCell: (x, y) => cpuCells?.[y * gridW + x] ?? 0,
      });
      self.postMessage({ type: "ready" } satisfies OutgoingMessage);
      break;

    case "updateCells":
      cpuCells = new Uint32Array(data.cells);
      if (hierarchicalPathfinder) {
        hierarchicalPathfinder.rebuild();
      }
      break;

    case "setMode":
      mode = data.mode;
      break;

    case "findPath": {
      if (!pathfinder) return;
      const { requestId, startX, startY, endX, endY } = data;
      const requestedMode = data.mode ?? mode;
      let path: Array<{ x: number; y: number }> = [];
      let stats: PathResultMessage["data"]["stats"] | undefined;

      if (requestedMode === "astar") {
        const start = performance.now();
        path = pathfinder.findPath(startX, startY, endX, endY);
        stats = { mode: "astar", astarMs: performance.now() - start };
      } else if (requestedMode === "hpa" && hierarchicalPathfinder) {
        const start = performance.now();
        const result = hierarchicalPathfinder.findPath(startX, startY, endX, endY);
        const elapsed = performance.now() - start;
        path = result.path;
        stats = {
          mode: "hpa",
          hpaMs: elapsed,
          portals: result.stats.portals,
          abstractNodes: result.stats.abstractNodes,
          abstractEdges: result.stats.abstractEdges,
          abstractExpanded: result.stats.abstractExpanded,
          localSearches: result.stats.localSearches,
          localExpanded: result.stats.localExpanded,
        };
      } else if (requestedMode === "compare" && hierarchicalPathfinder) {
        const astarStart = performance.now();
        const astarPath = pathfinder.findPath(startX, startY, endX, endY);
        const astarMs = performance.now() - astarStart;

        const hpaStart = performance.now();
        const result = hierarchicalPathfinder.findPath(startX, startY, endX, endY);
        const hpaMs = performance.now() - hpaStart;
        path = result.path.length > 0 ? result.path : astarPath;
        stats = {
          mode: "compare",
          astarMs,
          hpaMs,
          portals: result.stats.portals,
          abstractNodes: result.stats.abstractNodes,
          abstractEdges: result.stats.abstractEdges,
          abstractExpanded: result.stats.abstractExpanded,
          localSearches: result.stats.localSearches,
          localExpanded: result.stats.localExpanded,
        };
      } else {
        path = pathfinder.findPath(startX, startY, endX, endY);
        stats = { mode: "astar" };
      }
      self.postMessage({
        type: "pathResult",
        data: { requestId, path, stats },
      } satisfies OutgoingMessage);
      break;
    }
  }
};
