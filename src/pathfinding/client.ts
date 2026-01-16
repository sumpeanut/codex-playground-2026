type PathRequestResolver = {
  resolve: (path: Array<{ x: number; y: number }>) => void;
};

type PathfindingWorkerMessage =
  | { type: "ready" }
  | {
      type: "pathResult";
      data: { requestId: number; path: Array<{ x: number; y: number }> };
    };

type PathfindingWorkerPayload =
  | { type: "init"; data: { gridW: number; gridH: number; cells: ArrayBuffer } }
  | { type: "updateCells"; data: { cells: ArrayBuffer } }
  | { type: "findPath"; data: { requestId: number; startX: number; startY: number; endX: number; endY: number } };

export function createPathfindingWorkerClient({
  gridW,
  gridH,
  cpuCells,
}: {
  gridW: number;
  gridH: number;
  cpuCells: Uint32Array;
}) {
  let pathWorker: Worker | null = null;
  let pathRequestId = 0;
  const pendingPathRequests = new Map<number, PathRequestResolver>();
  let workerReady = false;

  function init() {
    if (pathWorker) return;
    pathWorker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    pathWorker.onmessage = function (event: MessageEvent<PathfindingWorkerMessage>) {
      const { type, data } = event.data;

      switch (type) {
        case "ready":
          workerReady = true;
          console.log("Pathfinding worker ready");
          break;

        case "pathResult": {
          const { requestId, path } = data;
          const pending = pendingPathRequests.get(requestId);
          if (pending) {
            pending.resolve(path);
            pendingPathRequests.delete(requestId);
          }
          break;
        }
      }
    };

    const cellsCopy = cpuCells.buffer.slice(0);
    pathWorker.postMessage(
      {
        type: "init",
        data: {
          gridW,
          gridH,
          cells: cellsCopy,
        },
      } satisfies PathfindingWorkerPayload,
      [cellsCopy]
    );
  }

  function updateCells() {
    if (pathWorker && workerReady) {
      const cellsCopy = cpuCells.buffer.slice(0);
      pathWorker.postMessage(
        {
          type: "updateCells",
          data: { cells: cellsCopy },
        } satisfies PathfindingWorkerPayload,
        [cellsCopy]
      );
    }
  }

  function requestPathAsync(startX: number, startY: number, endX: number, endY: number) {
    return new Promise<Array<{ x: number; y: number }>>((resolve) => {
      if (!pathWorker || !workerReady) {
        resolve([]);
        return;
      }

      const requestId = pathRequestId++;
      pendingPathRequests.set(requestId, { resolve });

      pathWorker.postMessage({
        type: "findPath",
        data: { requestId, startX, startY, endX, endY },
      } satisfies PathfindingWorkerPayload);
    });
  }

  return {
    init,
    updateCells,
    requestPathAsync,
    isReady: () => workerReady,
  };
}
