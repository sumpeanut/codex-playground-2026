// Pathfinding Web Worker
// Handles A* pathfinding off the main thread

let GRID_W = 256;
let GRID_H = 144;
let cpuCells = null;

const MAX_JUMP_UP = 5;
const MAX_JUMP_ACROSS = 3;

// ---- Binary Heap Priority Queue (O(log n) operations) ----
class BinaryHeap {
  constructor() {
    this.nodes = [];
  }

  get size() {
    return this.nodes.length;
  }

  push(key, priority, data) {
    const node = { key, priority, data };
    this.nodes.push(node);
    this._bubbleUp(this.nodes.length - 1);
  }

  pop() {
    if (this.nodes.length === 0) return null;
    const min = this.nodes[0];
    const last = this.nodes.pop();
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this._sinkDown(0);
    }
    return min;
  }

  _bubbleUp(i) {
    const node = this.nodes[i];
    const priority = node.priority;
    while (i > 0) {
      const parentI = (i - 1) >> 1;
      const parent = this.nodes[parentI];
      if (priority >= parent.priority) break;
      this.nodes[i] = parent;
      i = parentI;
    }
    this.nodes[i] = node;
  }

  _sinkDown(i) {
    const length = this.nodes.length;
    const node = this.nodes[i];
    const priority = node.priority;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      let smallestPriority = priority;
      if (left < length && this.nodes[left].priority < smallestPriority) {
        smallest = left;
        smallestPriority = this.nodes[left].priority;
      }
      if (right < length && this.nodes[right].priority < smallestPriority) {
        smallest = right;
      }
      if (smallest === i) break;
      this.nodes[i] = this.nodes[smallest];
      i = smallest;
    }
    this.nodes[i] = node;
  }
}

// ---- Cell helpers ----
function getSolid(cell) {
  const dmg = cell & 0xff;
  const solidBit = (cell >> 8) & 1;
  return solidBit === 1 && dmg < 255;
}

function getPassable(cell) {
  return ((cell >> 9) & 1) === 1;
}

function blocksEntity(cell) {
  return getSolid(cell) && !getPassable(cell);
}

// ---- Integer key encoding ----
const nodeKey = (x, y) => y * GRID_W + x;
const keyToXY = (key) => ({ x: key % GRID_W, y: Math.floor(key / GRID_W) });

// ---- Walkable Surface Detection ----
function isWalkable(x, y) {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
  const cell = cpuCells[y * GRID_W + x];
  if (blocksEntity(cell)) return false;
  if (y + 1 >= GRID_H) return true;
  const below = cpuCells[(y + 1) * GRID_W + x];
  return getSolid(below);
}

function isJumpPathClear(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  if (dx === 0 && dy === 0) return true;
  
  const isFalling = dy > 0;
  
  if (isFalling) {
    for (let cy = y1 + 2; cy < y2; cy++) {
      if (cy < 0 || cy >= GRID_H) continue;
      const cell = cpuCells[cy * GRID_W + x1];
      if (blocksEntity(cell)) return false;
    }
    if (dx !== 0) {
      const stepX = dx > 0 ? 1 : -1;
      for (let cx = x1 + stepX; cx !== x2 + stepX; cx += stepX) {
        if (cx < 0 || cx >= GRID_W) continue;
        const cellAtLanding = cpuCells[y2 * GRID_W + cx];
        const cellAboveLanding = y2 > 0 ? cpuCells[(y2 - 1) * GRID_W + cx] : 0;
        if (blocksEntity(cellAtLanding) || blocksEntity(cellAboveLanding)) return false;
      }
    }
    return true;
  } else {
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = Math.round(x1 + dx * t);
      const cy = Math.round(y1 + dy * t);
      if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) continue;
      const cell = cpuCells[cy * GRID_W + cx];
      if (blocksEntity(cell)) return false;
    }
    return true;
  }
}

function canTraverse(x1, y1, x2, y2) {
  if (!isWalkable(x2, y2)) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    return true;
  }
  
  if (dy < 0 && dy >= -MAX_JUMP_UP && Math.abs(dx) <= MAX_JUMP_ACROSS) {
    return isJumpPathClear(x1, y1, x2, y2);
  }
  
  if (dy > 0 && Math.abs(dx) <= MAX_JUMP_ACROSS) {
    if (Math.abs(dx) === 1 && dy > 1) {
      return isEdgeDropClear(x1, y1, x2, y2);
    }
    return isJumpPathClear(x1, y1, x2, y2);
  }
  
  return false;
}

function isEdgeDropClear(x1, y1, x2, y2) {
  const edgeCell = cpuCells[y1 * GRID_W + x2];
  if (blocksEntity(edgeCell)) return false;
  
  for (let cy = y1 + 1; cy < y2; cy++) {
    if (cy < 0 || cy >= GRID_H) continue;
    const cell = cpuCells[cy * GRID_W + x2];
    if (blocksEntity(cell)) return false;
  }
  return true;
}

function getTraversalCost(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  
  if (dx <= 1 && dy <= 1) {
    return dx !== 0 && dy !== 0 ? 1.414 : 1;
  }
  
  return Math.sqrt(dx * dx + dy * dy) * 1.5;
}

