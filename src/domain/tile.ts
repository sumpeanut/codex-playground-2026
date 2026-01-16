export const DEFAULT_SOLID_COLOR = "#d0dbe8";
export const DEFAULT_PASSABLE_COLOR = "#5a4a3a";

export const TILE_DAMAGE_MASK = 0xff;
export const TILE_SOLID_BIT = 1 << 8;
export const TILE_PASSABLE_BIT = 1 << 9;
export const TILE_COLOR_SHIFT = 10;
export const TILE_COLOR_MASK = 0xffff;

export type TileEncodingOptions = {
  damage?: number;
  solid?: boolean;
  passable?: boolean;
  colorBits?: number;
};

export function encodeTile({
  damage = 0,
  solid = true,
  passable = false,
  colorBits = 0,
}: TileEncodingOptions = {}): number {
  const dmg = damage & TILE_DAMAGE_MASK;
  const solidFlag = solid ? TILE_SOLID_BIT : 0;
  const passableFlag = passable ? TILE_PASSABLE_BIT : 0;
  const color = (colorBits & TILE_COLOR_MASK) << TILE_COLOR_SHIFT;
  return dmg | solidFlag | passableFlag | color;
}

export function getTileDamage(cell: number): number {
  return cell & TILE_DAMAGE_MASK;
}

export function getTileSolid(cell: number): boolean {
  return (cell & TILE_SOLID_BIT) !== 0;
}

export function getTilePassable(cell: number): boolean {
  return (cell & TILE_PASSABLE_BIT) !== 0;
}

export function getTileColorBits(cell: number): number {
  return (cell >> TILE_COLOR_SHIFT) & TILE_COLOR_MASK;
}

export function blocksEntity(cell: number): boolean {
  return getTileSolid(cell) && !getTilePassable(cell);
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
