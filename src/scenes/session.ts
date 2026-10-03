import type Phaser from 'phaser';
import type { Content } from '../data/content';
import { World } from '../core/world';
import type { SaveDb } from '../save/db';
import { SaveManager } from '../save/manager';
import type { SaveDoc } from '../save/schema';
import { applySaveDoc } from '../save/serialize';

/** Builds the world for a slot (from a save, or fresh) and switches to gameplay. */
export async function startSession(scene: Phaser.Scene, slot: number, doc: SaveDoc | null, newName?: string): Promise<void> {
  const content = scene.registry.get('content') as Content;
  const db = scene.registry.get('db') as SaveDb;
  const mapId = doc?.position.map ?? 'meadow-1';
  const map = content.maps.get(mapId) ?? content.maps.get('meadow-1')!;
  const world = new World(content, map, { playerName: newName });
  if (doc) applySaveDoc(world, doc);

  const saves = new SaveManager(db, slot, world, doc?.playtimeMs ?? 0, () => scene.game.events.emit('saved'));
  saves.attach();
  // A new character exists on disk from the first second, not only after the first autosave.
  if (!doc) await saves.save();

  scene.registry.set('world', world);
  scene.registry.set('saves', saves);
  scene.scene.start('World');
  scene.scene.launch('UI');
}

/** Saves, tears down gameplay and returns to slot selection. */
export async function endSession(scene: Phaser.Scene): Promise<void> {
  const saves = scene.registry.get('saves') as SaveManager | undefined;
  if (saves) {
    await saves.save();
    saves.detach();
  }
  scene.registry.remove('saves');
  scene.registry.remove('world');
  scene.scene.stop('UI');
  scene.scene.stop('World');
  scene.scene.start('Title');
}
