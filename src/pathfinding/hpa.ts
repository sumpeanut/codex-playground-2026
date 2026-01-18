import { getTileDamage, getTilePassable, getTileSolid } from "../domain/tile.ts";

type Point = { x: number; y: number };

type ChunkBounds = { minX: number; minY: number; maxX: number; maxY: number };

type PortalNode = {
  id: number;
  x: number;
  y: number;
  chunkId: number;
};

type GraphEdge = {
  to: number;
  cost: number;
  path: Array<Point>;
};

type LocalPathResult = { path: Array<Point>; cost: number; expanded: number };

type HpaStats = {
  portals: number;
  chunks: number;
  abstractNodes: number;
  abstractEdges: number;
  abstractExpanded: number;
  localSearches: number;
  localExpanded: number;
};

export type HierarchicalPathfinder = {
  rebuild: () => void;
  findPath: (
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ) => { path: Array<Point>; stats: HpaStats };
};

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
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): HeapNode<T> | null {
    if (this.nodes.length === 0) return null;
    const min = this.nodes[0];
    const last = this.nodes.pop();
    if (this.nodes.length > 0 && last) {
      this.nodes[0] = last;
      this.sinkDown(0);
    }
    return min;
  }

  private bubbleUp(i: number) {
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

  private sinkDown(i: number) {
    const length = this.nodes.length;
    const node = this.nodes[i];
    const priority = node.priority;
    for (;;) {
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

export function createHierarchicalPathfinder({
  gridW,
  gridH,
  getCell,
  chunkSize = 16,
}: {
  gridW: number;
  gridH: number;
  getCell: (x: number, y: number) => number;
  chunkSize?: number;
}): HierarchicalPathfinder {
  const GRID_W = gridW;
  const GRID_H = gridH;
  const MAX_JUMP_UP = 5;
  const MAX_JUMP_ACROSS = 3;

  const chunksX = Math.ceil(GRID_W / chunkSize);
  const chunksY = Math.ceil(GRID_H / chunkSize);
  const chunkCount = chunksX * chunksY;

  let portalNodes: PortalNode[] = [];
  let portalMap = new Map<string, number>();
  let chunkPortals = new Map<number, number[]>();
  let adjacency = new Map<number, GraphEdge[]>();

  function getSolid(cell: number) {
    return getTileSolid(cell) && getTileDamage(cell) < 255;
  }

  function getPassable(cell: number) {
    return getTilePassable(cell);
  }

  function blocksEntity(cell: number) {
    return getSolid(cell) && !getPassable(cell);
  }

  const nodeKey = (x: number, y: number) => y * GRID_W + x;
  const keyToXY = (key: number) => ({ x: key % GRID_W, y: Math.floor(key / GRID_W) });

  function withinBounds(x: number, y: number, bounds?: ChunkBounds) {
    if (!bounds) return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  function isWalkable(x: number, y: number, bounds?: ChunkBounds) {
    if (!withinBounds(x, y, bounds)) return false;
    const cell = getCell(x, y);
    if (blocksEntity(cell)) return false;
    if (y + 1 >= GRID_H) return true;
    const below = getCell(x, y + 1);
    return getSolid(below);
  }

  function isJumpPathClear(x1: number, y1: number, x2: number, y2: number, bounds?: ChunkBounds) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) return true;

    const isFalling = dy > 0;

    if (isFalling) {
      for (let cy = y1 + 2; cy < y2; cy++) {
        if (!withinBounds(x1, cy, bounds)) return false;
        const cell = getCell(x1, cy);
        if (blocksEntity(cell)) return false;
      }
      if (dx !== 0) {
        const stepX = dx > 0 ? 1 : -1;
        for (let cx = x1 + stepX; cx !== x2 + stepX; cx += stepX) {
          if (!withinBounds(cx, y2, bounds)) return false;
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
      if (!withinBounds(cx, cy, bounds)) return false;
      const cell = getCell(cx, cy);
      if (blocksEntity(cell)) return false;
    }
    return true;
  }

  function isEdgeDropClear(x1: number, y1: number, x2: number, y2: number, bounds?: ChunkBounds) {
    if (!withinBounds(x2, y1, bounds)) return false;
    const edgeCell = getCell(x2, y1);
    if (blocksEntity(edgeCell)) return false;

    for (let cy = y1 + 1; cy < y2; cy++) {
      if (!withinBounds(x2, cy, bounds)) return false;
      const cell = getCell(x2, cy);
      if (blocksEntity(cell)) return false;
    }
    return true;
  }

  function canTraverse(x1: number, y1: number, x2: number, y2: number, bounds?: ChunkBounds) {
    if (!isWalkable(x2, y2, bounds)) return false;
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      return true;
    }

    if (dy < 0 && dy >= -MAX_JUMP_UP && Math.abs(dx) <= MAX_JUMP_ACROSS) {
      return isJumpPathClear(x1, y1, x2, y2, bounds);
    }

    if (dy > 0 && Math.abs(dx) <= MAX_JUMP_ACROSS) {
      if (Math.abs(dx) === 1 && dy > 1) {
        return isEdgeDropClear(x1, y1, x2, y2, bounds);
      }
      return isJumpPathClear(x1, y1, x2, y2, bounds);
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

  function getPossibleMoves(x: number, y: number, bounds?: ChunkBounds) {
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
      const nx = x + dx;
      const ny = y + dy;
      if (!withinBounds(nx, ny, bounds)) continue;
      moves.push([dx, dy]);
    }

    for (let jumpY = 2; jumpY <= MAX_JUMP_UP; jumpY++) {
      for (let jumpX = -MAX_JUMP_ACROSS; jumpX <= MAX_JUMP_ACROSS; jumpX++) {
        const nx = x + jumpX;
        const ny = y - jumpY;
        if (!withinBounds(nx, ny, bounds)) continue;
        moves.push([jumpX, -jumpY]);
      }
    }

    for (let fallY = 2; fallY <= GRID_H; fallY++) {
      for (let fallX = -MAX_JUMP_ACROSS; fallX <= MAX_JUMP_ACROSS; fallX++) {
        const targetY = y + fallY;
        const targetX = x + fallX;
        if (!withinBounds(targetX, targetY, bounds)) continue;
        if (isWalkable(targetX, targetY, bounds)) {
          moves.push([fallX, fallY]);
        }
      }
    }

    for (const stepX of [-1, 1]) {
      const edgeX = x + stepX;
      if (!withinBounds(edgeX, y, bounds)) continue;
      const edgeCell = getCell(edgeX, y);
      if (blocksEntity(edgeCell)) continue;
      if (isWalkable(edgeX, y, bounds)) continue;

      for (let fallY = 1; fallY <= GRID_H; fallY++) {
        const landY = y + fallY;
        if (!withinBounds(edgeX, landY, bounds)) break;
        if (isWalkable(edgeX, landY, bounds)) {
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

  function findNearestWalkable(x: number, y: number, bounds?: ChunkBounds) {
    if (isWalkable(x, y, bounds)) return { x, y };
    for (let r = 1; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (isWalkable(nx, ny, bounds)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  function localAStar(
    start: Point,
    end: Point,
    bounds?: ChunkBounds
  ): LocalPathResult | null {
    if (!withinBounds(start.x, start.y, bounds) || !withinBounds(end.x, end.y, bounds)) {
      return null;
    }

    const startPos = isWalkable(start.x, start.y, bounds)
      ? start
      : findNearestWalkable(start.x, start.y, bounds);
    const endPos = isWalkable(end.x, end.y, bounds) ? end : findNearestWalkable(end.x, end.y, bounds);

    if (!startPos || !endPos) return null;

    const endKey = nodeKey(endPos.x, endPos.y);
    const nodes = new Map<number, { g: number; parent: number | null }>();
    const closedSet = new Set<number>();
    const openSet = new BinaryHeap<Point>();

    const startKey = nodeKey(startPos.x, startPos.y);
    const startH = heuristic(startPos.x, startPos.y, endPos.x, endPos.y);
    nodes.set(startKey, { g: 0, parent: null });
    openSet.push(startKey, startH, { x: startPos.x, y: startPos.y });

    let iterations = 0;
    const maxIterations = (bounds ? (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) : GRID_W * GRID_H) * 2;

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++;

      const current = openSet.pop();
      if (!current) break;

      const currentKey = current.key;
      const cx = current.data.x;
      const cy = current.data.y;

      if (closedSet.has(currentKey)) continue;

      if (currentKey === endKey) {
        const path: Array<Point> = [];
        let ck: number | null = currentKey;
        while (ck !== null && nodes.has(ck)) {
          const { x, y } = keyToXY(ck);
          path.unshift({ x, y });
          ck = nodes.get(ck)?.parent ?? null;
        }
        const cost = nodes.get(currentKey)?.g ?? 0;
        return { path, cost, expanded: iterations };
      }

      closedSet.add(currentKey);
      const currentG = nodes.get(currentKey)?.g ?? 0;

      const moves = getPossibleMoves(cx, cy, bounds);

      for (const [dx, dy] of moves) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!withinBounds(nx, ny, bounds)) continue;
        const nk = nodeKey(nx, ny);

        if (closedSet.has(nk)) continue;
        if (!canTraverse(cx, cy, nx, ny, bounds)) continue;

        const tentativeG = currentG + getTraversalCost(cx, cy, nx, ny);
        const existingNode = nodes.get(nk);

        if (!existingNode) {
          const h = heuristic(nx, ny, endPos.x, endPos.y);
          nodes.set(nk, { g: tentativeG, parent: currentKey });
          openSet.push(nk, tentativeG + h, { x: nx, y: ny });
        } else if (tentativeG < existingNode.g) {
          existingNode.g = tentativeG;
          existingNode.parent = currentKey;
          const h = heuristic(nx, ny, endPos.x, endPos.y);
          openSet.push(nk, tentativeG + h, { x: nx, y: ny });
        }
      }
    }

    return null;
  }

  function getChunkId(x: number, y: number) {
    const cx = Math.floor(x / chunkSize);
    const cy = Math.floor(y / chunkSize);
    return cy * chunksX + cx;
  }

  function getChunkBounds(chunkId: number): ChunkBounds {
    const cx = chunkId % chunksX;
    const cy = Math.floor(chunkId / chunksX);
    const minX = cx * chunkSize;
    const minY = cy * chunkSize;
    const maxX = Math.min(minX + chunkSize - 1, GRID_W - 1);
    const maxY = Math.min(minY + chunkSize - 1, GRID_H - 1);
    return { minX, minY, maxX, maxY };
  }

  function getPortalKey(x: number, y: number, chunkId: number) {
    return `${chunkId}:${x}:${y}`;
  }

  function ensurePortal(x: number, y: number, chunkId: number) {
    const key = getPortalKey(x, y, chunkId);
    const existing = portalMap.get(key);
    if (existing !== undefined) return existing;
    const id = portalNodes.length;
    portalNodes.push({ id, x, y, chunkId });
    portalMap.set(key, id);
    const list = chunkPortals.get(chunkId) ?? [];
    list.push(id);
    chunkPortals.set(chunkId, list);
    return id;
  }

  function addEdge(from: number, edge: GraphEdge) {
    const edges = adjacency.get(from) ?? [];
    edges.push(edge);
    adjacency.set(from, edges);
  }

  function addIntraChunkEdges(chunkId: number, portalIds: number[]) {
    if (portalIds.length < 2) return;
    const bounds = getChunkBounds(chunkId);
    for (let i = 0; i < portalIds.length; i++) {
      for (let j = i + 1; j < portalIds.length; j++) {
        const a = portalNodes[portalIds[i]];
        const b = portalNodes[portalIds[j]];
        const result = localAStar({ x: a.x, y: a.y }, { x: b.x, y: b.y }, bounds);
        if (!result) continue;
        addEdge(a.id, { to: b.id, cost: result.cost, path: result.path });
        addEdge(b.id, { to: a.id, cost: result.cost, path: [...result.path].reverse() });
      }
    }
  }

  function rebuild() {
    portalNodes = [];
    portalMap = new Map();
    chunkPortals = new Map();
    adjacency = new Map();

    for (let chunkId = 0; chunkId < chunkCount; chunkId++) {
      const bounds = getChunkBounds(chunkId);
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (const y of [bounds.minY, bounds.maxY]) {
          if (!isWalkable(x, y)) continue;
          const neighbors: Array<[number, number]> = [
            [x, y - 1],
            [x, y + 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (!withinBounds(nx, ny)) continue;
            const neighborChunk = getChunkId(nx, ny);
            if (neighborChunk === chunkId) continue;
            if (!isWalkable(nx, ny)) continue;
            if (!canTraverse(x, y, nx, ny)) continue;
            const fromId = ensurePortal(x, y, chunkId);
            const toId = ensurePortal(nx, ny, neighborChunk);
            const cost = getTraversalCost(x, y, nx, ny);
            addEdge(fromId, { to: toId, cost, path: [{ x, y }, { x: nx, y: ny }] });
            addEdge(toId, { to: fromId, cost, path: [{ x: nx, y: ny }, { x, y }] });
          }
        }
      }

      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (const x of [bounds.minX, bounds.maxX]) {
          if (!isWalkable(x, y)) continue;
          const neighbors: Array<[number, number]> = [
            [x - 1, y],
            [x + 1, y],
          ];
          for (const [nx, ny] of neighbors) {
            if (!withinBounds(nx, ny)) continue;
            const neighborChunk = getChunkId(nx, ny);
            if (neighborChunk === chunkId) continue;
            if (!isWalkable(nx, ny)) continue;
            if (!canTraverse(x, y, nx, ny)) continue;
            const fromId = ensurePortal(x, y, chunkId);
            const toId = ensurePortal(nx, ny, neighborChunk);
            const cost = getTraversalCost(x, y, nx, ny);
            addEdge(fromId, { to: toId, cost, path: [{ x, y }, { x: nx, y: ny }] });
            addEdge(toId, { to: fromId, cost, path: [{ x: nx, y: ny }, { x, y }] });
          }
        }
      }
    }

    for (const [chunkId, portalIds] of chunkPortals.entries()) {
      addIntraChunkEdges(chunkId, portalIds);
    }
  }

  rebuild();

  function findPath(startX: number, startY: number, endX: number, endY: number) {
    const stats: HpaStats = {
      portals: portalNodes.length,
      chunks: chunkCount,
      abstractNodes: portalNodes.length,
      abstractEdges: Array.from(adjacency.values()).reduce((sum, edges) => sum + edges.length, 0),
      abstractExpanded: 0,
      localSearches: 0,
      localExpanded: 0,
    };

    startX = Math.max(0, Math.min(GRID_W - 1, startX));
    startY = Math.max(0, Math.min(GRID_H - 1, startY));
    endX = Math.max(0, Math.min(GRID_W - 1, endX));
    endY = Math.max(0, Math.min(GRID_H - 1, endY));

    const start = findNearestWalkable(startX, startY);
    const end = findNearestWalkable(endX, endY);

    if (!start || !end) {
      return { path: [], stats };
    }

    const startChunk = getChunkId(start.x, start.y);
    const endChunk = getChunkId(end.x, end.y);

    const startNodeId = -1;
    const endNodeId = -2;
    const dynamicEdges = new Map<number, GraphEdge[]>();
    const dynamicNodes = new Map<number, Point>([
      [startNodeId, start],
      [endNodeId, end],
    ]);

    function addDynamicEdge(from: number, edge: GraphEdge) {
      const edges = dynamicEdges.get(from) ?? [];
      edges.push(edge);
      dynamicEdges.set(from, edges);
    }

    const startBounds = getChunkBounds(startChunk);
    const endBounds = getChunkBounds(endChunk);

    if (startChunk === endChunk) {
      const direct = localAStar(start, end, startBounds);
      stats.localSearches += 1;
      stats.localExpanded += direct?.expanded ?? 0;
      if (direct) {
        addDynamicEdge(startNodeId, { to: endNodeId, cost: direct.cost, path: direct.path });
        addDynamicEdge(endNodeId, { to: startNodeId, cost: direct.cost, path: [...direct.path].reverse() });
      }
    }

    const startPortals = chunkPortals.get(startChunk) ?? [];
    for (const portalId of startPortals) {
      const portal = portalNodes[portalId];
      const local = localAStar(start, { x: portal.x, y: portal.y }, startBounds);
      stats.localSearches += 1;
      stats.localExpanded += local?.expanded ?? 0;
      if (local) {
        addDynamicEdge(startNodeId, { to: portalId, cost: local.cost, path: local.path });
      }
    }

    const endPortals = chunkPortals.get(endChunk) ?? [];
    for (const portalId of endPortals) {
      const portal = portalNodes[portalId];
      const local = localAStar({ x: portal.x, y: portal.y }, end, endBounds);
      stats.localSearches += 1;
      stats.localExpanded += local?.expanded ?? 0;
      if (local) {
        addDynamicEdge(portalId, { to: endNodeId, cost: local.cost, path: local.path });
      }
    }

    function getNodePosition(id: number) {
      if (dynamicNodes.has(id)) return dynamicNodes.get(id)!;
      const node = portalNodes[id];
      return { x: node.x, y: node.y };
    }

    function getEdges(id: number) {
      const base = adjacency.get(id) ?? [];
      const extra = dynamicEdges.get(id) ?? [];
      return base.concat(extra);
    }

    const openSet = new BinaryHeap<Point>();
    const nodes = new Map<number, { g: number; parent: number | null; edge: GraphEdge | null }>();
    const closedSet = new Set<number>();

    const startPos = getNodePosition(startNodeId);
    const endPos = getNodePosition(endNodeId);
    const startH = heuristic(startPos.x, startPos.y, endPos.x, endPos.y);
    nodes.set(startNodeId, { g: 0, parent: null, edge: null });
    openSet.push(startNodeId, startH, startPos);

    while (openSet.size > 0) {
      const current = openSet.pop();
      if (!current) break;
      const currentId = current.key;

      if (closedSet.has(currentId)) continue;
      if (currentId === endNodeId) {
        const pathSegments: Array<Point> = [];
        let cursor: number | null = currentId;
        let segmentEdges: GraphEdge[] = [];
        while (cursor !== null && nodes.has(cursor)) {
          const entry = nodes.get(cursor)!;
          if (entry.edge) {
            segmentEdges.unshift(entry.edge);
          }
          cursor = entry.parent;
        }

        for (const edge of segmentEdges) {
          if (edge.path.length === 0) continue;
          if (pathSegments.length === 0) {
            pathSegments.push(...edge.path);
          } else {
            pathSegments.push(...edge.path.slice(1));
          }
        }

        if (pathSegments.length > 0) {
          pathSegments.shift();
        }
        return { path: pathSegments, stats };
      }

      closedSet.add(currentId);
      stats.abstractExpanded += 1;
      const currentG = nodes.get(currentId)?.g ?? 0;

      for (const edge of getEdges(currentId)) {
        const nextId = edge.to;
        if (closedSet.has(nextId)) continue;
        const nextPos = getNodePosition(nextId);
        const tentativeG = currentG + edge.cost;
        const existing = nodes.get(nextId);
        if (!existing || tentativeG < existing.g) {
          const h = heuristic(nextPos.x, nextPos.y, endPos.x, endPos.y);
          nodes.set(nextId, { g: tentativeG, parent: currentId, edge });
          openSet.push(nextId, tentativeG + h, nextPos);
        }
      }
    }

    return { path: [], stats };
  }

  return {
    rebuild,
    findPath,
  };
}
