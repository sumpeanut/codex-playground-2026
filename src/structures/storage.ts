import { DEFAULT_PASSABLE_COLOR, DEFAULT_SOLID_COLOR } from "../domain/tile.ts";
import { type Structure, type StructureTile } from "./utils.ts";

const STORAGE_KEY = "ca.structures.v1";
const STORAGE_VERSION = 1;

type StructureGrid = {
  width: number;
  height: number;
  tiles: Array<StructureTile | null>;
};

type TileOptions = {
  passable?: boolean;
  color?: string;
};

type StructureBuilder = (tools: {
  rect: (x0: number, y0: number, w: number, height: number, options?: TileOptions) => void;
  column: (x0: number, topY: number, bottomY: number, w?: number, passable?: boolean) => void;
  floor: (x0: number, y: number, w: number, thick?: number, options?: TileOptions) => void;
  setSolid: (x: number, y: number, options?: TileOptions) => void;
  groundY: number;
}) => void;

export function createTile({ passable = false, color }: TileOptions = {}): StructureTile {
  return {
    solid: true,
    passable,
    color: color ?? (passable ? DEFAULT_PASSABLE_COLOR : DEFAULT_SOLID_COLOR),
  };
}

export function createGrid(width: number, height: number): Array<StructureTile | null> {
  return Array.from({ length: width * height }, () => null);
}

export function setSolid(
  tiles: Array<StructureTile | null>,
  width: number,
  height: number,
  x: number,
  y: number,
  options: TileOptions = {}
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  tiles[y * width + x] = createTile(options);
}

export function trimStructureGrid(
  tiles: Array<StructureTile | null>,
  width: number,
  height: number
): StructureGrid {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!tiles[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return { width: 0, height: 0, tiles: [] };
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const trimmedTiles = Array.from({ length: trimmedWidth * trimmedHeight }, () => null as StructureTile | null);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = tiles[y * width + x];
      if (!tile) continue;
      const tx = x - minX;
      const ty = y - minY;
      trimmedTiles[ty * trimmedWidth + tx] = tile;
    }
  }

  return { width: trimmedWidth, height: trimmedHeight, tiles: trimmedTiles };
}

function buildStructureFromTest(name: string, title: string, builder: StructureBuilder): Structure {
  const gridWidth = 160;
  const gridHeight = 100;
  const tiles = createGrid(gridWidth, gridHeight);
  const groundY = gridHeight - 6;

  const rect = (x0: number, y0: number, w: number, height: number, options?: TileOptions) => {
    for (let y = y0; y < y0 + height; y++) {
      for (let x = x0; x < x0 + w; x++) setSolid(tiles, gridWidth, gridHeight, x, y, options);
    }
  };

  const column = (x0: number, topY: number, bottomY: number, w = 2, passable = true) => {
    for (let y = topY; y <= bottomY; y++) {
      for (let dx = 0; dx < w; dx++) {
        setSolid(tiles, gridWidth, gridHeight, x0 + dx, y, { passable });
      }
    }
  };

  const floor = (x0: number, y: number, w: number, thick = 2, options?: TileOptions) => {
    for (let t = 0; t < thick; t++) {
      for (let x = x0; x < x0 + w; x++) setSolid(tiles, gridWidth, gridHeight, x, y + t, options);
    }
  };

  builder({
    rect,
    column,
    floor,
    setSolid: (x, y, options) => setSolid(tiles, gridWidth, gridHeight, x, y, options),
    groundY,
  });

  const trimmed = trimStructureGrid(tiles, gridWidth, gridHeight);

  return {
    id: `structure-${name}`,
    name: title,
    width: trimmed.width,
    height: trimmed.height,
    tiles: trimmed.tiles,
  };
}