function getPossibleMoves(x, y) {
  const moves = [];
  
  const walkDirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ];
  for (const [dx, dy] of walkDirs) {
    moves.push([dx, dy]);
  }
  
  for (let jumpY = 2; jumpY <= MAX_JUMP_UP; jumpY++) {
    for (let jumpX = -MAX_JUMP_ACROSS; jumpX <= MAX_JUMP_ACROSS; jumpX++) {
      moves.push([jumpX, -jumpY]);
    }
  }
  
  for (let fallY = 2; fallY <= GRID_H; fallY++) {
    for (let fallX = -MAX_JUMP_ACROSS; fallX <= MAX_JUMP_ACROSS; fallX++) {
      const targetY = y + fallY;
      const targetX = x + fallX;
      if (targetY >= GRID_H) continue;
      if (isWalkable(targetX, targetY)) {
        moves.push([fallX, fallY]);
      }
    }
  }
  
  for (const stepX of [-1, 1]) {
    const edgeX = x + stepX;
    if (edgeX < 0 || edgeX >= GRID_W) continue;
    const edgeCell = cpuCells[y * GRID_W + edgeX];
    if (blocksEntity(edgeCell)) continue;
    if (isWalkable(edgeX, y)) continue;
    
    for (let fallY = 1; fallY <= GRID_H; fallY++) {
      const landY = y + fallY;
      if (landY >= GRID_H) break;
      if (isWalkable(edgeX, landY)) {
        moves.push([stepX, fallY]);
        break;
      }
      const cellBelow = cpuCells[landY * GRID_W + edgeX];
      if (blocksEntity(cellBelow)) break;
    }
  }
  
  return moves;
}

function heuristic(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

function findNearestWalkable(x, y) {
  if (isWalkable(x, y)) return { x, y };
  for (let r = 1; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (isWalkable(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

// ---- A* Pathfinding ----
function findPath(startX, startY, endX, endY) {
  startX = Math.max(0, Math.min(GRID_W - 1, startX));
  startY = Math.max(0, Math.min(GRID_H - 1, startY));
  endX = Math.max(0, Math.min(GRID_W - 1, endX));
  endY = Math.max(0, Math.min(GRID_H - 1, endY));

  const start = findNearestWalkable(startX, startY);
  const end = findNearestWalkable(endX, endY);
  
  if (!start || !end) {
    return [];
  }

  const endKey = nodeKey(end.x, end.y);
  const nodes = new Map();
  const closedSet = new Set();
  const openSet = new BinaryHeap();

  const startKey = nodeKey(start.x, start.y);
  const startH = heuristic(start.x, start.y, end.x, end.y);
  nodes.set(startKey, { g: 0, parent: null });
  openSet.push(startKey, startH, { x: start.x, y: start.y });

  let iterations = 0;
  const maxIterations = GRID_W * GRID_H * 2;

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    const current = openSet.pop();
    if (!current) break;
    
    const currentKey = current.key;
    const cx = current.data.x;
    const cy = current.data.y;

    if (closedSet.has(currentKey)) continue;

    if (currentKey === endKey) {
      const path = [];
      let ck = currentKey;
      while (ck !== null && nodes.has(ck)) {
        const { x, y } = keyToXY(ck);
        path.unshift({ x, y });
        ck = nodes.get(ck).parent;
      }
      if (path.length > 0) path.shift();
      return path;
    }

    closedSet.add(currentKey);
    const currentG = nodes.get(currentKey).g;

    const moves = getPossibleMoves(cx, cy);
    
    for (const [dx, dy] of moves) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nk = nodeKey(nx, ny);

      if (closedSet.has(nk)) continue;
      if (!canTraverse(cx, cy, nx, ny)) continue;

      const tentativeG = currentG + getTraversalCost(cx, cy, nx, ny);
      const existingNode = nodes.get(nk);

      if (!existingNode) {
        const h = heuristic(nx, ny, end.x, end.y);
        nodes.set(nk, { g: tentativeG, parent: currentKey });
        openSet.push(nk, tentativeG + h, { x: nx, y: ny });
      } else if (tentativeG < existingNode.g) {
        existingNode.g = tentativeG;
        existingNode.parent = currentKey;
        const h = heuristic(nx, ny, end.x, end.y);
        openSet.push(nk, tentativeG + h, { x: nx, y: ny });
      }
    }
  }

  return [];
}

// ---- Worker Message Handler ----
self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'init':
      GRID_W = data.gridW;
      GRID_H = data.gridH;
      cpuCells = new Uint32Array(data.cells);
      self.postMessage({ type: 'ready' });
      break;
      
    case 'updateCells':
      // Update cell data from main thread
      cpuCells = new Uint32Array(data.cells);
      break;
      
    case 'findPath':
      const { requestId, startX, startY, endX, endY } = data;
      const path = findPath(startX, startY, endX, endY);
      self.postMessage({ 
        type: 'pathResult', 
        data: { requestId, path } 
      });
      break;
  }
};
