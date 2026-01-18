export type FlowField = {
  build: (goalX: number, goalY: number) => void;
  getVector: (x: number, y: number) => { dx: number; dy: number };
  getCost: (x: number, y: number) => number;
  getGoal: () => { x: number; y: number } | null;
};

type FlowFieldOptions = {
  gridW: number;
  gridH: number;
  isWalkable: (x: number, y: number) => boolean;
  findNearestWalkable?: (x: number, y: number) => { x: number; y: number } | null;
};

type HeapNode = { key: number; cost: number };

class MinHeap {
  nodes: Array<HeapNode> = [];

  get size() {
    return this.nodes.length;
  }

  push(node: HeapNode) {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop() {
    if (this.nodes.length === 0) return null;
    const min = this.nodes[0];
    const last = this.nodes.pop();
    if (this.nodes.length > 0 && last) {
      this.nodes[0] = last;
      this.sinkDown(0);
    }
    return min;
  }

  bubbleUp(index: number) {
    const node = this.nodes[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = this.nodes[parentIndex];
      if (node.cost >= parent.cost) break;
      this.nodes[index] = parent;
      index = parentIndex;
    }
    this.nodes[index] = node;
  }

  sinkDown(index: number) {
    const length = this.nodes.length;
    const node = this.nodes[index];
    for (;;) {
      const left = (index << 1) + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.nodes[left].cost < this.nodes[smallest].cost) {
        smallest = left;
      }
      if (right < length && this.nodes[right].cost < this.nodes[smallest].cost) {
        smallest = right;
      }
      if (smallest === index) break;
      this.nodes[index] = this.nodes[smallest];
      index = smallest;
    }
    this.nodes[index] = node;
  }
}

export function createFlowField({ gridW, gridH, isWalkable, findNearestWalkable }: FlowFieldOptions): FlowField {
  const size = gridW * gridH;
  const costs = new Float32Array(size);
  const vectors = new Int8Array(size * 2);
  let goal: { x: number; y: number } | null = null;

  const index = (x: number, y: number) => y * gridW + x;

  function reset() {
    costs.fill(Number.POSITIVE_INFINITY);
    vectors.fill(0);
  }

  const neighbors: Array<[number, number, number]> = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, 1, Math.SQRT2],
  ];

  function build(goalX: number, goalY: number) {
    reset();
    goalX = Math.max(0, Math.min(gridW - 1, goalX));
    goalY = Math.max(0, Math.min(gridH - 1, goalY));

    let resolvedGoal = { x: goalX, y: goalY };
    if (!isWalkable(goalX, goalY) && findNearestWalkable) {
      const nearest = findNearestWalkable(goalX, goalY);
      if (nearest) resolvedGoal = nearest;
    }

    if (!isWalkable(resolvedGoal.x, resolvedGoal.y)) {
      goal = null;
      return;
    }

    goal = resolvedGoal;
    const heap = new MinHeap();
    const goalIndex = index(goal.x, goal.y);
    costs[goalIndex] = 0;
    heap.push({ key: goalIndex, cost: 0 });

    while (heap.size > 0) {
      const current = heap.pop();
      if (!current) break;
      if (current.cost > costs[current.key]) continue;

      const cx = current.key % gridW;
      const cy = Math.floor(current.key / gridW);

      for (const [dx, dy, stepCost] of neighbors) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        if (!isWalkable(nx, ny)) continue;
        const nk = index(nx, ny);
        const nextCost = current.cost + stepCost;
        if (nextCost < costs[nk]) {
          costs[nk] = nextCost;
          heap.push({ key: nk, cost: nextCost });
        }
      }
    }

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const key = index(x, y);
        if (!Number.isFinite(costs[key]) || !isWalkable(x, y)) {
          vectors[key * 2] = 0;
          vectors[key * 2 + 1] = 0;
          continue;
        }

        let bestCost = costs[key];
        let bestDx = 0;
        let bestDy = 0;

        for (const [dx, dy] of neighbors) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          if (!isWalkable(nx, ny)) continue;
          const nk = index(nx, ny);
          const neighborCost = costs[nk];
          if (neighborCost < bestCost) {
            bestCost = neighborCost;
            bestDx = dx;
            bestDy = dy;
          }
        }

        vectors[key * 2] = bestDx;
        vectors[key * 2 + 1] = bestDy;
      }
    }
  }

  function getVector(x: number, y: number) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return { dx: 0, dy: 0 };
    const key = index(x, y);
    return { dx: vectors[key * 2], dy: vectors[key * 2 + 1] };
  }

  function getCost(x: number, y: number) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return Number.POSITIVE_INFINITY;
    return costs[index(x, y)];
  }

  function getGoal() {
    return goal;
  }

  return {
    build,
    getVector,
    getCost,
    getGoal,
  };
}