export function getDefaultStructures(): Structure[] {
  return [
    buildStructureFromTest("unsupported", "Unsupported Beam", ({ floor, column, groundY }) => {
      floor(40, groundY - 20, 80, 2);
      column(40, groundY - 20, groundY - 1, 3);
      column(117, groundY - 20, groundY - 1, 3);
    }),
    buildStructureFromTest("supported", "Supported Beam", ({ floor, column, groundY }) => {
      floor(40, groundY - 20, 80, 2);
      column(40, groundY - 20, groundY - 1, 3);
      column(60, groundY - 20, groundY - 1, 3);
      column(80, groundY - 20, groundY - 1, 3);
      column(100, groundY - 20, groundY - 1, 3);
      column(117, groundY - 20, groundY - 1, 3);
    }),
    buildStructureFromTest("cantilever", "Cantilever", ({ column, floor, groundY }) => {
      column(30, groundY - 40, groundY - 1, 4, false);
      floor(30, groundY - 40, 50, 3);
    }),
    buildStructureFromTest("arch", "Arch", ({ floor, setSolid, groundY }) => {
      for (let i = 0; i < 20; i++) {
        const y = groundY - 20 + Math.floor((i * i) / 20);
        setSolid(60 + i, y);
        setSolid(60 + i, y + 1);
        setSolid(100 - i, y);
        setSolid(100 - i, y + 1);
      }
      floor(78, groundY - 22, 4, 2);
    }),
    buildStructureFromTest("tower", "Tower", ({ rect, floor, groundY }) => {
      const towerX = 70;
      const towerW = 20;
      for (let floorNum = 0; floorNum < 5; floorNum++) {
        const fy = groundY - (floorNum + 1) * 12;
        rect(towerX, fy, 2, 12);
        rect(towerX + towerW - 2, fy, 2, 12);
        floor(towerX, fy + 10, towerW, 2);
      }
      floor(towerX, groundY - 60, towerW, 2);
    }),
    buildStructureFromTest("building", "Building", ({ rect, floor, groundY }) => {
      const bx = 50;
      const bw = 60;
      for (let floorNum = 0; floorNum < 3; floorNum++) {
        const fy = groundY - (floorNum + 1) * 15;
        rect(bx, fy, 2, 15);
        rect(bx + bw - 2, fy, 2, 15);
        floor(bx, fy + 13, bw, 2);
      }
      floor(bx, groundY - 45, bw, 2);
    }),
    buildStructureFromTest("bridge", "Bridge", ({ floor, column, groundY }) => {
      floor(20, groundY - 15, 120, 2);
      column(20, groundY - 15, groundY - 1, 3);
      column(78, groundY - 15, groundY - 1, 4);
      column(137, groundY - 15, groundY - 1, 3);
    }),
    buildStructureFromTest("stable", "Stable Building", ({ rect, floor, column, groundY }) => {
      const sx = 40;
      const sw = 80;
      const floorH = 15;

      for (let floorNum = 0; floorNum < 4; floorNum++) {
        const fy = groundY - (floorNum + 1) * floorH;
        rect(sx, fy, 3, floorH);
        rect(sx + sw - 3, fy, 3, floorH);
        floor(sx, fy + floorH - 2, sw, 2);
      }

      floor(sx, groundY - 4 * floorH, sw, 2);

      for (let cx = sx + 10; cx < sx + sw - 5; cx += 15) {
        column(cx, groundY - 4 * floorH, groundY - 1, 3, true);
      }
    }),
  ];
}

type StoredStructures = {
  version: number;
  structures: Structure[];
};

type StoredStructuresPayload = StoredStructures & {
  updatedAt?: string;
};

type ValidationResult<T> = {
  value: T | null;
  errors: string[];
};

