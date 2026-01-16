# Pathfinding Optimization Research

## Current Performance Baseline

Based on performance testing with the current A* implementation:

| Map Complexity | Avg Path Time | Paths/Frame (8ms budget) |
|----------------|---------------|--------------------------|
| Simple         | ~0.5ms        | ~16 paths               |
| Medium         | ~5.14ms       | ~1 path                 |
| Complex        | ~2ms          | ~4 paths                |
| Worst Case     | ~10-50ms+     | <1 path                 |

**Target:** Support 10-50+ entities pathfinding simultaneously at 60 FPS.

---

## Current Implementation Analysis

### Identified Bottlenecks

1. **Linear Open Set Search** - O(n) to find lowest f-score node
   ```javascript
   // Current: Iterates entire openSet every iteration
   for (const [k, node] of openSet) {
     const f = fScore.get(k) || Infinity;
     if (f < lowestF) { ... }
   }
   ```

2. **String Key Generation** - Creates garbage on every cell visit
   ```javascript
   const key = (x, y) => `${x},${y}`;  // Template string allocation
   ```

3. **Multiple Map Lookups** - Separate Maps for gScore, fScore, cameFrom
   ```javascript
   gScore.get(key), fScore.get(key), cameFrom.get(key)  // 3 hash lookups
   ```

4. **Dynamic Move Generation** - `getPossibleMoves()` rebuilds array each call

5. **No Early Termination Heuristics** - Explores all equally-weighted paths

---

## Optimization Strategies

### 1. Binary Heap Priority Queue (High Impact)

Replace linear open set search with a binary min-heap.

**Complexity Improvement:** O(n) → O(log n) for extracting minimum

```javascript
class BinaryHeap {
  constructor() {
    this.nodes = [];
    this.positions = new Map(); // Track positions for decrease-key
  }
  
  push(node, priority) {
    const i = this.nodes.length;
    this.nodes.push({ node, priority });
    this.positions.set(node.key, i);
    this._bubbleUp(i);
  }
  
  pop() {
    const min = this.nodes[0];
    const last = this.nodes.pop();
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.positions.set(last.node.key, 0);
      this._sinkDown(0);
    }
    this.positions.delete(min.node.key);
    return min.node;
  }
  
  // Bubble up and sink down implementations...
}
```

**Expected Improvement:** 2-5x faster for complex maps

---

### 2. Integer Keys Instead of Strings (Medium Impact)

Replace string keys with integer encoding.

```javascript
// Current (slow - string allocation)
const key = (x, y) => `${x},${y}`;

// Optimized (fast - integer math)
const key = (x, y) => y * GRID_W + x;

// Or bit packing for larger grids
const key = (x, y) => (x << 16) | y;
```

**Expected Improvement:** 10-20% reduction in GC pressure and lookup time

---

### 3. Single Node Object (Medium Impact)

Combine all node data into single objects to reduce Map lookups.

```javascript
// Current: 4 separate Maps
gScore.get(key), fScore.get(key), cameFrom.get(key), openSet.get(key)

// Optimized: Single object per node
class PathNode {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.key = y * GRID_W + x;
    this.g = Infinity;
    this.f = Infinity;
    this.parent = null;
    this.closed = false;
    this.inOpen = false;
  }
}

// Use TypedArray or object pool for zero-allocation
const nodePool = new Array(GRID_W * GRID_H);
```

**Expected Improvement:** 20-30% faster due to cache locality

---

### 4. Web Workers (High Impact)

Offload pathfinding to worker threads for true parallelism.

```javascript
// Main thread
const pathWorker = new Worker('/src/pathfinding/worker.js', { type: 'module' });
const pendingPaths = new Map();

function requestPath(entityId, start, end) {
  return new Promise(resolve => {
    pendingPaths.set(entityId, resolve);
    pathWorker.postMessage({ entityId, start, end, cells: cpuCells });
  });
}

pathWorker.onmessage = (e) => {
  const { entityId, path } = e.data;
  pendingPaths.get(entityId)?.(path);
  pendingPaths.delete(entityId);
};

// src/pathfinding/worker.js
self.onmessage = (e) => {
  const { entityId, start, end, cells } = e.data;
  const path = findPath(start, end, cells);
  self.postMessage({ entityId, path });
};
```

**Architecture Options:**

| Approach | Pros | Cons |
|----------|------|------|
| Single Worker | Simple, no coordination | Limited to 1 extra core |
| Worker Pool | Full CPU utilization | Complex coordination, memory transfer |
| SharedArrayBuffer | Zero-copy cell data | Requires COOP/COEP headers |

