import { describe, expect, it } from "vitest";
import { createPathfinder } from "../astar.ts";
import { encodeTile } from "../../domain/tile.ts";

const buildGrid = (gridW: number, gridH: number) => {
  const cells = new Uint32Array(gridW * gridH);

  const setSolid = (x: number, y: number, options: { passable?: boolean } = {}) => {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return;
    cells[y * gridW + x] = encodeTile({ solid: true, passable: options.passable ?? false });
  };

  const fillGround = () => {
    for (let x = 0; x < gridW; x++) {
      setSolid(x, gridH - 1);
    }
  };

  return { cells, setSolid, fillGround };
};

describe("createPathfinder", () => {
  it("marks walkable cells only when supported", () => {
    const { cells, fillGround, setSolid } = buildGrid(10, 6);
    fillGround();

    const pathfinder = createPathfinder({
      gridW: 10,
      gridH: 6,
      getCell: (x, y) => cells[y * 10 + x],
    });

    expect(pathfinder.isWalkable(2, 4)).toBe(true);
    expect(pathfinder.isWalkable(2, 5)).toBe(false);

    setSolid(4, 4, { passable: true });
    expect(pathfinder.isWalkable(4, 4)).toBe(true);
  });

  it("finds a direct path across a flat surface", () => {
    const { cells, fillGround } = buildGrid(12, 6);
    fillGround();

    const pathfinder = createPathfinder({
      gridW: 12,
      gridH: 6,
      getCell: (x, y) => cells[y * 12 + x],
    });

    const path = pathfinder.findPath(1, 4, 8, 4);

    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual({ x: 8, y: 4 });
  });

  it("returns no path when everything is blocked", () => {
    const { cells, setSolid } = buildGrid(6, 6);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        setSolid(x, y);
      }
    }

    const pathfinder = createPathfinder({
      gridW: 6,
      gridH: 6,
      getCell: (x, y) => cells[y * 6 + x],
    });

    expect(pathfinder.findPath(1, 1, 4, 4)).toEqual([]);
    expect(pathfinder.findNearestWalkable(2, 2)).toBeNull();
  });
});
