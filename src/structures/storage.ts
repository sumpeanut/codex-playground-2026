import { DEFAULT_PASSABLE_COLOR, DEFAULT_SOLID_COLOR, type Structure, type StructureTile } from "./utils.ts";

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

function createTile({ passable = false, color }: TileOptions = {}): StructureTile {
  return {
    solid: true,
    passable,
    color: color ?? (passable ? DEFAULT_PASSABLE_COLOR : DEFAULT_SOLID_COLOR),
  };
}

function createGrid(width: number, height: number): Array<StructureTile | null> {
  return Array.from({ length: width * height }, () => null);
}

function setSolid(
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

function trimStructureGrid(tiles: Array<StructureTile | null>, width: number, height: number): StructureGrid {
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

function migrateStructures(rawData: unknown): StoredStructures | null {
  if (Array.isArray(rawData)) {
    return { version: STORAGE_VERSION, structures: rawData as Structure[] };
  }

  if (rawData && typeof rawData === "object" && Array.isArray((rawData as StoredStructures).structures)) {
    return { version: STORAGE_VERSION, structures: (rawData as StoredStructures).structures };
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
  } catch {
    const defaults = getDefaultStructures();
    saveStructures(defaults);
    return defaults;
  }

  if (parsed && typeof parsed === "object" && (parsed as StoredStructures).version === STORAGE_VERSION) {
    const { structures } = parsed as StoredStructures;
    if (Array.isArray(structures)) {
      return structures;
    }
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

export { STORAGE_KEY, STORAGE_VERSION };
