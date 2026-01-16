import { DEFAULT_PASSABLE_COLOR, DEFAULT_SOLID_COLOR, encodeColor565 } from "../domain/tile.ts";
import { DEFAULT_EDITOR_SIZE, createEmptyStructure, createStructureId, type Structure, type StructureTile } from "./utils.ts";
import { saveStructures } from "./storage.ts";

type StructureEditorUI = {
  structurePreview?: HTMLCanvasElement | null;
  structureList?: HTMLDivElement | null;
  structureSelect?: HTMLSelectElement | null;
  editorCanvas?: HTMLCanvasElement | null;
  paintMode?: HTMLSelectElement | null;
  tileType?: HTMLSelectElement | null;
  tileColor?: HTMLInputElement | null;
  openEditor?: HTMLButtonElement | null;
  closeEditor?: HTMLButtonElement | null;
  editorDialog?: HTMLDialogElement | null;
  editorNew?: HTMLButtonElement | null;
  editorRename?: HTMLButtonElement | null;
  editorDelete?: HTMLButtonElement | null;
  editorExport?: HTMLButtonElement | null;
  editorImport?: HTMLButtonElement | null;
  structureModal?: HTMLDialogElement | null;
  structureModalTitle?: HTMLHeadingElement | null;
  structureModalConfirm?: HTMLButtonElement | null;
  structureData?: HTMLTextAreaElement | null;
  structureMode?: HTMLInputElement | null;
};

type EditorState = {
  currentId: string;
  paintMode: string;
  tileType: string;
  color: string;
  painting: boolean;
};

type DrawStructureOptions = {
  background?: string;
  border?: string;
};

type DrawStructureGhostArgs = {
  overlayCtx: CanvasRenderingContext2D;
  overlay: HTMLCanvasElement;
  gridW: number;
  gridH: number;
  state: { mx: number; my: number };
};

