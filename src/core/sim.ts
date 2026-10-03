import { TICK_MS } from './combat/formulas';

/** Longest frame gap we catch up on; anything beyond is dropped (tab in background, debugger pause). */
const MAX_FRAME_MS = 250;

/**
 * Fixed-timestep driver: feeds real frame time in, runs whole simulation ticks,
 * and reports how far into the next tick the renderer should interpolate.
 */
export class SimClock {
  private accumulator = 0;
  ticks = 0;

  constructor(private readonly step: () => void) {}

  /** Returns interpolation alpha in [0, 1). */
  advance(frameMs: number): number {
    this.accumulator += Math.min(frameMs, MAX_FRAME_MS);
    while (this.accumulator >= TICK_MS) {
      this.step();
      this.accumulator -= TICK_MS;
      this.ticks += 1;
    }
    return this.accumulator / TICK_MS;
  }
}
