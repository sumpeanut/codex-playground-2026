import { describe, expect, it } from "vitest";
import { createGrid, setSolid, trimStructureGrid } from "../storage.ts";

const getTile = (tiles: Array<ReturnType<typeof createGrid>[number]>, width: number, x: number, y: number) => {
  return tiles[y * width + x];
};

describe("structure grid utilities", () => {
  it("creates an empty grid", () => {
    const tiles = createGrid(3, 2);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((tile) => tile === null)).toBe(true);
  });

  it("sets solids in bounds and ignores out of bounds", () => {
    const width = 4;
    const height = 3;
    const tiles = createGrid(width, height);

    setSolid(tiles, width, height, 1, 1, { passable: true });
    setSolid(tiles, width, height, -1, 0, { passable: true });

    const tile = getTile(tiles, width, 1, 1);
    expect(tile?.solid).toBe(true);
    expect(tile?.passable).toBe(true);
    expect(getTile(tiles, width, 0, 0)).toBeNull();
  });

  it("trims to the bounding box of placed tiles", () => {
    const width = 5;
    const height = 4;
    const tiles = createGrid(width, height);

    setSolid(tiles, width, height, 1, 1);
    setSolid(tiles, width, height, 3, 2);

    const trimmed = trimStructureGrid(tiles, width, height);

    expect(trimmed.width).toBe(3);
    expect(trimmed.height).toBe(2);
    expect(trimmed.tiles).toHaveLength(6);
    expect(trimmed.tiles[0]).not.toBeNull();
  });

  it("returns an empty grid when nothing is placed", () => {
    const tiles = createGrid(2, 2);
    const trimmed = trimStructureGrid(tiles, 2, 2);

    expect(trimmed.width).toBe(0);
    expect(trimmed.height).toBe(0);
    expect(trimmed.tiles).toEqual([]);
  });
});
