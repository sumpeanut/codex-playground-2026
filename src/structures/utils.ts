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
