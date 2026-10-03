import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker. When a new version is waiting, `onUpdate` gets a
 * function that activates it and reloads; the game decides when to show that.
 */
export function setupPwa(onUpdate: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      onUpdate(() => void updateSW(true));
    },
  });
}

/** A small DOM banner above the canvas, so it works on every scene. */
export function showUpdateBanner(onReload: () => void): void {
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.innerHTML = '<span>A new version of Starfall is ready.</span>';
  const reload = document.createElement('button');
  reload.textContent = 'Save & reload';
  reload.onclick = () => {
    reload.disabled = true;
    onReload();
  };
  const later = document.createElement('button');
  later.textContent = 'Later';
  later.className = 'later';
  later.onclick = () => bar.remove();
  bar.append(reload, later);
  document.body.appendChild(bar);
}