export function createStructureManager({
  ui,
  structures,
}: {
  ui: StructureEditorUI;
  structures: Structure[];
}) {
  const structureById = new Map(structures.map((structure) => [structure.id, structure]));
  let selectedStructureId = structures[0]?.id ?? "";

  const editorState: EditorState = {
    currentId: selectedStructureId,
    paintMode: "paint",
    tileType: "solid",
    color: DEFAULT_SOLID_COLOR,
    painting: false,
  };

  function rebuildStructureMap() {
    structureById.clear();
    structures.forEach((structure) => structureById.set(structure.id, structure));
  }

  function persistStructures() {
    saveStructures(structures);
  }

  function drawStructureToCanvas(
    structure: Structure | null | undefined,
    canvasEl: HTMLCanvasElement | null | undefined,
    options: DrawStructureOptions = {}
  ) {
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
    ctx.fillStyle = options.background ?? "#111";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    for (let y = 0; y < structure.height; y++) {
      for (let x = 0; x < structure.width; x++) {
        const tile = structure.tiles[y * structure.width + x];
        if (!tile) continue;
        ctx.fillStyle = tile.color ?? DEFAULT_SOLID_COLOR;
        ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
      }
    }
    ctx.strokeStyle = options.border ?? "rgba(255,255,255,0.15)";
    ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, structure.width * scale - 1, structure.height * scale - 1);
  }

  function drawStructurePreview(structure: Structure | null | undefined) {
    drawStructureToCanvas(structure, ui.structurePreview);
  }

  function renderStructureList() {
    if (!ui.structureList) return;
    ui.structureList.innerHTML = "";
    for (const structure of structures) {
      const item = document.createElement("div");
      item.className = "structure-item";
      if (structure.id === selectedStructureId) item.classList.add("active");
      const preview = document.createElement("canvas");
      preview.width = 40;
      preview.height = 40;
      drawStructureToCanvas(structure, preview, { background: "#0c0c0c" });
      const label = document.createElement("div");
      label.textContent = structure.name ?? structure.id;
      item.appendChild(preview);
      item.appendChild(label);
      item.addEventListener("click", () => {
        selectStructure(structure.id, { syncSelect: true });
      });
      ui.structureList.appendChild(item);
    }
  }

  function drawEditorCanvas() {
    if (!ui.editorCanvas) return;
    const structure = structureById.get(editorState.currentId);
    const ctx = ui.editorCanvas.getContext("2d");
    if (!ctx || !structure) return;
    const canvasEl = ui.editorCanvas;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    if (structure.width === 0 || structure.height === 0) return;
    const scale = Math.min(canvasEl.width / structure.width, canvasEl.height / structure.height);
    const offsetX = (canvasEl.width - structure.width * scale) / 2;
    const offsetY = (canvasEl.height - structure.height * scale) / 2;
    for (let y = 0; y < structure.height; y++) {
      for (let x = 0; x < structure.width; x++) {
        const tile = structure.tiles[y * structure.width + x];
        if (!tile) continue;
        ctx.fillStyle = tile.color ?? DEFAULT_SOLID_COLOR;
        ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= structure.width; x++) {
      const px = offsetX + x * scale;
      ctx.beginPath();
      ctx.moveTo(px, offsetY);
      ctx.lineTo(px, offsetY + structure.height * scale);
      ctx.stroke();
    }
    for (let y = 0; y <= structure.height; y++) {
      const py = offsetY + y * scale;
      ctx.beginPath();
      ctx.moveTo(offsetX, py);
      ctx.lineTo(offsetX + structure.width * scale, py);
      ctx.stroke();
    }
  }

  function syncEditorStateFromUI() {
    editorState.paintMode = ui.paintMode?.value ?? "paint";
    editorState.tileType = ui.tileType?.value ?? "solid";
    editorState.color = ui.tileColor?.value ?? DEFAULT_SOLID_COLOR;
  }

  function selectStructure(id: string, { syncSelect = false }: { syncSelect?: boolean } = {}) {
    if (!structureById.has(id)) return;
    selectedStructureId = id;
    editorState.currentId = id;
    if (syncSelect && ui.structureSelect) {
      ui.structureSelect.value = id;
    }
    drawStructurePreview(structureById.get(selectedStructureId));
    renderStructureList();
    drawEditorCanvas();
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

  function updateStructureUI() {
    rebuildStructureMap();
    populateStructureSelect();
    editorState.currentId = selectedStructureId;
    renderStructureList();
    drawEditorCanvas();
    drawStructurePreview(structureById.get(selectedStructureId));
  }

  function getEditorCellFromEvent(event: PointerEvent) {
    const structure = structureById.get(editorState.currentId);
    if (!structure || !ui.editorCanvas) return null;
    const rect = ui.editorCanvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    const x = Math.floor(nx * structure.width);
    const y = Math.floor(ny * structure.height);
    if (x < 0 || x >= structure.width || y < 0 || y >= structure.height) return null;
    return { x, y };
  }

  function applyEditorPaint(x: number, y: number) {
    const structure = structureById.get(editorState.currentId);
    if (!structure) return;
    const index = y * structure.width + x;
    const mode = editorState.paintMode;
    if (mode === "erase") {
      structure.tiles[index] = null;
    } else {
      const passable = editorState.tileType === "passable";
      structure.tiles[index] = {
        solid: true,
        passable,
        color: editorState.color || (passable ? DEFAULT_PASSABLE_COLOR : DEFAULT_SOLID_COLOR),
      } satisfies StructureTile;
    }
    persistStructures();
    drawEditorCanvas();
    drawStructurePreview(structure);
    renderStructureList();
  }

  function openEditorModal() {
    if (!ui.editorDialog) return;
    ui.editorDialog.showModal();
  }

  function closeEditorModal() {
    if (!ui.editorDialog) return;
    ui.editorDialog.close();
  }

  function openStructureModal(mode: "export" | "import") {
    if (!ui.structureModal || !ui.structureData || !ui.structureModalTitle || !ui.structureModalConfirm) return;
    ui.structureModal.dataset.mode = mode;
    if (mode === "export") {
      ui.structureModalTitle.textContent = "Export Structures";
      ui.structureModalConfirm.textContent = "Close";
      ui.structureData.value = JSON.stringify(structures, null, 2);
    } else {
      ui.structureModalTitle.textContent = "Import Structures";
      ui.structureModalConfirm.textContent = "Import";
      ui.structureData.value = "";
    }
    ui.structureModal.showModal();
  }

  function drawStructureGhost({ overlayCtx, overlay, gridW, gridH, state }: DrawStructureGhostArgs) {
    const structure = structureById.get(selectedStructureId);
    if (!structure || !ui.structureMode?.checked) return;
    const scaleX = overlay.width / gridW;
    const scaleY = overlay.height / gridH;
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
        if (targetX < 0 || targetX >= gridW || targetY < 0 || targetY >= gridH) continue;
        overlayCtx.fillStyle = tile.color ?? DEFAULT_SOLID_COLOR;
        overlayCtx.fillRect(targetX * scaleX, targetY * scaleY, scaleX, scaleY);
      }
    }

    overlayCtx.restore();
  }

  populateStructureSelect();
  ui.structureSelect?.addEventListener("change", (event) => {
    selectStructure((event.target as HTMLSelectElement).value);
  });
  renderStructureList();
  drawEditorCanvas();
  syncEditorStateFromUI();

  ui.openEditor?.addEventListener("click", openEditorModal);
  ui.closeEditor?.addEventListener("click", closeEditorModal);

  ui.paintMode?.addEventListener("change", syncEditorStateFromUI);
  ui.tileType?.addEventListener("change", syncEditorStateFromUI);
  ui.tileColor?.addEventListener("input", syncEditorStateFromUI);

  ui.editorCanvas?.addEventListener("pointerdown", (event) => {
    const cell = getEditorCellFromEvent(event);
    if (!cell) return;
    editorState.painting = true;
    ui.editorCanvas.setPointerCapture(event.pointerId);
    applyEditorPaint(cell.x, cell.y);
  });
  ui.editorCanvas?.addEventListener("pointermove", (event) => {
    if (!editorState.painting) return;
    const cell = getEditorCellFromEvent(event);
    if (!cell) return;
    applyEditorPaint(cell.x, cell.y);
  });
  ui.editorCanvas?.addEventListener("pointerup", () => {
    editorState.painting = false;
  });
  ui.editorCanvas?.addEventListener("pointerleave", () => {
    editorState.painting = false;
  });

  ui.editorNew?.addEventListener("click", () => {
    const name = window.prompt("New structure name:", "New Structure");
    if (!name) return;
    const widthInput = window.prompt("Width (tiles):", String(DEFAULT_EDITOR_SIZE));
    const heightInput = window.prompt("Height (tiles):", String(DEFAULT_EDITOR_SIZE));
    const width = Math.max(1, Number.parseInt(widthInput ?? "", 10) || DEFAULT_EDITOR_SIZE);
    const height = Math.max(1, Number.parseInt(heightInput ?? "", 10) || DEFAULT_EDITOR_SIZE);
    const structure = createEmptyStructure(name.trim(), width, height);
    structures.push(structure);
    persistStructures();
    updateStructureUI();
    selectStructure(structure.id, { syncSelect: true });
  });

  ui.editorRename?.addEventListener("click", () => {
    const structure = structureById.get(editorState.currentId);
    if (!structure) return;
    const name = window.prompt("Rename structure:", structure.name ?? structure.id);
    if (!name) return;
    structure.name = name.trim();
    persistStructures();
    updateStructureUI();
  });

  ui.editorDelete?.addEventListener("click", () => {
    const structure = structureById.get(editorState.currentId);
    if (!structure) return;
    const confirmed = window.confirm(`Delete "${structure.name ?? structure.id}"?`);
    if (!confirmed) return;
    const index = structures.findIndex((entry) => entry.id === structure.id);
    if (index >= 0) {
      structures.splice(index, 1);
    }
    persistStructures();
    updateStructureUI();
    if (structures.length > 0) {
      selectStructure(structures[0].id, { syncSelect: true });
    }
  });

  ui.editorExport?.addEventListener("click", () => openStructureModal("export"));
  ui.editorImport?.addEventListener("click", () => openStructureModal("import"));

  ui.structureModal?.addEventListener("close", () => {
    if (ui.structureModal?.returnValue !== "confirm") return;
    const mode = ui.structureModal.dataset.mode;
    if (mode !== "import") return;
    const raw = ui.structureData?.value ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      window.alert("Invalid JSON. Please check the structure data.");
      return;
    }
    const imported = Array.isArray(parsed) ? parsed : (parsed as { structures?: Structure[] }).structures;
    if (!Array.isArray(imported)) {
      window.alert("Expected an array of structures.");
      return;
    }
    const cleaned = imported
      .filter((item): item is Structure => Boolean(item && typeof item === "object"))
      .map((item, index) => {
        const width = Number(item.width) || 0;
        const height = Number(item.height) || 0;
        const tiles = Array.isArray(item.tiles) ? item.tiles : [];
        return {
          id: item.id ?? createStructureId(item.name ?? `import-${index}`),
          name: item.name ?? `Imported ${index + 1}`,
          width,
          height,
          tiles: tiles.length === width * height ? tiles : Array.from({ length: width * height }, (_, i) => tiles[i] ?? null),
        } satisfies Structure;
      });
    structures.length = 0;
    structures.push(...cleaned);
    persistStructures();
    updateStructureUI();
    if (structures.length > 0) {
      selectStructure(structures[0].id, { syncSelect: true });
    }
  });

  return {
    structures,
    structureById,
    getSelectedStructureId: () => selectedStructureId,
    getSelectedStructure: () => structureById.get(selectedStructureId) ?? null,
    selectStructure,
    updateStructureUI,
    drawStructureGhost,
    encodeColor565,
  };
}
