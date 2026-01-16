import { buildQuadTree, drawQuadTree } from "../../sim/quadtree.js";
import { createDefaultWorld } from "../../sim/world.js";
import { encodeColor565 } from "../../structures/utils.ts";
import shaderSource from "./shaders/shaders.wgsl?raw";

export async function initRenderer({
  canvas,
  overlay,
  ui,
  gridW,
  gridH,
  cpuCells,
  structuresManager,
  pathWorkerClient,
  entitySystem,
  state,
}) {
  const overlayCtx = overlay.getContext("2d");
  if (!overlayCtx) throw new Error("Overlay context not available");

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

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat, alphaMode: "opaque" });

  const shader = device.createShaderModule({ code: shaderSource });

  const cellCount = gridW * gridH;
  const cellsBytes = cellCount * 4;

  const bondsHCount = (gridW - 1) * gridH;
  const bondsVCount = gridW * (gridH - 1);

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

  const paramsU32 = 16;
  const paramsBuf = device.createBuffer({
    size: paramsU32 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const visTex = device.createTexture({
    size: { width: gridW, height: gridH },
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

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

  const renderPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
    vertex: { module: shader, entryPoint: "vs_fullscreen" },
    fragment: { module: shader, entryPoint: "fs_present", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list" },
  });

  const quadState = { root: null, lastBuiltFrame: -1, readbackInFlight: false };
  const readbackBuffer = device.createBuffer({
    size: cellsBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const bondWrite = new Uint32Array(1);

  function resetWorld() {
    const { cells, bondsH: h, bondsV: v } = createDefaultWorld({ gridW, gridH });

    device.queue.writeBuffer(cellsA, 0, cells);
    device.queue.writeBuffer(cellsB, 0, cells);
    cpuCells.set(cells);

    device.queue.writeBuffer(bondsH, 0, h);
    device.queue.writeBuffer(bondsV, 0, v);

    entitySystem.reset();
    quadState.lastBuiltFrame = -1;
  }

  function encodeStructureTile(tile) {
    if (!tile) return null;
    const damage = 0;
    const solid = tile.solid !== false;
    const passable = tile.passable === true;
    const colorBits = encodeColor565(tile.color) << 10;
    return (damage & 0xff) | (solid ? (1 << 8) : 0) | (passable ? (1 << 9) : 0) | colorBits;
  }

  function placeStructureAt(gridX, gridY) {
    const structure = structuresManager.getSelectedStructure();
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
        if (targetX < 0 || targetX >= gridW || targetY < 0 || targetY >= gridH) continue;
        const encoded = encodeStructureTile(tile);
        if (encoded === null) continue;
        cpuCells[targetY * gridW + targetX] = encoded;
        changed = true;
      }
    }

    if (!changed) return;
    for (let y = 0; y < structure.height; y++) {
      for (let x = 0; x < structure.width; x++) {
        const tile = structure.tiles[y * structure.width + x];
        if (!tile) continue;
        const targetX = originX + x;
        const targetY = originY + y;
        if (targetX < 0 || targetX >= gridW || targetY < 0 || targetY >= gridH) continue;
        if (x + 1 < structure.width) {
          const neighbor = structure.tiles[y * structure.width + x + 1];
          if (neighbor && targetX + 1 < gridW) {
            bondWrite[0] = 255;
            device.queue.writeBuffer(bondsH, (targetY * (gridW - 1) + targetX) * 4, bondWrite);
          }
        }
        if (y + 1 < structure.height) {
          const neighbor = structure.tiles[(y + 1) * structure.width + x];
          if (neighbor && targetY + 1 < gridH) {
            bondWrite[0] = 255;
            device.queue.writeBuffer(bondsV, (targetY * gridW + targetX) * 4, bondWrite);
          }
        }
      }
    }
    device.queue.writeBuffer(cellsA, 0, cpuCells);
    device.queue.writeBuffer(cellsB, 0, cpuCells);
    device.queue.writeBuffer(readbackBuffer, 0, cpuCells);
    pathWorkerClient.updateCells();
    rebuildQuadTree();
    quadState.lastBuiltFrame = state.frame;
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
    pathWorkerClient.updateCells();
  }

  function rebuildQuadTree() {
    quadState.root = buildQuadTree({
      gridW,
      gridH,
      cpuCells,
      getSolid: (cell) => ((cell >> 8) & 1) === 1 && (cell & 0xff) < 255,
    });
    quadState.lastBuiltFrame = state.frame;
  }

  ui.reset?.addEventListener("click", resetWorld);
  resetWorld();

  ui.spawnEntity?.addEventListener("click", () => {
    if (quadState.lastBuiltFrame < 0) {
      requestGpuReadback().then(() => {
        entitySystem.spawnEntityOnSurface();
      });
    } else {
      entitySystem.spawnEntityOnSurface();
    }
  });

  function writeParams() {
    const p = new Uint32Array(paramsU32);
    p[0] = gridW;
    p[1] = gridH;
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

  const wgX = Math.ceil(gridW / 16);
  const wgY = Math.ceil(gridH / 16);

  function dispatch(pass, pipe) {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, computeBG);
    pass.dispatchWorkgroups(wgX, wgY);
  }

  function frame() {
    state.frame++;
    if ((ui.showQuadTree.checked || entitySystem.entities.length > 0) && state.frame - quadState.lastBuiltFrame > 10) {
      requestGpuReadback();
    }
    writeParams();

    const encoder = device.createCommandEncoder();

    {
      let pass = encoder.beginComputePass();
      dispatch(pass, brushPipe);
      dispatch(pass, bondsDecayPipe);
      dispatch(pass, stepPipe);
      pass.end();

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
      drawQuadTree({ node: quadState.root, overlayCtx, overlay, gridW, gridH });
    }
    structuresManager.drawStructureGhost({ overlayCtx, overlay, gridW, gridH, state });

    entitySystem.updateEntities();
    entitySystem.drawEntities(overlayCtx);

    requestAnimationFrame(frame);
  }

  requestGpuReadback().then(() => {
    pathWorkerClient.init();
    for (let i = 0; i < 10; i++) {
      entitySystem.spawnEntityOnSurface();
    }
    entitySystem.startRandomWalking();
  });

  requestAnimationFrame(frame);

  return {
    placeStructureAt,
  };
}
