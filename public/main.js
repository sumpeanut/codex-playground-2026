const canvas = document.getElementById("c");
const overlay = document.getElementById("overlay");

const ui = {
  radius: document.getElementById("radius"),
  damage: document.getElementById("damage"),
  bondWeaken: document.getElementById("bondWeaken"),
  relaxIters: document.getElementById("relaxIters"),
  radiusVal: document.getElementById("radiusVal"),
  damageVal: document.getElementById("damageVal"),
  bondWeakenVal: document.getElementById("bondWeakenVal"),
  relaxItersVal: document.getElementById("relaxItersVal"),
  reset: document.getElementById("reset"),
  showQuadTree: document.getElementById("showQuadTree"),
  spawnEntity: document.getElementById("spawnEntity"),
  entityCount: document.getElementById("entityCount"),
};

function syncUI() {
  ui.radiusVal.textContent = ui.radius.value;
  ui.damageVal.textContent = ui.damage.value;
  ui.bondWeakenVal.textContent = ui.bondWeaken.value;
  ui.relaxItersVal.textContent = ui.relaxIters.value;
}
["input", "change"].forEach(ev => {
  ui.radius.addEventListener(ev, syncUI);
  ui.damage.addEventListener(ev, syncUI);
  ui.bondWeaken.addEventListener(ev, syncUI);
  ui.relaxIters.addEventListener(ev, syncUI);
});
syncUI();

if (!navigator.gpu) throw new Error("WebGPU not supported. Use a WebGPU-enabled browser.");

const GRID_W = 256;
const GRID_H = 144;

const dpr = window.devicePixelRatio || 1;
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  overlay.width = canvas.width;
  overlay.height = canvas.height;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const state = { mx: 0, my: 0, mdown: 0, repair: 0, frame: 0 };
const overlayCtx = overlay.getContext("2d");

// ---- Entity System ----
const entities = [];
let selectedEntity = null;
let entityIdCounter = 0;
let findPath = null; // Will be set inside init() when pathfinding is ready
let expandPath = null; // Will be set inside init()

function createEntity(x, y) {
  const entity = {
    id: entityIdCounter++,
    x: x,
    y: y,
    path: [],
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    baseSpeed: 0.15, // base cells per frame for walking
    currentSpeed: 0.15,
    moveProgress: 0,
    fallVelocity: 0, // current fall speed
  };
  entities.push(entity);
  updateEntityCountUI();
  return entity;
}

function updateEntityCountUI() {
  ui.entityCount.textContent = entities.length;
}

canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  const gridX = Math.floor(nx * GRID_W);
  const gridY = Math.floor(ny * GRID_H);

  // Ctrl+click for entity interaction
  if (e.ctrlKey || e.metaKey) {
    // Check if clicking on an entity
    const clickedEntity = entities.find(ent => {
      const dx = Math.abs(ent.x - gridX);
      const dy = Math.abs(ent.y - gridY);
      return dx <= 2 && dy <= 2;
    });

    if (clickedEntity) {
      selectedEntity = clickedEntity;
    } else if (selectedEntity && findPath) {
      // Debug: log pathfinding attempt
      console.log(`Pathfinding from (${Math.floor(selectedEntity.x)}, ${Math.floor(selectedEntity.y)}) to (${gridX}, ${gridY})`);
      
      // Move selected entity to clicked position (pathfinding)
      const path = findPath(
        Math.floor(selectedEntity.x), Math.floor(selectedEntity.y),
        gridX, gridY
      );
      console.log(`Path found: ${path.length} steps`);
      if (path.length > 0) {
        // Expand path for smooth movement on jumps/falls
        selectedEntity.path = expandPath(path, selectedEntity.x, selectedEntity.y);
        selectedEntity.moveProgress = 0;
      } else {
        console.log('No path found!');
      }
    }
    return; // Don't apply brush when doing entity stuff
  }

  canvas.setPointerCapture(e.pointerId);
  state.mdown = 1;
  state.repair = e.shiftKey ? 1 : 0;
  setMouse(e);
});
canvas.addEventListener("pointerup", () => { state.mdown = 0; });
canvas.addEventListener("pointermove", (e) => {
  state.repair = e.shiftKey ? 1 : 0;
  setMouse(e);
});

function setMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  state.mx = Math.max(0, Math.min(GRID_W - 1, Math.floor(nx * GRID_W)));
  state.my = Math.max(0, Math.min(GRID_H - 1, Math.floor(ny * GRID_H)));
}

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat, alphaMode: "opaque" });

  const wgsl = await (await fetch("./shaders.wgsl")).text();
  const shader = device.createShaderModule({ code: wgsl });

  const cellCount = GRID_W * GRID_H;
  const cellsBytes = cellCount * 4;
  const cpuCells = new Uint32Array(cellCount);

  const bondsHCount = (GRID_W - 1) * GRID_H;
  const bondsVCount = GRID_W * (GRID_H - 1);

  const cellsA = device.createBuffer({
    size: cellsBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const cellsB = device.createBuffer({
    size: cellsBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const bondsH = device.createBuffer({
    size: bondsHCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const bondsV = device.createBuffer({
    size: bondsVCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // Uniform params: 13 u32 (see WGSL struct Params, padded to 16-byte boundary = 64 bytes)
  const paramsU32 = 16;
  const paramsBuf = device.createBuffer({
    size: paramsU32 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const visTex = device.createTexture({
    size: { width: GRID_W, height: GRID_H },
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Compute bind group layout (group 0)
  const computeBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
    ],
  });

  const computeBG = device.createBindGroup({
    layout: computeBGL,
    entries: [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: cellsA } },
      { binding: 2, resource: { buffer: cellsB } },
      { binding: 3, resource: { buffer: bondsH } },
      { binding: 4, resource: { buffer: bondsV } },
      { binding: 5, resource: visTex.createView() },
    ],
  });

  const computeLayout = device.createPipelineLayout({ bindGroupLayouts: [computeBGL] });

  const brushPipe = device.createComputePipeline({
    layout: computeLayout,
    compute: { module: shader, entryPoint: "brush" },
  });
  const bondsDecayPipe = device.createComputePipeline({
    layout: computeLayout,
    compute: { module: shader, entryPoint: "bonds_decay" },
  });
  const stepPipe = device.createComputePipeline({
    layout: computeLayout,
    compute: { module: shader, entryPoint: "step" },
  });
  const relaxPipe = device.createComputePipeline({
    layout: computeLayout,
    compute: { module: shader, entryPoint: "relax" },
  });
  const visPipe = device.createComputePipeline({
    layout: computeLayout,
    compute: { module: shader, entryPoint: "visualize" },
  });

  // Render bind group layout (group 1 in WGSL)
  const renderBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

  const renderBG = device.createBindGroup({
    layout: renderBGL,
    entries: [
      { binding: 0, resource: visTex.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  // Render pipeline layout uses only renderBGL at group 0
  const renderPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
    vertex: { module: shader, entryPoint: "vs_fullscreen" },
    fragment: { module: shader, entryPoint: "fs_present", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list" },
  });

  function resetWorld() {
    const cells = new Uint32Array(cellCount);

    function setSolid(x, y, dmg = 0) {
      cells[y * GRID_W + x] = (dmg & 0xff) | (1 << 8);
    }

    // Ground slab
    for (let y = GRID_H - 18; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) setSolid(x, y, 0);
    }

    // Two buildings
    function rect(x0, y0, w, h) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setSolid(x, y, 0);
    }
    rect(40, GRID_H - 60, 34, 42);
    rect(150, GRID_H - 70, 44, 52);

    // Window hole
    for (let y = GRID_H - 52; y < GRID_H - 36; y++) {
      for (let x = 48; x < 60; x++) cells[y * GRID_W + x] = 0;
    }

    device.queue.writeBuffer(cellsA, 0, cells);
    device.queue.writeBuffer(cellsB, 0, cells);
    cpuCells.set(cells);

    const h = new Uint32Array(bondsHCount);
    const v = new Uint32Array(bondsVCount);
    h.fill(255);
    v.fill(255);
    device.queue.writeBuffer(bondsH, 0, h);
    device.queue.writeBuffer(bondsV, 0, v);
  }

  ui.reset.addEventListener("click", resetWorld);
  resetWorld();

  // ---- Conceptual QuadTree (CPU-side scaffold for future GPU-driven culling) ----
  const quadState = { root: null, lastBuiltFrame: -1, readbackInFlight: false };
  const readbackBuffer = device.createBuffer({
    size: cellsBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  function getSolid(cell) {
    const dmg = cell & 0xff;
    const solidBit = (cell >> 8) & 1;
    return solidBit === 1 && dmg < 255;
  }

  async function requestGpuReadback() {
    if (quadState.readbackInFlight) return;
    quadState.readbackInFlight = true;
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(cellsA, 0, readbackBuffer, 0, cellsBytes);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    cpuCells.set(new Uint32Array(readbackBuffer.getMappedRange()));
    readbackBuffer.unmap();
    quadState.readbackInFlight = false;
    rebuildQuadTree();
  }

  function buildQuadTree(x, y, w, h, maxDepth, depth = 0) {
    let allSolid = true;
    let allEmpty = true;

    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= GRID_H) {
        allSolid = false;
        continue;
      }
      const row = yy * GRID_W;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= GRID_W) {
          allSolid = false;
          continue;
        }
        const solid = getSolid(cpuCells[row + xx]);
        if (solid) {
          allEmpty = false;
        } else {
          allSolid = false;
        }
        if (!allSolid && !allEmpty) break;
      }
      if (!allSolid && !allEmpty) break;
    }

    const uniform = allSolid || allEmpty;
    if (uniform || depth >= maxDepth || (w <= 4 && h <= 4)) {
      return { x, y, w, h, state: allSolid ? "solid" : "empty", children: null };
    }

    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    return {
      x,
      y,
      w,
      h,
      state: "mixed",
      children: [
        buildQuadTree(x, y, hw, hh, maxDepth, depth + 1),
        buildQuadTree(x + hw, y, w - hw, hh, maxDepth, depth + 1),
        buildQuadTree(x, y + hh, hw, h - hh, maxDepth, depth + 1),
        buildQuadTree(x + hw, y + hh, w - hw, h - hh, maxDepth, depth + 1),
      ],
    };
  }

  function rebuildQuadTree() {
    const maxDepth = 6;
    quadState.root = buildQuadTree(0, 0, GRID_W, GRID_H, maxDepth);
    quadState.lastBuiltFrame = state.frame;
  }

  function drawQuadTree(node) {
    if (!node) return;
    if (node.children) {
      node.children.forEach(drawQuadTree);
      return;
    }
    if (node.state === "empty") return;
    const scaleX = overlay.width / GRID_W;
    const scaleY = overlay.height / GRID_H;
    overlayCtx.strokeStyle = node.state === "solid" ? "rgba(120, 200, 255, 0.5)" : "rgba(255, 200, 120, 0.5)";
    overlayCtx.strokeRect(
      node.x * scaleX + 0.5,
      node.y * scaleY + 0.5,
      node.w * scaleX,
      node.h * scaleY
    );
  }

  // ---- Walkable Surface Detection ----
  // A cell is walkable if it's empty AND has a solid cell directly below it
  function isWalkable(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
    const cell = cpuCells[y * GRID_W + x];
    if (getSolid(cell)) return false; // Can't walk inside solid
    // Check if there's solid ground below
    if (y + 1 >= GRID_H) return true; // Bottom edge is walkable
    const below = cpuCells[(y + 1) * GRID_W + x];
    return getSolid(below);
  }

  // Check if the path is clear (no solid cells blocking the jump arc)
  // For falling (dy > 0), we need to skip checking the ground cell directly below start
  function isJumpPathClear(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) return true;
    
    const isFalling = dy > 0;
    
    if (isFalling) {
      // For falling: check that vertical path is clear
      // First go down in current column, then move horizontally at the end
      // Check vertical drop (skip y1+1 which is the ground we stand on)
      for (let cy = y1 + 2; cy < y2; cy++) {
        if (cy < 0 || cy >= GRID_H) continue;
        const cell = cpuCells[cy * GRID_W + x1];
        if (getSolid(cell)) return false;
      }
      // If moving horizontally, check that horizontal path at landing level is clear
      if (dx !== 0) {
        const stepX = dx > 0 ? 1 : -1;
        for (let cx = x1 + stepX; cx !== x2 + stepX; cx += stepX) {
          if (cx < 0 || cx >= GRID_W) continue;
          // Check the cell at the landing row (y2) and one above it
          const cellAtLanding = cpuCells[y2 * GRID_W + cx];
          const cellAboveLanding = y2 > 0 ? cpuCells[(y2 - 1) * GRID_W + cx] : 0;
          if (getSolid(cellAtLanding) || getSolid(cellAboveLanding)) return false;
        }
      }
      return true;
    } else {
      // For jumping up: linear interpolation check
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const cx = Math.round(x1 + dx * t);
        const cy = Math.round(y1 + dy * t);
        if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) continue;
        const cell = cpuCells[cy * GRID_W + cx];
        if (getSolid(cell)) return false;
      }
      return true;
    }
  }

  const MAX_JUMP_UP = 5;    // Can jump up 5 cells
  const MAX_JUMP_ACROSS = 3; // Horizontal reach when jumping

  // Check if can traverse between cells (accounting for jumps)
  function canTraverse(x1, y1, x2, y2) {
    if (!isWalkable(x2, y2)) return false;
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    // Regular walking (1 step in any direction)
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      return true;
    }
    
    // Jumping up (dy negative means going up in screen coords)
    if (dy < 0 && dy >= -MAX_JUMP_UP && Math.abs(dx) <= MAX_JUMP_ACROSS) {
      return isJumpPathClear(x1, y1, x2, y2);
    }
    
    // Falling down (any distance, horizontal distance of 1 = step off edge)
    if (dy > 0 && Math.abs(dx) <= MAX_JUMP_ACROSS) {
      // For step-off-edge moves (dx=1, dy>1), check the fall path from edge
      if (Math.abs(dx) === 1 && dy > 1) {
        return isEdgeDropClear(x1, y1, x2, y2);
      }
      return isJumpPathClear(x1, y1, x2, y2);
    }
    
    return false;
  }

  // Check if stepping off an edge and falling is clear
  function isEdgeDropClear(x1, y1, x2, y2) {
    // Check if we can step sideways (the cell we step into)
    const edgeCell = cpuCells[y1 * GRID_W + x2];
    if (getSolid(edgeCell)) return false;
    
    // Check the vertical fall path from (x2, y1) down to (x2, y2)
    for (let cy = y1 + 1; cy < y2; cy++) {
      if (cy < 0 || cy >= GRID_H) continue;
      const cell = cpuCells[cy * GRID_W + x2];
      if (getSolid(cell)) return false;
    }
    return true;
  }

  // Get movement cost for a traversal
  function getTraversalCost(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    
    // Regular movement
    if (dx <= 1 && dy <= 1) {
      return dx !== 0 && dy !== 0 ? 1.414 : 1;
    }
    
    // Jumps have higher cost to prefer walking when possible
    return Math.sqrt(dx * dx + dy * dy) * 1.5;
  }

  // Generate possible moves from a position (including jumps)
  function getPossibleMoves(x, y) {
    const moves = [];
    
    // Regular walking directions
    const walkDirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1]
    ];
    for (const [dx, dy] of walkDirs) {
      moves.push([dx, dy]);
    }
    
    // Jump up moves (up to MAX_JUMP_UP high, MAX_JUMP_ACROSS wide)
    for (let jumpY = 2; jumpY <= MAX_JUMP_UP; jumpY++) {
      for (let jumpX = -MAX_JUMP_ACROSS; jumpX <= MAX_JUMP_ACROSS; jumpX++) {
        moves.push([jumpX, -jumpY]); // Negative Y = up
      }
    }
    
    // Fall down moves (scan for landing spots below current position)
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
    
    // "Step off edge" moves - step sideways into air and fall to a landing spot
    // This handles cases where we're on a platform and need to walk off the edge
    for (const stepX of [-1, 1]) {
      const edgeX = x + stepX;
      // Check if the adjacent cell is empty (not walkable, but not solid either)
      if (edgeX < 0 || edgeX >= GRID_W) continue;
      const edgeCell = cpuCells[y * GRID_W + edgeX];
      if (getSolid(edgeCell)) continue; // Can't step into solid
      if (isWalkable(edgeX, y)) continue; // Already handled by normal walking
      
      // This is an empty cell with no ground - find where we'd land
      for (let fallY = 1; fallY <= GRID_H; fallY++) {
        const landY = y + fallY;
        if (landY >= GRID_H) break;
        if (isWalkable(edgeX, landY)) {
          // Found landing spot - add move that goes to the landing position
          moves.push([stepX, fallY]);
          break; // Only add the first (highest) landing spot
        }
        // Check if we hit solid before finding walkable (inside a structure)
        const cellBelow = cpuCells[landY * GRID_W + edgeX];
        if (getSolid(cellBelow)) break; // Can't fall through solid
      }
    }
    
    return moves;
  }

  // ---- A* Pathfinding ----
  findPath = function(startX, startY, endX, endY) {
    // Clamp to grid
    startX = Math.max(0, Math.min(GRID_W - 1, startX));
    startY = Math.max(0, Math.min(GRID_H - 1, startY));
    endX = Math.max(0, Math.min(GRID_W - 1, endX));
    endY = Math.max(0, Math.min(GRID_H - 1, endY));

    // Find nearest walkable cell to start and end
    const start = findNearestWalkable(startX, startY);
    const end = findNearestWalkable(endX, endY);
    
    console.log(`  findPath: start (${startX},${startY}) -> walkable: ${start ? `(${start.x},${start.y})` : 'null'}`);
    console.log(`  findPath: end (${endX},${endY}) -> walkable: ${end ? `(${end.x},${end.y})` : 'null'}`);
    
    if (!start || !end) {
      console.log('  No walkable start or end found');
      return [];
    }
    
    // Debug: check if direct fall is possible
    if (end.y > start.y) {
      const dy = end.y - start.y;
      const dx = end.x - start.x;
      console.log(`  Fall distance: ${dy}, horizontal: ${dx}`);
      console.log(`  isWalkable(end): ${isWalkable(end.x, end.y)}`);
      console.log(`  canTraverse direct: ${canTraverse(start.x, start.y, end.x, end.y)}`);
    }

    const key = (x, y) => `${x},${y}`;
    const openSet = new Map();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = key(start.x, start.y);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(start.x, start.y, end.x, end.y));
    openSet.set(startKey, start);

    // Debug: Check if walking is possible from start
    const walkMoves = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    console.log(`  Walkable neighbors from start:`);
    for (const [dx, dy] of walkMoves) {
      const nx = start.x + dx;
      const ny = start.y + dy;
      const walkable = isWalkable(nx, ny);
      const canTrav = canTraverse(start.x, start.y, nx, ny);
      if (walkable || canTrav) {
        console.log(`    (${nx}, ${ny}): walkable=${walkable}, canTraverse=${canTrav}`);
      }
    }
    
    // Debug: Check fall options from start
    const fallMoves = getPossibleMoves(start.x, start.y).filter(([dx, dy]) => dy > 1);
    console.log(`  Fall options from start: ${fallMoves.length}`);
    if (fallMoves.length > 0 && fallMoves.length <= 10) {
      console.log(`  First few falls: ${JSON.stringify(fallMoves.slice(0, 5))}`);
    }

    let iterations = 0;
    const maxIterations = GRID_W * GRID_H * 2;

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++;

      // Get node with lowest fScore
      let current = null;
      let currentKey = null;
      let lowestF = Infinity;
      for (const [k, node] of openSet) {
        const f = fScore.get(k) || Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = node;
          currentKey = k;
        }
      }

      if (!current) break; // No valid node found

      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path
        const path = [];
        let ck = currentKey;
        while (cameFrom.has(ck)) {
          const [px, py] = ck.split(',').map(Number);
          path.unshift({ x: px, y: py });
          ck = cameFrom.get(ck);
        }
        return path;
      }

      openSet.delete(currentKey);
      closedSet.add(currentKey);

      // Get all possible moves including jumps from current position
      const moves = getPossibleMoves(current.x, current.y);
      
      for (const [dx, dy] of moves) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nk = key(nx, ny);

        if (closedSet.has(nk)) continue;
        if (!canTraverse(current.x, current.y, nx, ny)) continue;

        const tentativeG = (gScore.get(currentKey) || 0) + 
          getTraversalCost(current.x, current.y, nx, ny);

        if (!openSet.has(nk)) {
          openSet.set(nk, { x: nx, y: ny });
        } else if (tentativeG >= (gScore.get(nk) || Infinity)) {
          continue;
        }

        cameFrom.set(nk, currentKey);
        gScore.set(nk, tentativeG);
        fScore.set(nk, tentativeG + heuristic(nx, ny, end.x, end.y));
      }
    }

    console.log(`  Search ended: iterations=${iterations}, openSet size=${openSet.size}, closedSet size=${closedSet.size}`);
    return []; // No path found
  }

  function heuristic(x1, y1, x2, y2) {
    // Chebyshev distance (allows diagonal movement)
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  function findNearestWalkable(x, y) {
    // Spiral search for nearest walkable cell
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

  // ---- Entity Spawning ----
  function spawnEntityOnSurface() {
    // Find a random walkable surface position
    for (let attempts = 0; attempts < 100; attempts++) {
      const x = Math.floor(Math.random() * GRID_W);
      const y = Math.floor(Math.random() * GRID_H);
      if (isWalkable(x, y)) {
        return createEntity(x, y);
      }
    }
    // Fallback: search systematically
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (isWalkable(x, y)) {
          return createEntity(x, y);
        }
      }
    }
    return null;
  }

  ui.spawnEntity.addEventListener("click", () => {
    // Force a readback first if we haven't done one
    if (quadState.lastBuiltFrame < 0) {
      requestGpuReadback().then(() => {
        spawnEntityOnSurface();
      });
    } else {
      spawnEntityOnSurface();
    }
  });

  // ---- Entity Update ----
  // Expand path to add intermediate steps for smooth movement on large jumps/falls
  // Tags each point with whether it's falling, jumping up, or walking
  expandPath = function(path, startX, startY) {
    if (path.length === 0) return path;
    
    const expanded = [];
    let prevX = startX;
    let prevY = startY;
    
    for (const point of path) {
      const dx = point.x - prevX;
      const dy = point.y - prevY;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      
      // Determine movement type
      const isFalling = dy > 0 && Math.abs(dy) > 1;
      const isJumpingUp = dy < 0 && Math.abs(dy) > 1;
      
      if (dist > 1) {
        // Large movement - interpolate
        const steps = dist;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          expanded.push({
            x: prevX + dx * t,
            y: prevY + dy * t,
            falling: isFalling,
            jumping: isJumpingUp,
            fallIndex: isFalling ? i : 0, // how many frames into the fall
          });
        }
      } else {
        expanded.push({
          x: point.x,
          y: point.y,
          falling: false,
          jumping: false,
          fallIndex: 0,
        });
      }
      
      prevX = point.x;
      prevY = point.y;
    }
    
    return expanded;
  };
  
  const GRAVITY = 0.08; // acceleration per frame
  const MAX_FALL_SPEED = 1.5; // terminal velocity
  const JUMP_INITIAL_SPEED = 0.4; // initial upward speed
  
  function updateEntities() {
    for (const entity of entities) {
      if (entity.path.length === 0) {
        // Reset velocity when not moving
        entity.fallVelocity = 0;
        entity.currentSpeed = entity.baseSpeed;
        
        // Only check validity when not actively pathing
        // Check if entity's current position is still valid (ground might have collapsed)
        if (!isWalkable(Math.floor(entity.x), Math.floor(entity.y))) {
          // Try to find nearest walkable and fall there
          const nearest = findNearestWalkable(Math.floor(entity.x), Math.floor(entity.y));
          if (nearest) {
            entity.x = nearest.x;
            entity.y = nearest.y;
          }
        }
        continue;
      }

      // Peek at next path point to determine speed
      const nextPoint = entity.path[0];
      
      if (nextPoint.falling) {
        // Apply gravity acceleration
        entity.fallVelocity = Math.min(entity.fallVelocity + GRAVITY, MAX_FALL_SPEED);
        entity.currentSpeed = entity.fallVelocity;
        // Ensure minimum speed so we don't get stuck at the start
        if (entity.currentSpeed < 0.1) entity.currentSpeed = 0.1;
      } else if (nextPoint.jumping) {
        // Jumping up - start fast, slow down (decelerate)
        // Use fallIndex to determine how far into the jump we are
        const jumpProgress = nextPoint.fallIndex || 1;
        entity.currentSpeed = Math.max(0.1, JUMP_INITIAL_SPEED - (jumpProgress * 0.05));
      } else {
        // Walking - constant base speed
        entity.currentSpeed = entity.baseSpeed;
        entity.fallVelocity = 0;
      }

      entity.moveProgress += entity.currentSpeed;
      if (entity.moveProgress >= 1) {
        entity.moveProgress = 0;
        const next = entity.path.shift();
        if (next) {
          entity.x = next.x;
          entity.y = next.y;
        }
      }
    }
  }

  // ---- Entity Rendering ----
  function drawEntities() {
    const scaleX = overlay.width / GRID_W;
    const scaleY = overlay.height / GRID_H;

    for (const entity of entities) {
      const cx = entity.x * scaleX + scaleX / 2;
      const cy = entity.y * scaleY + scaleY / 2;
      const radius = Math.max(4, scaleX * 1.5);

      // Draw entity
      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      overlayCtx.fillStyle = entity.color;
      overlayCtx.fill();

      // Draw selection ring
      if (entity === selectedEntity) {
        overlayCtx.beginPath();
        overlayCtx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        overlayCtx.strokeStyle = "white";
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
        overlayCtx.lineWidth = 1;
      }

      // Draw path
      if (entity.path.length > 0) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx, cy);
        for (const point of entity.path) {
          overlayCtx.lineTo(
            point.x * scaleX + scaleX / 2,
            point.y * scaleY + scaleY / 2
          );
        }
        overlayCtx.strokeStyle = entity === selectedEntity ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)";
        overlayCtx.stroke();
      }
    }
  }

  function writeParams() {
    const p = new Uint32Array(paramsU32);
    p[0] = GRID_W;
    p[1] = GRID_H;
    p[2] = Number(ui.radius.value);
    p[3] = Number(ui.damage.value);
    p[4] = Number(ui.bondWeaken.value);
    p[5] = state.mx;
    p[6] = state.my;
    p[7] = state.mdown;
    p[8] = state.repair;
    p[9] = state.frame;
    p[10] = Number(ui.relaxIters.value);
    p[11] = 0;
    device.queue.writeBuffer(paramsBuf, 0, p);
  }

  const wgX = Math.ceil(GRID_W / 16);
  const wgY = Math.ceil(GRID_H / 16);

  function dispatch(pass, pipe) {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, computeBG);
    pass.dispatchWorkgroups(wgX, wgY);
  }

  function frame() {
    state.frame++;
    // Request readback periodically for quadtree/entity system
    if ((ui.showQuadTree.checked || entities.length > 0) && state.frame - quadState.lastBuiltFrame > 10) {
      requestGpuReadback();
    }
    writeParams();

    const encoder = device.createCommandEncoder();

    // Compute sequence:
    // brush (in-place) -> bonds_decay -> step A->B -> swap -> relax iters (A->B->swap) -> visualize
    {
      let pass = encoder.beginComputePass();
      dispatch(pass, brushPipe);
      dispatch(pass, bondsDecayPipe);
      dispatch(pass, stepPipe);
      pass.end();

      // swap: B -> A (must be done outside of compute pass)
      encoder.copyBufferToBuffer(cellsB, 0, cellsA, 0, cellsBytes);

      const iters = Number(ui.relaxIters.value);
      for (let k = 0; k < iters; k++) {
        pass = encoder.beginComputePass();
        dispatch(pass, relaxPipe);
        pass.end();
        encoder.copyBufferToBuffer(cellsB, 0, cellsA, 0, cellsBytes);
      }

      pass = encoder.beginComputePass();
      dispatch(pass, visPipe);
      pass.end();
    }

    // Present
    const view = context.getCurrentTexture().createView();
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    rpass.setPipeline(renderPipe);
    rpass.setBindGroup(0, renderBG);
    rpass.draw(6);
    rpass.end();

    device.queue.submit([encoder.finish()]);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (ui.showQuadTree.checked) {
      drawQuadTree(quadState.root);
    }
    
    // Update and draw entities
    updateEntities();
    drawEntities();
    
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
  alert(String(err));
});
