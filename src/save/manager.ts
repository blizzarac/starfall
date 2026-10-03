import type { World } from '../core/world';
import type { SaveDb } from './db';
import { migrate } from './migrations';
import { toSaveDoc, toStorageDoc } from './serialize';
import type { SaveDoc } from './schema';

export const AUTOSAVE_MS = 60_000;
const LAST_SLOT_KEY = 'starfall:lastSlot';

/** "Last slot played" lives in localStorage so the title screen can highlight it instantly. */
export function getLastSlot(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_SLOT_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function setLastSlot(slot: number): void {
  try {
    localStorage.setItem(LAST_SLOT_KEY, String(slot));
  } catch {
    // Private mode or blocked storage: only the title-screen hint is lost.
  }
}

/** Asks the browser not to evict our data under storage pressure. Best effort; once per session. */
let persistRequested = false;
async function requestPersistence(): Promise<void> {
  if (persistRequested) return;
  persistRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported; saves still work, they're just evictable.
  }
}

/**
 * Owns saving for one play session: autosaves on a timer, when the page is hidden
 * (phones kill background tabs without warning) and whenever asked.
 */
export class SaveManager {
  private sinceSave = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: SaveDb,
    readonly slot: number,
    private readonly world: World,
    /** Playtime already on the save before this session. */
    private readonly basePlaytimeMs: number,
    private readonly onSaved: () => void = () => {},
  ) {
    setLastSlot(slot);
    // The design doc's autosave points: every map change, plus the timer and page hide below.
    world.events.on('mapChanged', () => void this.save());
  }

  private readonly onHide = () => {
    if (document.visibilityState === 'hidden') void this.save();
  };
  private readonly onPageHide = () => void this.save();

  /** Saves whenever the page is backgrounded or closed. */
  attach(): void {
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  detach(): void {
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  get playtimeMs(): number {
    return this.basePlaytimeMs + this.world.time;
  }

  /** Call every frame with elapsed ms. */
  update(deltaMs: number): void {
    this.sinceSave += deltaMs;
    if (this.sinceSave >= AUTOSAVE_MS) void this.save();
  }

  /** Saves now. Writes are queued so two saves never interleave. */
  save(): Promise<void> {
    this.sinceSave = 0;
    const doc = toSaveDoc(this.world, this.playtimeMs);
    const storage = toStorageDoc(this.world);
    this.writing = this.writing
      .then(() => this.db.write(this.slot, doc, storage))
      .then(() => {
        this.onSaved();
        return requestPersistence();
      })
      .catch((err) => console.error('Save failed', err));
    return this.writing;
  }

  snapshot(): SaveDoc {
    return toSaveDoc(this.world, this.playtimeMs);
  }
}

// ---- Export / import ------------------------------------------------------

export function exportFileName(doc: SaveDoc): string {
  const safe = doc.character.name.replace(/[^a-z0-9_-]+/gi, '_');
  const date = new Date(doc.savedAt).toISOString().slice(0, 10);
  return `starfall-${safe}-lv${doc.character.baseLevel}-${date}.json`;
}

/** Offers the save as a .json download. */
export function downloadSave(doc: SaveDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(doc);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parses, migrates and validates an imported file. Throws a readable error if it isn't a valid save. */
export function parseSaveFile(text: string): SaveDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Starfall save (not JSON).");
  }
  try {
    return migrate(raw);
  } catch (err) {
    throw new Error(`That save can't be loaded: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Opens the system file picker and resolves with the chosen file's text, or null if cancelled. */
export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // iOS stores saves as JSON or plain text depending on how they were downloaded; accept both.
    input.accept = '.json,application/json,text/plain';
    // iOS Safari only reports the chosen file for an input that's part of the page.
    input.style.cssText = 'position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    let done = false;
    const finish = (text: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(text);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}