const MAX_ERROR_DETAILS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateStructureTile(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is not an object`);
    return;
  }

  if (typeof value.solid !== "boolean") {
    errors.push(`${path}.solid must be a boolean`);
  }

  if (typeof value.passable !== "boolean") {
    errors.push(`${path}.passable must be a boolean`);
  }

  if (value.color !== undefined && typeof value.color !== "string") {
    errors.push(`${path}.color must be a string`);
  }
}

function validateStructure(value: unknown, index: number, errors: string[]): void {
  const basePath = `structures[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${basePath} is not an object`);
    return;
  }

  if (typeof value.id !== "string") {
    errors.push(`${basePath}.id must be a string`);
  }

  if (value.name !== undefined && typeof value.name !== "string") {
    errors.push(`${basePath}.name must be a string`);
  }

  if (!isFiniteNumber(value.width) || value.width < 0) {
    errors.push(`${basePath}.width must be a non-negative number`);
  }

  if (!isFiniteNumber(value.height) || value.height < 0) {
    errors.push(`${basePath}.height must be a non-negative number`);
  }

  if (!Array.isArray(value.tiles)) {
    errors.push(`${basePath}.tiles must be an array`);
    return;
  }

  if (isFiniteNumber(value.width) && isFiniteNumber(value.height)) {
    const expectedLength = value.width * value.height;
    if (value.tiles.length !== expectedLength) {
      errors.push(`${basePath}.tiles must have length ${expectedLength}`);
    }
  }

  value.tiles.forEach((tile, tileIndex) => {
    const tilePath = `${basePath}.tiles[${tileIndex}]`;
    if (tile === null) return;
    validateStructureTile(tile, tilePath, errors);
  });
}

function validateStructureArray(data: unknown): ValidationResult<Structure[]> {
  const errors: string[] = [];
  if (!Array.isArray(data)) {
    errors.push("structures is not an array");
    return { value: null, errors };
  }

  data.forEach((structure, index) => validateStructure(structure, index, errors));

  if (errors.length > 0) {
    return { value: null, errors };
  }

  return { value: data as Structure[], errors };
}

function validateStoredPayload(data: unknown): ValidationResult<StoredStructuresPayload> {
  const errors: string[] = [];
  if (!isRecord(data)) {
    errors.push("payload is not an object");
    return { value: null, errors };
  }

  if (!isFiniteNumber(data.version)) {
    errors.push("payload.version must be a number");
  }

  if (data.updatedAt !== undefined && typeof data.updatedAt !== "string") {
    errors.push("payload.updatedAt must be a string");
  }

  const structureValidation = validateStructureArray(data.structures);
  if (structureValidation.errors.length > 0) {
    errors.push(...structureValidation.errors.map((err) => `payload.${err}`));
  }

  if (errors.length > 0) {
    return { value: null, errors };
  }

  return {
    value: {
      version: data.version as number,
      structures: structureValidation.value ?? [],
      updatedAt: data.updatedAt as string | undefined,
    },
    errors,
  };
}

function logStorageValidationFailure(context: string, errors: string[], rawData: unknown): void {
  const message = errors.slice(0, MAX_ERROR_DETAILS).join("; ");
  console.warn(`[storage] ${context} failed validation: ${message}`, rawData);
}

function migrateStructures(rawData: unknown): StoredStructures | null {
  if (Array.isArray(rawData)) {
    const validation = validateStructureArray(rawData);
    if (!validation.value) {
      logStorageValidationFailure("Legacy structure array", validation.errors, rawData);
      return null;
    }
    return { version: STORAGE_VERSION, structures: validation.value };
  }

  if (isRecord(rawData) && Array.isArray(rawData.structures)) {
    const validation = validateStructureArray(rawData.structures);
    if (!validation.value) {
      logStorageValidationFailure("Legacy structure payload", validation.errors, rawData);
      return null;
    }
    return { version: STORAGE_VERSION, structures: validation.value };
  }

  return null;
}

export function saveStructures(structures: Structure[]): void {
  const payload = {
    version: STORAGE_VERSION,
    structures,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadStructures(): Structure[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const defaults = getDefaultStructures();
    saveStructures(defaults);
    return defaults;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    console.warn("[storage] Failed to parse stored structures JSON.", error);
    const defaults = getDefaultStructures();
    saveStructures(defaults);
    return defaults;
  }

  if (isRecord(parsed) && parsed.version === STORAGE_VERSION) {
    const validation = validateStoredPayload(parsed);
    if (validation.value) {
      return validation.value.structures;
    }
    logStorageValidationFailure("Stored payload", validation.errors, parsed);
  }

  const migrated = migrateStructures(parsed);
  if (migrated) {
    saveStructures(migrated.structures);
    return migrated.structures;
  }

  const defaults = getDefaultStructures();
  saveStructures(defaults);
  return defaults;
}

export function getStoredPayload(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function getStoredPayloadSize(): number {
  const payload = getStoredPayload();
  return payload?.length ?? 0;
}

export { STORAGE_KEY, STORAGE_VERSION };
