export type Pathfinder = {
  findPath: (startX: number, startY: number, endX: number, endY: number) => Array<{ x: number; y: number }>;
  isWalkable: (x: number, y: number) => boolean;
  findNearestWalkable: (x: number, y: number) => { x: number; y: number } | null;
  getSolid: (cell: number) => boolean;
  getPassable: (cell: number) => boolean;
  blocksEntity: (cell: number) => boolean;
};

export function createPathfinder({
  gridW,
  gridH,
  getCell,
}: {
  gridW: number;
  gridH: number;
  getCell: (x: number, y: number) => number;
}): Pathfinder {
  const GRID_W = gridW;
  const GRID_H = gridH;

  const MAX_JUMP_UP = 5;
  const MAX_JUMP_ACROSS = 3;

  type HeapNode<T> = { key: number; priority: number; data: T };

  class BinaryHeap<T> {
    nodes: Array<HeapNode<T>>;

    constructor() {
      this.nodes = [];
    }

    get size() {
      return this.nodes.length;
    }

    push(key: number, priority: number, data: T) {
      const node = { key, priority, data };
      this.nodes.push(node);
      this._bubbleUp(this.nodes.length - 1);
    }

    pop(): HeapNode<T> | null {
      if (this.nodes.length === 0) return null;
      const min = this.nodes[0];
      const last = this.nodes.pop();
      if (this.nodes.length > 0 && last) {
        this.nodes[0] = last;
        this._sinkDown(0);
      }
      return min;
    }

    _bubbleUp(i: number) {
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

    _sinkDown(i: number) {
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

  function getSolid(cell: number) {
    const dmg = cell & 0xff;
    const solidBit = (cell >> 8) & 1;
    return solidBit === 1 && dmg < 255;
  }

  function getPassable(cell: number) {
    return ((cell >> 9) & 1) === 1;
  }

  function blocksEntity(cell: number) {
    return getSolid(cell) && !getPassable(cell);
  }

  const nodeKey = (x: number, y: number) => y * GRID_W + x;
  const keyToXY = (key: number) => ({ x: key % GRID_W, y: Math.floor(key / GRID_W) });

  function isWalkable(x: number, y: number) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
    const cell = getCell(x, y);
    if (blocksEntity(cell)) return false;
    if (y + 1 >= GRID_H) return true;
    const below = getCell(x, y + 1);
    return getSolid(below);
  }

  function isJumpPathClear(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) return true;

    const isFalling = dy > 0;

    if (isFalling) {
      for (let cy = y1 + 2; cy < y2; cy++) {
        if (cy < 0 || cy >= GRID_H) continue;
        const cell = getCell(x1, cy);
        if (blocksEntity(cell)) return false;
      }
      if (dx !== 0) {
        const stepX = dx > 0 ? 1 : -1;
        for (let cx = x1 + stepX; cx !== x2 + stepX; cx += stepX) {
          if (cx < 0 || cx >= GRID_W) continue;
          const cellAtLanding = getCell(cx, y2);
          const cellAboveLanding = y2 > 0 ? getCell(cx, y2 - 1) : 0;
          if (blocksEntity(cellAtLanding) || blocksEntity(cellAboveLanding)) return false;
        }
      }
      return true;
    }

    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = Math.round(x1 + dx * t);
      const cy = Math.round(y1 + dy * t);
      if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) continue;
      const cell = getCell(cx, cy);
      if (blocksEntity(cell)) return false;
    }
    return true;
  }

  function isEdgeDropClear(x1: number, y1: number, x2: number, y2: number) {
    const edgeCell = getCell(x2, y1);
    if (blocksEntity(edgeCell)) return false;

    for (let cy = y1 + 1; cy < y2; cy++) {
      if (cy < 0 || cy >= GRID_H) continue;
      const cell = getCell(x2, cy);
      if (blocksEntity(cell)) return false;
    }
    return true;
  }

  function canTraverse(x1: number, y1: number, x2: number, y2: number) {
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

  function getTraversalCost(x1: number, y1: number, x2: number, y2: number) {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);

    if (dx <= 1 && dy <= 1) {
      return dx !== 0 && dy !== 0 ? 1.414 : 1;
    }

    return Math.sqrt(dx * dx + dy * dy) * 1.5;
  }

  function getPossibleMoves(x: number, y: number) {
    const moves: Array<[number, number]> = [];

    const walkDirs: Array<[number, number]> = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
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
      const edgeCell = getCell(edgeX, y);
      if (blocksEntity(edgeCell)) continue;
      if (isWalkable(edgeX, y)) continue;

      for (let fallY = 1; fallY <= GRID_H; fallY++) {
        const landY = y + fallY;
        if (landY >= GRID_H) break;
        if (isWalkable(edgeX, landY)) {
          moves.push([stepX, fallY]);
          break;
        }
        const cellBelow = getCell(edgeX, landY);
        if (blocksEntity(cellBelow)) break;
      }
    }

    return moves;
  }

  function heuristic(x1: number, y1: number, x2: number, y2: number) {
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  function findNearestWalkable(x: number, y: number) {
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

  function findPath(startX: number, startY: number, endX: number, endY: number) {
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
    const nodes = new Map<number, { g: number; parent: number | null }>();
    const closedSet = new Set<number>();
    const openSet = new BinaryHeap<{ x: number; y: number }>();

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
        const path: Array<{ x: number; y: number }> = [];
        let ck: number | null = currentKey;
        while (ck !== null && nodes.has(ck)) {
          const { x, y } = keyToXY(ck);
          path.unshift({ x, y });
          ck = nodes.get(ck)?.parent ?? null;
        }
        if (path.length > 0) path.shift();
        return path;
      }

      closedSet.add(currentKey);
      const currentG = nodes.get(currentKey)?.g ?? 0;

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

  return {
    findPath,
    isWalkable,
    findNearestWalkable,
    getSolid,
    getPassable,
    blocksEntity,
  };
}
