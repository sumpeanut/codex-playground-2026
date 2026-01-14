import { loadStructures } from "./structures.js";

const structures = loadStructures();
window.caStructures = structures;

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
  structureMode: document.getElementById("structureMode"),
  structureSelect: document.getElementById("structureSelect"),
  structurePreview: document.getElementById("structurePreview"),
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

const structureById = new Map(structures.map((structure) => [structure.id, structure]));
let selectedStructureId = structures[0]?.id ?? "";

function drawStructurePreview(structure) {
  const canvasEl = ui.structurePreview;
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!structure || structure.width === 0 || structure.height === 0) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    return;
  }
  const scale = Math.min(canvasEl.width / structure.width, canvasEl.height / structure.height);
  const offsetX = (canvasEl.width - structure.width * scale) / 2;
  const offsetY = (canvasEl.height - structure.height * scale) / 2;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  for (let y = 0; y < structure.height; y++) {
    for (let x = 0; x < structure.width; x++) {
      const tile = structure.tiles[y * structure.width + x];
      if (!tile) continue;
      ctx.fillStyle = tile.color ?? "#d0dbe8";
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, structure.width * scale - 1, structure.height * scale - 1);
}

function drawStructureGhost(structure) {
  if (!structure || !ui.structureMode?.checked) return;
  const scaleX = overlay.width / GRID_W;
  const scaleY = overlay.height / GRID_H;
  const originX = state.mx - Math.floor(structure.width / 2);
  const originY = state.my - Math.floor(structure.height / 2);

  overlayCtx.save();
  overlayCtx.globalAlpha = 0.55;

  for (let y = 0; y < structure.height; y++) {
    for (let x = 0; x < structure.width; x++) {
      const tile = structure.tiles[y * structure.width + x];
      if (!tile) continue;
      const targetX = originX + x;
      const targetY = originY + y;
      if (targetX < 0 || targetX >= GRID_W || targetY < 0 || targetY >= GRID_H) continue;
      overlayCtx.fillStyle = tile.color ?? "#d0dbe8";
      overlayCtx.fillRect(targetX * scaleX, targetY * scaleY, scaleX, scaleY);
    }
  }

  overlayCtx.restore();
}

function populateStructureSelect() {
  if (!ui.structureSelect) return;
  ui.structureSelect.innerHTML = "";
  for (const structure of structures) {
    const option = document.createElement("option");
    option.value = structure.id;
    option.textContent = structure.name ?? structure.id;
    ui.structureSelect.appendChild(option);
  }
  if (structures.length > 0) {
    selectedStructureId = structureById.has(selectedStructureId) ? selectedStructureId : structures[0].id;
    ui.structureSelect.value = selectedStructureId;
  }
  drawStructurePreview(structureById.get(selectedStructureId));
}

populateStructureSelect();
ui.structureSelect?.addEventListener("change", (event) => {
  selectedStructureId = event.target.value;
  drawStructurePreview(structureById.get(selectedStructureId));
});

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
let placeStructureAt = null;
const overlayCtx = overlay.getContext("2d");

// ---- Pathfinding Worker ----
let pathWorker = null;
let pathRequestId = 0;
const pendingPathRequests = new Map();
let workerReady = false;

function initPathWorker(cpuCells) {
  pathWorker = new Worker('./pathfinding-worker.js');
  
  pathWorker.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch (type) {
      case 'ready':
        workerReady = true;
        console.log('Pathfinding worker ready');
        break;
        
      case 'pathResult':
        const { requestId, path } = data;
        const pending = pendingPathRequests.get(requestId);
        if (pending) {
          pending.resolve(path);
          pendingPathRequests.delete(requestId);
        }
        break;
    }
  };
  
  // Initialize worker with grid data
  pathWorker.postMessage({
    type: 'init',
    data: {
      gridW: GRID_W,
      gridH: GRID_H,
      cells: cpuCells.buffer.slice(0)
    }
  }, [cpuCells.buffer.slice(0)]);
}

function updateWorkerCells(cpuCells) {
  if (pathWorker && workerReady) {
    pathWorker.postMessage({
      type: 'updateCells',
      data: { cells: cpuCells.buffer.slice(0) }
    });
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
      type: 'findPath',
      data: { requestId, startX, startY, endX, endY }
    });
  });
}

