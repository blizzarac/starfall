export interface Tile {
  x: number;
  y: number;
}

export type Terrain = 'grass' | 'path' | 'flower' | 'tree' | 'rock' | 'water';

const BLOCKING: ReadonlySet<Terrain> = new Set(['tree', 'rock', 'water']);

/** Walkability grid for one map; the core's only view of the map. */
export class Grid {
  readonly terrain: Terrain[];

  constructor(
    readonly width: number,
    readonly height: number,
    terrain: Terrain[],
  ) {
    if (terrain.length !== width * height) {
      throw new Error(`Grid expects ${width * height} tiles, got ${terrain.length}`);
    }
    this.terrain = terrain;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  terrainAt(x: number, y: number): Terrain | undefined {
    return this.inBounds(x, y) ? this.terrain[y * this.width + x] : undefined;
  }

  isWalkable(x: number, y: number): boolean {
    const t = this.terrainAt(x, y);
    return t !== undefined && !BLOCKING.has(t);
  }
}

/** Chebyshev distance: RO-style range, where diagonals count as one tile. */
export function tileDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}
