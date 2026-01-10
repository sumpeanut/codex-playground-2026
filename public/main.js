const canvas = document.getElementById("c");

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
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const state = { mx: 0, my: 0, mdown: 0, repair: 0, frame: 0 };

canvas.addEventListener("pointerdown", (e) => {
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

    const h = new Uint32Array(bondsHCount);
    const v = new Uint32Array(bondsVCount);
    h.fill(255);
    v.fill(255);
    device.queue.writeBuffer(bondsH, 0, h);
    device.queue.writeBuffer(bondsV, 0, v);
  }

  ui.reset.addEventListener("click", resetWorld);
  resetWorld();

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
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
  alert(String(err));
});
