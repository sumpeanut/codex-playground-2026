type PathRequestResolver = {
  resolve: (path: Array<{ x: number; y: number }>) => void;
};

type PathfindingWorkerMessage =
  | { type: "ready" }
  | {
      type: "pathResult";
      data: { requestId: number; path: Array<{ x: number; y: number }> };
    }
  | {
      type: "pathResultBatch";
      data: { results: Array<{ requestId: number; path: Array<{ x: number; y: number }> }> };
    };

type PathfindingWorkerPayload =
  | { type: "init"; data: { gridW: number; gridH: number; cells: ArrayBuffer } }
  | { type: "updateCells"; data: { cells: ArrayBuffer } }
  | { type: "findPath"; data: { requestId: number; startX: number; startY: number; endX: number; endY: number } }
  | {
      type: "findPathBatch";
      data: {
        requests: Array<{ requestId: number; startX: number; startY: number; endX: number; endY: number }>;
      };
    };

type PathRequest = { startX: number; startY: number; endX: number; endY: number };

type PendingGroup = {
  requestId: number;
  request: PathRequest;
  resolvers: Array<PathRequestResolver>;
};

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
  const pendingGroupedRequests = new Map<string, PendingGroup>();
  const pendingRequestKeys = new Map<number, string>();
  const queuedRequests: Array<{ requestId: number; request: PathRequest }> = [];
  let workerReady = false;
  let flushScheduled = false;
  const cache = new Map<string, Array<{ x: number; y: number }>>();
  let cachePointCount = 0;

  const metrics = {
    cacheEnabled: true,
    cacheHits: 0,
    cacheMisses: 0,
    cacheBypass: 0,
    totalRequests: 0,
    resolvedTotal: 0,
    resolvedFromCache: 0,
    resolvedFromWorker: 0,
    workerRequests: 0,
    batchCount: 0,
  };

  const resolveEvents: number[] = [];
  const workerResolveEvents: number[] = [];
  const throughputWindowMs = 2000;
  const quantizeSize = 2;
  const bytesPerPoint = 16;

  function quantize(value: number) {
    return Math.round(value / quantizeSize) * quantizeSize;
  }

  function makeCacheKey(request: PathRequest) {
    const startX = quantize(request.startX);
    const startY = quantize(request.startY);
    const endX = quantize(request.endX);
    const endY = quantize(request.endY);
    return `${startX},${startY}:${endX},${endY}`;
  }

  function pruneThroughputSamples() {
    const cutoff = performance.now() - throughputWindowMs;
    while (resolveEvents.length && resolveEvents[0] < cutoff) resolveEvents.shift();
    while (workerResolveEvents.length && workerResolveEvents[0] < cutoff) workerResolveEvents.shift();
  }

  function recordResolutions(count: number, fromCache: boolean) {
    metrics.resolvedTotal += count;
    if (fromCache) {
      metrics.resolvedFromCache += count;
    } else {
      metrics.resolvedFromWorker += count;
    }
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      resolveEvents.push(now);
    }
    if (!fromCache) {
      for (let i = 0; i < count; i++) {
        workerResolveEvents.push(now);
      }
    }
  }

  function clearCache() {
    cache.clear();
    cachePointCount = 0;
  }

  function setCacheEntry(key: string, path: Array<{ x: number; y: number }>) {
    if (cache.has(key)) return;
    cache.set(key, path);
    cachePointCount += path.length;
  }

  function resolveGroup(key: string, path: Array<{ x: number; y: number }>, fromCache: boolean) {
    const group = pendingGroupedRequests.get(key);
    if (!group) return;
    for (const resolver of group.resolvers) {
      resolver.resolve(path);
    }
    recordResolutions(group.resolvers.length, fromCache);
    pendingGroupedRequests.delete(key);
    pendingRequestKeys.delete(group.requestId);
  }

  function flushQueue() {
    if (!pathWorker || !workerReady || queuedRequests.length === 0) return;
    const batch = queuedRequests.splice(0, queuedRequests.length);
    metrics.workerRequests += batch.length;
    metrics.batchCount += 1;
    pathWorker.postMessage({
      type: "findPathBatch",
      data: {
        requests: batch.map(({ requestId, request }) => ({ requestId, ...request })),
      },
    } satisfies PathfindingWorkerPayload);
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
      flushScheduled = false;
      flushQueue();
    });
  }

  function handlePathResult(requestId: number, path: Array<{ x: number; y: number }>) {
    const key = pendingRequestKeys.get(requestId);
    if (!key) return;
    if (metrics.cacheEnabled) {
      setCacheEntry(key, path);
    }
    resolveGroup(key, path, false);
  }

  function init() {
    if (pathWorker) return;
    pathWorker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

    pathWorker.onmessage = function (event: MessageEvent<PathfindingWorkerMessage>) {
      const { type, data } = event.data;

      switch (type) {
        case "ready":
          workerReady = true;
          console.log("Pathfinding worker ready");
          break;

        case "pathResult": {
          const { requestId, path } = data;
          handlePathResult(requestId, path);
          break;
        }

        case "pathResultBatch": {
          for (const result of data.results) {
            handlePathResult(result.requestId, result.path);
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
    clearCache();
  }

  function requestPathAsync(startX: number, startY: number, endX: number, endY: number) {
    return new Promise<Array<{ x: number; y: number }>>((resolve) => {
      if (!pathWorker || !workerReady) {
        resolve([]);
        return;
      }

      metrics.totalRequests += 1;
      const request = { startX, startY, endX, endY };
      const key = makeCacheKey(request);
      if (metrics.cacheEnabled) {
        const cached = cache.get(key);
        if (cached) {
          metrics.cacheHits += 1;
          resolve(cached);
          recordResolutions(1, true);
          return;
        }
        metrics.cacheMisses += 1;
      } else {
        metrics.cacheBypass += 1;
      }

      const existingGroup = pendingGroupedRequests.get(key);
      if (existingGroup) {
        existingGroup.resolvers.push({ resolve });
        return;
      }

      const requestId = pathRequestId++;
      const group = {
        requestId,
        request,
        resolvers: [{ resolve }],
      };
      pendingGroupedRequests.set(key, group);
      pendingRequestKeys.set(requestId, key);
      queuedRequests.push({ requestId, request });
      scheduleFlush();
    });
  }

  return {
    init,
    updateCells,
    requestPathAsync,
    isReady: () => workerReady,
    setCacheEnabled: (enabled: boolean) => {
      metrics.cacheEnabled = enabled;
      if (!enabled) {
        clearCache();
      }
    },
    getMetrics: () => {
      pruneThroughputSamples();
      const hitTotal = metrics.cacheHits + metrics.cacheMisses;
      const totalThroughput = resolveEvents.length / (throughputWindowMs / 1000);
      const workerThroughput = workerResolveEvents.length / (throughputWindowMs / 1000);
      return {
        cacheEnabled: metrics.cacheEnabled,
        cacheEntries: cache.size,
        cachePoints: cachePointCount,
        cacheBytes: cachePointCount * bytesPerPoint,
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        cacheBypass: metrics.cacheBypass,
        hitRate: hitTotal > 0 ? metrics.cacheHits / hitTotal : 0,
        totalRequests: metrics.totalRequests,
        resolvedTotal: metrics.resolvedTotal,
        resolvedFromCache: metrics.resolvedFromCache,
        resolvedFromWorker: metrics.resolvedFromWorker,
        workerRequests: metrics.workerRequests,
        batchCount: metrics.batchCount,
        totalThroughput,
        workerThroughput,
      };
    },
  };
}