**Expected Improvement:** 2-8x throughput (depends on core count)

---

### 5. Hierarchical Pathfinding (HPA*) (High Impact)

Pre-compute a high-level graph of map regions.

```
┌─────┬─────┬─────┐
│  A  │  B  │  C  │    High-level graph:
│  ○──┼──○──┼──○  │    A ←→ B ←→ C
├──┼──┼─────┼──┼──┤    ↕     ↕     ↕
│  D  │  E  │  F  │    D ←→ E ←→ F
│  ○──┼──○──┼──○  │
└─────┴─────┴─────┘
```

**Process:**
1. Divide map into chunks (e.g., 16x16 or 32x32)
2. Pre-compute connections between adjacent chunks
3. Path query: 
   - Find path through high-level graph (fast)
   - Refine with local A* only in relevant chunks

```javascript
class HPAStar {
  constructor(chunkSize = 16) {
    this.chunkSize = chunkSize;
    this.abstractGraph = new Map(); // Chunk connections
  }
  
  precompute() {
    // Build abstract graph from chunk border analysis
    // Called once when map changes
  }
  
  findPath(start, end) {
    const startChunk = this.getChunk(start);
    const endChunk = this.getChunk(end);
    
    if (startChunk === endChunk) {
      return this.localAStar(start, end); // Simple case
    }
    
    // Find chunk-level path
    const chunkPath = this.abstractAStar(startChunk, endChunk);
    
    // Refine to actual path
    return this.refinePath(start, end, chunkPath);
  }
}
```

**Expected Improvement:** 10-100x faster for long paths

---

### 6. Jump Point Search (JPS) (High Impact for Grid Maps)

Skip symmetric paths by identifying "jump points" - only nodes where direction must change.

**Note:** JPS works best for uniform-cost grids. Our support/solid cell mix may limit effectiveness, but a modified version could work.

```javascript
function jump(x, y, dx, dy, end) {
  const nx = x + dx;
  const ny = y + dy;
  
  if (!isWalkable(nx, ny)) return null;
  if (nx === end.x && ny === end.y) return { x: nx, y: ny };
  
  // Check for forced neighbors
  if (dx !== 0 && dy !== 0) {
    // Diagonal movement
    if ((isWalkable(x - dx, y + dy) && !isWalkable(x - dx, y)) ||
        (isWalkable(x + dx, y - dy) && !isWalkable(x, y - dy))) {
      return { x: nx, y: ny };
    }
    // Recurse horizontally and vertically
    if (jump(nx, ny, dx, 0, end) || jump(nx, ny, 0, dy, end)) {
      return { x: nx, y: ny };
    }
  } else {
    // Cardinal movement - check for forced neighbors
    // ...
  }
  
  return jump(nx, ny, dx, dy, end); // Continue jumping
}
```

**Expected Improvement:** 10-30x faster on open maps (less effective on dense mazes)

---

### 7. Flow Fields (High Impact for Many Entities)

Pre-compute a vector field pointing toward destination. All entities share the same field.

```
┌───────────────────┐
│ ↘ ↓ ↓ ↓ ↙ ← ← ← │
│ → ↘ ↓ ↙ ← ← ← ↑ │
│ → → ★ ← ← ← ↑ ↑ │  ★ = destination
│ → ↗ ↑ ↖ ← ← ↑ ↑ │
│ ↗ ↑ ↑ ↑ ↖ ← ↑ ↑ │
└───────────────────┘
```

```javascript
function computeFlowField(goalX, goalY) {
  const field = new Int8Array(GRID_W * GRID_H * 2); // dx, dy per cell
  const cost = new Uint16Array(GRID_W * GRID_H);
  cost.fill(65535);
  
  // Dijkstra from goal
  const queue = [{ x: goalX, y: goalY, cost: 0 }];
  cost[goalY * GRID_W + goalX] = 0;
  
  while (queue.length > 0) {
    const { x, y, c } = queue.shift(); // Use heap for better perf
    
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      if (!isWalkable(nx, ny)) continue;
      
      const newCost = c + 1;
      const idx = ny * GRID_W + nx;
      if (newCost < cost[idx]) {
        cost[idx] = newCost;
        field[idx * 2] = -dx;     // Point back toward goal
        field[idx * 2 + 1] = -dy;
        queue.push({ x: nx, y: ny, c: newCost });
      }
    }
  }
  
  return field;
}

// Entity just follows the field
function getNextMove(entity, field) {
  const idx = (Math.floor(entity.y) * GRID_W + Math.floor(entity.x)) * 2;
  return { dx: field[idx], dy: field[idx + 1] };
}
```

