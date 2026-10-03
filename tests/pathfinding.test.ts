import { describe, expect, it } from 'vitest';
import { Grid, type Terrain } from '../src/core/grid';
import { findPath } from '../src/core/pathfinding';

function gridFrom(rows: string[]): Grid {
  const terrain = rows.flatMap((r) => [...r].map((c): Terrain => (c === '#' ? 'rock' : 'grass')));
  return new Grid(rows[0]!.length, rows.length, terrain);
}

describe('findPath', () => {
  it('walks a diagonal on an open grid', () => {
    const grid = gridFrom(['....', '....', '....', '....']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('routes around walls', () => {
    const grid = gridFrom(['.#..', '.#..', '.#..', '....']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })!;
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
    for (const t of path) expect(grid.isWalkable(t.x, t.y)).toBe(true);
  });

  it('never cuts a wall corner diagonally', () => {
    const grid = gridFrom(['.#', '..']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('returns null for blocked or walled-off goals', () => {
    const grid = gridFrom(['..#.', '..#.', '###.', '....']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
  });

  it('returns an empty path when already there', () => {
    const grid = gridFrom(['..']);
    expect(findPath(grid, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });
});
