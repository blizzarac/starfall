import type { Grid, Tile } from './grid';

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Octile distance, admissible for 8-way movement with √2 diagonals. */
function heuristic(x: number, y: number, goal: Tile): number {
  const dx = Math.abs(x - goal.x);
  const dy = Math.abs(y - goal.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: Array<{ idx: number; f: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(idx: number, f: number): void {
    const items = this.items;
    items.push({ idx, f });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p]!.f <= items[i]!.f) break;
      [items[p], items[i]] = [items[i]!, items[p]!];
      i = p;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.f < items[m]!.f) m = l;
        if (r < items.length && items[r]!.f < items[m]!.f) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top.idx;
  }
}

export interface PathOptions {
  /** Give up after expanding this many nodes (keeps clicks on unreachable tiles cheap). */
  maxNodes?: number;
  /** Extra tiles to treat as blocked (other monsters, for example). */
  blocked?: (x: number, y: number) => boolean;
}

/**
 * A* over the grid with 8-way movement. Diagonals may not cut wall corners.
 * Returns the tiles to step through, excluding `start`, or null if unreachable.
 */
export function findPath(grid: Grid, start: Tile, goal: Tile, opts: PathOptions = {}): Tile[] | null {
  if (!grid.isWalkable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const maxNodes = opts.maxNodes ?? 4000;
  const w = grid.width;
  const passable = (x: number, y: number) =>
    grid.isWalkable(x, y) && !(opts.blocked?.(x, y) && !(x === goal.x && y === goal.y));

  const startIdx = start.y * w + start.x;
  const goalIdx = goal.y * w + goal.x;
  const g = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new Heap();
  open.push(startIdx, heuristic(start.x, start.y, goal));

  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalIdx) {
      const path: Tile[] = [];
      let n: number | undefined = cur;
      while (n !== undefined && n !== startIdx) {
        path.push({ x: n % w, y: Math.floor(n / w) });
        n = cameFrom.get(n);
      }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (++expanded > maxNodes) return null;

    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const cg = g.get(cur)!;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!grid.isWalkable(cx + dx, cy) || !grid.isWalkable(cx, cy + dy))) continue;
      const ni = ny * w + nx;
      if (closed.has(ni)) continue;
      const ng = cg + cost;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        cameFrom.set(ni, cur);
        open.push(ni, ng + heuristic(nx, ny, goal));
      }
    }
  }
  return null;
}
