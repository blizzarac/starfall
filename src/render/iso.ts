/** Isometric projection: a tile is a 2:1 diamond, tile (x, y) centered at the returned point. */
export const TILE_W = 64;
export const TILE_H = 32;

export function tileToWorld(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function worldToTile(wx: number, wy: number): { x: number; y: number } {
  const a = wx / (TILE_W / 2);
  const b = wy / (TILE_H / 2);
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** Draw order for objects standing on the map: further down the screen draws on top. */
export function depthFor(worldY: number): number {
  return 1000 + worldY;
}
