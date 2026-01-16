export function createPathfindingWorkerClient({ gridW, gridH, cpuCells }) {
  let pathWorker = null;
  let pathRequestId = 0;
  const pendingPathRequests = new Map();
  let workerReady = false;

  function init() {
    if (pathWorker) return;
    pathWorker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    pathWorker.onmessage = function (event) {
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
      },
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
        },
        [cellsCopy]
      );
    }
  }

  function requestPathAsync(startX, startY, endX, endY) {
    return new Promise((resolve) => {
      if (!pathWorker || !workerReady) {
        resolve([]);
        return;
      }

      const requestId = pathRequestId++;
      pendingPathRequests.set(requestId, { resolve });

      pathWorker.postMessage({
        type: "findPath",
        data: { requestId, startX, startY, endX, endY },
      });
    });
  }

  return {
    init,
    updateCells,
    requestPathAsync,
    isReady: () => workerReady,
  };
}
