export const DEFAULT_SOLID_COLOR = "#d0dbe8";
export const DEFAULT_PASSABLE_COLOR = "#5a4a3a";
export const DEFAULT_EDITOR_SIZE = 24;

export type StructureTile = {
  solid: boolean;
  passable: boolean;
  color?: string;
};

export type Structure = {
  id: string;
  name?: string;
  width: number;
  height: number;
  tiles: Array<StructureTile | null>;
};

export function createStructureId(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `custom-${safe || "structure"}-${Date.now().toString(36)}`;
}

export function createEmptyStructure(
  name: string,
  width: number = DEFAULT_EDITOR_SIZE,
  height: number = DEFAULT_EDITOR_SIZE
): Structure {
  return {
    id: createStructureId(name),
    name,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => null),
  };
}

export function encodeColor565(hexColor?: string | null): number {
  if (!hexColor) return 0;
  const hex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  if (hex.length !== 6) return 0;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0;
  const r5 = (r >> 3) & 0x1f;
  const g6 = (g >> 2) & 0x3f;
  const b5 = (b >> 3) & 0x1f;
  return (r5 << 11) | (g6 << 5) | b5;
}
