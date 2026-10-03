import type Phaser from 'phaser';
import type { SaveDb } from '../save/db';

/**
 * Graphics quality. "Low effects" is for older phones and battery saving:
 * a 30 fps cap, no screen shake or flashes, no speed lines, fewer particles.
 */
export const quality = { low: false };

const KEY = 'graphics';
const LOW_FPS = 30;

export async function loadQuality(db: SaveDb, game: Phaser.Game): Promise<void> {
  try {
    const v = (await db.getSetting(KEY)) as { low?: unknown } | undefined;
    applyQuality(game, v?.low === true);
  } catch {
    // Defaults are fine.
  }
}

export function setQuality(db: SaveDb, game: Phaser.Game, low: boolean): void {
  applyQuality(game, low);
  void db.setSetting(KEY, { low }).catch(() => {});
}

function applyQuality(game: Phaser.Game, low: boolean): void {
  quality.low = low;
  // Phaser's frame limiter: these are the fields its config sets up.
  const loop = game.loop as unknown as { fpsLimit: number; hasFpsLimit: boolean; _limitRate: number; running: boolean };
  if (loop.hasFpsLimit === low) return;
  loop.hasFpsLimit = low;
  loop.fpsLimit = low ? LOW_FPS : 0;
  loop._limitRate = low ? 1000 / LOW_FPS : 0;
  // The loop picks its step function when it starts, so restart it.
  if (loop.running) {
    game.loop.sleep();
    game.loop.wake(true);
  }
}
