import Phaser from 'phaser';

/**
 * Keeps the game running through errors and shows them on screen.
 *
 * Phaser asks for the next frame only after a frame finishes, so one uncaught
 * error would stop the game for good. Each scene's update and render is guarded
 * on its own: a scene that fails every frame still lets the rest of the game
 * draw. Errors appear in a small banner, so a player on a phone can screenshot them.
 */
export function installErrorGuard(): void {
  const systems = Phaser.Scenes.Systems.prototype;
  const step = systems.step;
  systems.step = function (this: Phaser.Scenes.Systems, time, delta) {
    try {
      step.call(this, time, delta);
    } catch (err) {
      reportError(err, `${this.settings.key} update`);
    }
  };
  const render = systems.render;
  systems.render = function (this: Phaser.Scenes.Systems, renderer) {
    try {
      render.call(this, renderer);
    } catch (err) {
      reportError(err, `${this.settings.key} render`);
    }
  };

  const gameStep = Phaser.Game.prototype.step;
  Phaser.Game.prototype.step = function (this: Phaser.Game, time, delta) {
    try {
      gameStep.call(this, time, delta);
    } catch (err) {
      // Normally cleared at the end of rendering; left set, scene changes would queue forever.
      (this.scene as { isProcessing: boolean }).isProcessing = false;
      reportError(err, 'frame');
    }
  };

  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'page'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'async'));
}

const seen = new Map<string, number>();
let banner: HTMLDivElement | null = null;

function reportError(err: unknown, where: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const key = `${where}: ${message}`;
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  if (count > 1) {
    // The same error every frame: just keep the count on the banner current.
    if (count % 30 === 0) showBanner();
    return;
  }
  console.error(`Error in ${where} (game keeps running):`, err);
  showBanner(err instanceof Error ? err.stack : undefined);
}

let lastStack: string | undefined;

function showBanner(stack?: string): void {
  if (stack) lastStack = stack;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.title = 'Tap to hide';
    banner.addEventListener('click', () => banner?.remove());
    document.body.appendChild(banner);
  }
  if (!banner.isConnected) document.body.appendChild(banner);
  const lines = [...seen].map(([key, n]) => (n > 1 ? `${key} (×${n})` : key));
  // Where it happened: the first few frames of the stack, without long URLs.
  const where = (lastStack ?? '').split('\n').slice(1, 4).map((l) => l.trim().replace(/\(?https?:\/\/[^)\s]*\/([^/)\s]+)\)?/g, '$1'));
  banner.textContent = ['Something went wrong (tap to hide, please screenshot):', ...lines.slice(-3), ...where].join('\n');
}