// ---- Entity System ----
const entities = [];
let selectedEntity = null;
let entityIdCounter = 0;
let findPath = null; // Synchronous fallback - will be set inside init()
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
    } else if (selectedEntity && workerReady) {
      // Debug: log pathfinding attempt
      console.log(`Pathfinding from (${Math.floor(selectedEntity.x)}, ${Math.floor(selectedEntity.y)}) to (${gridX}, ${gridY})`);
      
      // Move selected entity to clicked position (async pathfinding via worker)
      const entityToMove = selectedEntity;
      requestPathAsync(
        Math.floor(entityToMove.x), Math.floor(entityToMove.y),
        gridX, gridY
      ).then(path => {
        console.log(`Path found: ${path.length} steps`);
        if (path.length > 0) {
          // Expand path for smooth movement on jumps/falls
          entityToMove.path = expandPath(path, entityToMove.x, entityToMove.y);
          entityToMove.moveProgress = 0;
        } else {
          console.log('No path found!');
        }
      });
    } else if (selectedEntity && findPath) {
      // Fallback to synchronous pathfinding if worker not ready
      console.log(`Pathfinding (sync) from (${Math.floor(selectedEntity.x)}, ${Math.floor(selectedEntity.y)}) to (${gridX}, ${gridY})`);
      const path = findPath(
        Math.floor(selectedEntity.x), Math.floor(selectedEntity.y),
        gridX, gridY
      );
      console.log(`Path found: ${path.length} steps`);
      if (path.length > 0) {
        selectedEntity.path = expandPath(path, selectedEntity.x, selectedEntity.y);
        selectedEntity.moveProgress = 0;
      } else {
        console.log('No path found!');
      }
    }
    return; // Don't apply brush when doing entity stuff
  }

  if (ui.structureMode?.checked && placeStructureAt) {
    placeStructureAt(gridX, gridY);
    return;
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

    function setSolid(x, y, dmg = 0, passable = false) {
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
      const p = passable ? (1 << 9) : 0;
      cells[y * GRID_W + x] = (dmg & 0xff) | (1 << 8) | p;
    }

    function getSolid(x, y) {
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
      return (cells[y * GRID_W + x] & (1 << 8)) !== 0;
    }

    function clearCell(x, y) {
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
      cells[y * GRID_W + x] = 0;
    }

    // Ground slab
    const groundY = GRID_H - 10;
    for (let y = groundY; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) setSolid(x, y, 0);
    }

    // Helper: create a filled rectangle
    function rect(x0, y0, w, h) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) setSolid(x, y, 0);
      }
    }

    // Helper: create a hollow rectangle (just walls)
    function hollowRect(x0, y0, w, h, wallThickness = 2) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const isWall = x < x0 + wallThickness || x >= x0 + w - wallThickness ||
                         y < y0 + wallThickness || y >= y0 + h - wallThickness;
          if (isWall) setSolid(x, y, 0);
        }
      }
    }

    // Helper: create a floor (horizontal platform using passable/support tiles)
    function floor(x0, y, w, thickness = 2) {
      for (let t = 0; t < thickness; t++) {
        for (let x = x0; x < x0 + w; x++) setSolid(x, y + t, 0, true); // passable
      }
    }

    // Helper: create a door opening (2 tiles wide to clear wall, passable for structural stability)
    function door(x, y, h = 6) {
      for (let dy = 0; dy < h; dy++) {
        setSolid(x, y + dy, 0, true);
        setSolid(x + 1, y + dy, 0, true);
      }
    }

    // Helper: create a vertical support column with capitals
    // Thin (1 tile) shaft that widens (3 tiles) where it meets floors/beams
    function column(centerX, topY, bottomY, width = 2) {
      for (let y = topY; y <= bottomY; y++) {
        // Check if this row has existing solid (floor/beam) at or near the column
        const hasFloorHere = getSolid(centerX, y) || getSolid(centerX + 1, y);
        const hasFloorLeft = getSolid(centerX - 1, y);
        const hasFloorRight = getSolid(centerX + width, y);
        const atFloor = hasFloorHere || hasFloorLeft || hasFloorRight || y === topY || y === bottomY;
        
        if (atFloor) {
          // Wide capital where column meets floor (3 tiles centered)
          for (let w = -1; w < width + 1; w++) {
            if (!getSolid(centerX + w, y)) {
              setSolid(centerX + w, y, 0, true);
            }
          }
        } else {
          // Thin shaft (1 tile, centered)
          const shaftX = centerX + Math.floor(width / 2);
          if (!getSolid(shaftX, y)) {
            setSolid(shaftX, y, 0, true);
          }
        }
      }
    }

    // ========== Building 1: 3-story building on the left ==========
    const b1x = 20;
    const b1w = 40;
    const floorHeight = 20;
    const wallThick = 2;
    const roofY1 = groundY - 3 * floorHeight;
    
    // FIRST: Lay all floors to ensure continuous horizontal bonds
    for (let floorNum = 0; floorNum < 3; floorNum++) {
      const floorY = groundY - (floorNum + 1) * floorHeight;
      floor(b1x, floorY + floorHeight - wallThick, b1w, wallThick);
    }
    floor(b1x, roofY1, b1w, wallThick); // Roof
    
    // THEN: Walls from roof to ground (full height)
    rect(b1x, roofY1, wallThick, groundY - roofY1);
    rect(b1x + b1w - wallThick, roofY1, wallThick, groundY - roofY1);

    // Doors on ground floor (both sides for exterior access)
    door(b1x, groundY - 8, 8); // Left door
    door(b1x + b1w - wallThick, groundY - 8, 8); // Right door

    // Support columns for Building 1 (internal pillars from roof to ground)
    column(b1x + 10, roofY1, groundY - 1, 3);
    column(b1x + 20, roofY1, groundY - 1, 3);
    column(b1x + 30, roofY1, groundY - 1, 3);

    // ========== Building 2: 2-story smaller building ==========
    const b2x = 80;
    const b2w = 30;
    const roofY2 = groundY - 2 * floorHeight;
    
    // FIRST: Lay all floors
    for (let floorNum = 0; floorNum < 2; floorNum++) {
      const floorY = groundY - (floorNum + 1) * floorHeight;
      floor(b2x, floorY + floorHeight - wallThick, b2w, wallThick);
    }
    floor(b2x, roofY2, b2w, wallThick); // Roof
    
    // THEN: Walls from roof to ground
    rect(b2x, roofY2, wallThick, groundY - roofY2);
    rect(b2x + b2w - wallThick, roofY2, wallThick, groundY - roofY2);

    // Door
    door(b2x + b2w - wallThick, groundY - 8, 8);

    // Support columns for Building 2
    column(b2x + 10, roofY2, groundY - 1, 3);
    column(b2x + 20, roofY2, groundY - 1, 3);

    // ========== Building 3: Tall tower on the right ==========
    const b3x = 130;
    const b3w = 25;
    const roofY3 = groundY - 4 * floorHeight;
    
    // FIRST: Lay all floors
    for (let floorNum = 0; floorNum < 4; floorNum++) {
      const floorY = groundY - (floorNum + 1) * floorHeight;
      floor(b3x, floorY + floorHeight - wallThick, b3w, wallThick);
    }
    floor(b3x, roofY3, b3w, wallThick); // Roof
    
    // THEN: Walls from roof to ground
    rect(b3x, roofY3, wallThick, groundY - roofY3);
    rect(b3x + b3w - wallThick, roofY3, wallThick, groundY - roofY3);

    // Doors (both sides for exterior access)
    door(b3x, groundY - 8, 8); // Left door
    door(b3x + b3w - wallThick, groundY - 8, 8); // Right door

    // Support columns for Building 3 (tower needs central support, spaced for stability)
    column(b3x + 8, roofY3, groundY - 1, 3);
    column(b3x + 16, roofY3, groundY - 1, 3);

    // ========== Outdoor platforms and bridges ==========
    // Platform between buildings 1 and 2
    floor(b1x + b1w, groundY - floorHeight - 5, 20, 2);
    // Support column for platform
    column(b1x + b1w + 10, groundY - floorHeight - 5, groundY - 1, 3);

    // Bridge from building 2 to building 3 (second floor)
    floor(b2x + b2w, groundY - floorHeight - 5, b3x - b2x - b2w, 2);
    // Support column for bridge
    column(b2x + b2w + Math.floor((b3x - b2x - b2w) / 2), groundY - floorHeight - 5, groundY - 1, 3);

    device.queue.writeBuffer(cellsA, 0, cells);
    device.queue.writeBuffer(cellsB, 0, cells);
    cpuCells.set(cells);

    const h = new Uint32Array(bondsHCount);
    const v = new Uint32Array(bondsVCount);
    h.fill(255);
    v.fill(255);
    device.queue.writeBuffer(bondsH, 0, h);
    device.queue.writeBuffer(bondsV, 0, v);
    
    // Clear existing entities
    entities.length = 0;
    selectedEntity = null;
    updateEntityCountUI();
  }

  ui.reset.addEventListener("click", resetWorld);
  resetWorld();

  // ---- Conceptual QuadTree (CPU-side scaffold for future GPU-driven culling) ----
  const quadState = { root: null, lastBuiltFrame: -1, readbackInFlight: false };
  const readbackBuffer = device.createBuffer({
    size: cellsBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  function encodeStructureTile(tile) {
    if (!tile) return null;
    const damage = 0;
    const solid = tile.solid !== false;
    const passable = tile.passable === true;
    return (damage & 0xff) | (solid ? (1 << 8) : 0) | (passable ? (1 << 9) : 0);
  }

  function placeStructureAtImpl(gridX, gridY) {
    const structure = structureById.get(selectedStructureId);
    if (!structure || structure.width === 0 || structure.height === 0) return;
    const originX = gridX - Math.floor(structure.width / 2);
    const originY = gridY - Math.floor(structure.height / 2);
    let changed = false;

    for (let y = 0; y < structure.height; y++) {
      for (let x = 0; x < structure.width; x++) {
        const tile = structure.tiles[y * structure.width + x];
        if (!tile) continue;
        const targetX = originX + x;
        const targetY = originY + y;
        if (targetX < 0 || targetX >= GRID_W || targetY < 0 || targetY >= GRID_H) continue;
        const encoded = encodeStructureTile(tile);
        if (encoded === null) continue;
        cpuCells[targetY * GRID_W + targetX] = encoded;
        changed = true;
      }
    }

    if (!changed) return;
    device.queue.writeBuffer(cellsA, 0, cpuCells);
    device.queue.writeBuffer(cellsB, 0, cpuCells);
    device.queue.writeBuffer(readbackBuffer, 0, cpuCells);
    updateWorkerCells(cpuCells);
    rebuildQuadTree();
    quadState.lastBuiltFrame = state.frame;
  }

  placeStructureAt = placeStructureAtImpl;

  function getSolid(cell) {
    const dmg = cell & 0xff;
    const solidBit = (cell >> 8) & 1;
    return solidBit === 1 && dmg < 255;
  }

  // Check if entity can pass through this cell (support cells are solid but passable)
  function getPassable(cell) {
    return ((cell >> 9) & 1) === 1;
  }

  // Check if cell is a "support" cell (solid but entities can pass through)
  function isSupport(cell) {
    return getSolid(cell) && getPassable(cell);
  }

  // Check if cell blocks entity movement (solid and NOT passable)
  function blocksEntity(cell) {
    return getSolid(cell) && !getPassable(cell);
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
    
    // Update pathfinding worker with new cell data
    updateWorkerCells(cpuCells);
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

  // ---- Binary Heap Priority Queue (O(log n) operations) ----
  // Uses lazy deletion - nodes may be re-added with better priority
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

  // ---- Integer key encoding (avoids string allocation) ----
  const nodeKey = (x, y) => y * GRID_W + x;
  const keyToXY = (key) => ({ x: key % GRID_W, y: Math.floor(key / GRID_W) });

  // ---- Walkable Surface Detection ----
  // A cell is walkable if it's empty (or a support cell) AND has a solid cell directly below it
  function isWalkable(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
    const cell = cpuCells[y * GRID_W + x];
    // Can't walk inside solid cells that block entities
    // Support cells (solid but passable) are treated as empty for entities
    if (blocksEntity(cell)) return false;
    // Check if there's solid ground below
    if (y + 1 >= GRID_H) return true; // Bottom edge is walkable
    const below = cpuCells[(y + 1) * GRID_W + x];
    return getSolid(below);
  }

  // Check if the path is clear (no solid cells blocking the jump arc)
  // For falling (dy > 0), we need to skip checking the ground cell directly below start
  // Support cells (passable) do not block entity movement
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
        if (blocksEntity(cell)) return false;
      }
      // If moving horizontally, check that horizontal path at landing level is clear
      if (dx !== 0) {
        const stepX = dx > 0 ? 1 : -1;
        for (let cx = x1 + stepX; cx !== x2 + stepX; cx += stepX) {
          if (cx < 0 || cx >= GRID_W) continue;
          // Check the cell at the landing row (y2) and one above it
          const cellAtLanding = cpuCells[y2 * GRID_W + cx];
          const cellAboveLanding = y2 > 0 ? cpuCells[(y2 - 1) * GRID_W + cx] : 0;
          if (blocksEntity(cellAtLanding) || blocksEntity(cellAboveLanding)) return false;
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
        if (blocksEntity(cell)) return false;
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
    if (blocksEntity(edgeCell)) return false;
    
    // Check the vertical fall path from (x2, y1) down to (x2, y2)
    for (let cy = y1 + 1; cy < y2; cy++) {
      if (cy < 0 || cy >= GRID_H) continue;
      const cell = cpuCells[cy * GRID_W + x2];
      if (blocksEntity(cell)) return false;
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
    // Note: entities can pass through support cells (solid but passable)
    for (const stepX of [-1, 1]) {
      const edgeX = x + stepX;
      // Check if the adjacent cell is empty (not walkable, but not blocking entities)
      if (edgeX < 0 || edgeX >= GRID_W) continue;
      const edgeCell = cpuCells[y * GRID_W + edgeX];
      if (blocksEntity(edgeCell)) continue; // Can't step into blocking solid
      if (isWalkable(edgeX, y)) continue; // Already handled by normal walking
      
      // This is an empty/passable cell with no ground - find where we'd land
      for (let fallY = 1; fallY <= GRID_H; fallY++) {
        const landY = y + fallY;
        if (landY >= GRID_H) break;
        if (isWalkable(edgeX, landY)) {
          // Found landing spot - add move that goes to the landing position
          moves.push([stepX, fallY]);
          break; // Only add the first (highest) landing spot
        }
        // Check if we hit a blocking solid before finding walkable (inside a structure)
        const cellBelow = cpuCells[landY * GRID_W + edgeX];
        if (blocksEntity(cellBelow)) break; // Can't fall through blocking solid
      }
    }
    
    return moves;
  }

  // ---- A* Pathfinding (Optimized with Binary Heap + Integer Keys) ----
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

    const endKey = nodeKey(end.x, end.y);
    
    // Node data stored in single Map for cache locality
    // Each node: { g: number, parent: number|null }
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

      // Get node with lowest fScore - O(log n) with heap
      const current = openSet.pop();
      if (!current) break;
      
      const currentKey = current.key;
      const cx = current.data.x;
      const cy = current.data.y;

      // Skip if already processed (can happen with lazy deletion)
      if (closedSet.has(currentKey)) continue;

      // Check if we reached the goal
      if (currentKey === endKey) {
        // Reconstruct path using integer keys
        const path = [];
        let ck = currentKey;
        while (ck !== null && nodes.has(ck)) {
          const { x, y } = keyToXY(ck);
          path.unshift({ x, y });
          ck = nodes.get(ck).parent;
        }
        // Remove start position from path (entity is already there)
        if (path.length > 0) path.shift();
        return path;
      }

      closedSet.add(currentKey);
      const currentG = nodes.get(currentKey).g;

      // Get all possible moves including jumps from current position
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
          // New node - add to open set
          const h = heuristic(nx, ny, end.x, end.y);
          nodes.set(nk, { g: tentativeG, parent: currentKey });
          openSet.push(nk, tentativeG + h, { x: nx, y: ny });
        } else if (tentativeG < existingNode.g) {
          // Found better path - update node and re-add to heap (lazy deletion)
          existingNode.g = tentativeG;
          existingNode.parent = currentKey;
          const h = heuristic(nx, ny, end.x, end.y);
          openSet.push(nk, tentativeG + h, { x: nx, y: ny });
        }
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
    drawStructureGhost(structureById.get(selectedStructureId));
    
    // Update and draw entities
    updateEntities();
    drawEntities();
    
    requestAnimationFrame(frame);
  }

  // Initialize pathfinding worker after first readback
  requestGpuReadback().then(() => {
    initPathWorker(cpuCells);
    
    // Spawn 10 entities that will randomly walk around
    for (let i = 0; i < 10; i++) {
      spawnEntityOnSurface();
    }
    
    // Start random walking behavior for all entities
    startRandomWalking();
  });

  // ---- Random Walking Behavior ----
  function startRandomWalking() {
    setInterval(() => {
      for (const entity of entities) {
        // Only assign new path if entity has finished current one
        if (entity.path.length === 0 && workerReady) {
          // Find a random walkable destination
          const destX = Math.floor(Math.random() * GRID_W);
          const destY = Math.floor(Math.random() * GRID_H);
          
          // Request path asynchronously
          requestPathAsync(
            Math.floor(entity.x), Math.floor(entity.y),
            destX, destY
          ).then(path => {
            if (path.length > 0) {
              entity.path = expandPath(path, entity.x, entity.y);
              entity.moveProgress = 0;
            }
          });
        }
      }
    }, 2000); // Check every 2 seconds
  }

  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
  alert(String(err));
});
