import { bindRangeLabels } from "../ui/controls.js";
import { getUiElements } from "../ui/elements.js";
import { createPathfinder } from "../pathfinding/core.js";
import { createPathfindingWorkerClient } from "../pathfinding/client.js";
import { createStructureManager } from "../structures/editor.js";
import { loadStructures } from "../structures/storage.js";
import { GRID_H, GRID_W } from "../sim/constants.js";
import { createEntitySystem } from "../sim/entities.js";
import { createSimulationState } from "../sim/state.js";
import { initRenderer } from "../render/webgpu/renderer.js";

async function bootstrap() {
  const structures = loadStructures();
  window.caStructures = structures;

  const canvas = document.getElementById("c");
  const overlay = document.getElementById("overlay");

  const ui = getUiElements();
  bindRangeLabels(ui);

  if (!navigator.gpu) throw new Error("WebGPU not supported. Use a WebGPU-enabled browser.");

  const cpuCells = new Uint32Array(GRID_W * GRID_H);
  const pathfinder = createPathfinder({
    gridW: GRID_W,
    gridH: GRID_H,
    getCell: (x, y) => cpuCells[y * GRID_W + x],
  });
  const pathWorkerClient = createPathfindingWorkerClient({ gridW: GRID_W, gridH: GRID_H, cpuCells });

  const structureManager = createStructureManager({ ui, structures });

  const entitySystem = createEntitySystem({
    gridW: GRID_W,
    gridH: GRID_H,
    overlay,
    ui,
    pathfinder,
    requestPathAsync: pathWorkerClient.requestPathAsync,
    isWorkerReady: pathWorkerClient.isReady,
  });

  const state = createSimulationState();

  function setMouse(event) {
    const rect = canvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    state.mx = Math.max(0, Math.min(GRID_W - 1, Math.floor(nx * GRID_W)));
    state.my = Math.max(0, Math.min(GRID_H - 1, Math.floor(ny * GRID_H)));
  }

  const renderer = await initRenderer({
    canvas,
    overlay,
    ui,
    gridW: GRID_W,
    gridH: GRID_H,
    cpuCells,
    structuresManager: structureManager,
    pathWorkerClient,
    entitySystem,
    state,
  });

  canvas.addEventListener("pointerdown", (event) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    const gridX = Math.floor(nx * GRID_W);
    const gridY = Math.floor(ny * GRID_H);

    if (event.ctrlKey || event.metaKey) {
      const handled = entitySystem.handlePointerDown({ gridX, gridY });
      if (handled) return;
    }

    if (ui.structureMode?.checked) {
      renderer.placeStructureAt(gridX, gridY);
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    state.mdown = 1;
    state.repair = event.shiftKey ? 1 : 0;
    setMouse(event);
  });

  canvas.addEventListener("pointerup", () => {
    state.mdown = 0;
  });

  canvas.addEventListener("pointermove", (event) => {
    state.repair = event.shiftKey ? 1 : 0;
    setMouse(event);
  });
}

bootstrap();