**Best For:** Many entities going to same destination (e.g., enemies attacking base)

**Expected Improvement:** O(1) per entity after field computation

---

### 8. Path Caching & Request Batching (Medium Impact)

Cache recent paths and batch similar requests.

```javascript
class PathCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  getCacheKey(start, end) {
    // Quantize to reduce cache misses
    const sx = Math.floor(start.x / 4) * 4;
    const sy = Math.floor(start.y / 4) * 4;
    const ex = Math.floor(end.x / 4) * 4;
    const ey = Math.floor(end.y / 4) * 4;
    return `${sx},${sy}-${ex},${ey}`;
  }
  
  get(start, end) {
    const key = this.getCacheKey(start, end);
    const cached = this.cache.get(key);
    if (cached) {
      // Adjust path to actual start/end
      return this.adjustPath(cached, start, end);
    }
    return null;
  }
  
  set(start, end, path) {
    if (this.cache.size >= this.maxSize) {
      // LRU eviction
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(this.getCacheKey(start, end), path);
  }
}
```

---

### 9. Async/Incremental Pathfinding (Medium Impact)

Spread computation across multiple frames.

```javascript
class IncrementalPathfinder {
  constructor(maxIterationsPerFrame = 100) {
    this.maxIterationsPerFrame = maxIterationsPerFrame;
    this.activeSearches = new Map();
  }
  
  requestPath(entityId, start, end) {
    const search = {
      openSet: new BinaryHeap(),
      closedSet: new Set(),
      // ... other A* state
      resolve: null,
    };
    
    const promise = new Promise(r => search.resolve = r);
    this.activeSearches.set(entityId, search);
    return promise;
  }
  
  update() {
    // Process a few iterations of each active search
    for (const [entityId, search] of this.activeSearches) {
      for (let i = 0; i < this.maxIterationsPerFrame; i++) {
        const result = this.stepSearch(search);
        if (result.done) {
          search.resolve(result.path);
          this.activeSearches.delete(entityId);
          break;
        }
      }
    }
  }
}
```

**Trade-off:** Paths arrive with delay (1-5 frames) but never block rendering.

---

## Recommended Implementation Order

### Phase 1: Quick Wins (1-2 hours)
1. **Binary Heap** - Biggest single improvement
2. **Integer Keys** - Simple change, good gains
3. **Single Node Objects** - Reduce allocations

**Expected Result:** 3-5x faster

### Phase 2: Architecture (4-8 hours)
4. **Web Worker** - Single worker for pathfinding
5. **Path Caching** - Reduce redundant computations

**Expected Result:** 5-10x faster

### Phase 3: Advanced (1-2 days)
6. **HPA*** or **Flow Fields** - Based on game needs
7. **Request batching & prioritization**

**Expected Result:** 10-50x faster

---

## Implementation Priority Matrix

| Optimization | Impact | Effort | Priority |
|--------------|--------|--------|----------|
| Binary Heap | High | Low | ⭐⭐⭐⭐⭐ |
| Integer Keys | Medium | Low | ⭐⭐⭐⭐ |
| Single Node Objects | Medium | Medium | ⭐⭐⭐ |
| Web Worker | High | Medium | ⭐⭐⭐⭐ |
| Path Caching | Medium | Low | ⭐⭐⭐ |
| HPA* | Very High | High | ⭐⭐⭐ |
| Flow Fields | Very High | High | ⭐⭐⭐ |
| JPS | High | High | ⭐⭐ |
| Incremental | Medium | Medium | ⭐⭐ |

---

## References

- [Amit's A* Pages](http://theory.stanford.edu/~amitp/GameProgramming/) - Comprehensive pathfinding resource
- [Jump Point Search Paper](https://www.aaai.org/ocs/index.php/AAAI/AAAI11/paper/view/3761)
- [Flow Field Pathfinding](https://leifnode.com/2013/12/flow-field-pathfinding/)
- [HPA* Paper](https://webdocs.cs.ualberta.ca/~kulchits/Jonathan_Jansen_Thesis.pdf)
- [Web Workers MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

---

## Next Steps

1. Implement Binary Heap + Integer Keys as first optimization pass
2. Benchmark to measure improvement
3. If still insufficient, add Web Worker
4. Evaluate HPA* vs Flow Fields based on game requirements:
   - **HPA***: Better for diverse destinations
   - **Flow Fields**: Better for many entities → single destination
