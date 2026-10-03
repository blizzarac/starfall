import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DialogueRunner } from '../src/core/dialogue';
import { STORAGE_CAPACITY, visitedFlag, World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { SaveDb } from '../src/save/db';
import { applyStorageDoc, toSaveDoc, toStorageDoc } from '../src/save/serialize';

const content = loadContent();
const town = content.maps.get(START_MAP)!;
const newWorld = () => new World(content, town, { seed: 1 });

describe('the road to Saltmere', () => {
  it('Whisperwood leads to the coast, and the coast to Saltmere', () => {
    const ww = content.maps.get('whisperwood')!;
    expect(ww.portals.some((p) => p.to.map === 'saltmere-coast')).toBe(true);
    const coast = content.maps.get('saltmere-coast')!;
    expect(coast.portals.map((p) => p.to.map).sort()).toEqual(['saltmere', 'whisperwood']);
    expect(content.maps.get('saltmere')!.kind).toBe('town');
  });

  it('remembers every map visited', () => {
    const w = newWorld();
    expect(w.flags.get(visitedFlag('town'))).toBe(true);
    expect(w.flags.has(visitedFlag('saltmere'))).toBe(false);
    w.changeMap('saltmere', { x: 3, y: 13 });
    expect(w.flags.get(visitedFlag('saltmere'))).toBe(true);
  });
});

describe('shared storage', () => {
  it('stores and takes out stacks and gear, refine and all', () => {
    const w = newWorld();
    w.addItem('red_tonic', 5);
    expect(w.store('red_tonic', 2)).toBeNull();
    expect(w.itemCount('red_tonic')).toBe(3);
    expect(w.storage.items.get('red_tonic')).toBe(2);
    expect(w.store('red_tonic', 9)).toMatch(/don't have/);

    w.addItem('stiletto', 1);
    const piece = w.player.gear.find((g) => g.item.id === 'stiletto')!;
    piece.refine = 4;
    expect(w.storePiece(piece.uid)).toBeNull();
    expect(w.itemCount('stiletto')).toBe(0);
    expect(w.storageUsed()).toBe(2);

    expect(w.takeOut('red_tonic', 2)).toBeNull();
    expect(w.itemCount('red_tonic')).toBe(5);
    expect(w.storage.items.has('red_tonic')).toBe(false);
    expect(w.takePiece(piece.uid)).toBeNull();
    expect(w.player.gear.find((g) => g.item.id === 'stiletto')!.refine).toBe(4);
  });

  it('refuses when full or too heavy to carry', () => {
    const w = newWorld();
    for (let i = 0; i < STORAGE_CAPACITY; i++) w.storage.gear.push(w.newPiece(content.items.get('sandals')!));
    w.addItem('red_tonic', 1);
    expect(w.store('red_tonic', 1)).toMatch(/full/);
    const w2 = newWorld();
    w2.storage.items.set('boar_tusk', 500);
    expect(w2.takeOut('boar_tusk', 500)).toMatch(/carry/);
  });

  it('the courier charges for storage and teleports only to places you have been', () => {
    const w = newWorld();
    const npc = town.npcs.find((n) => n.dialogue === 'courier')!;
    const def = content.dialogues.get('courier')!;
    let d = new DialogueRunner(w, def, npc);
    d.choose(0);
    expect(d.openStorage).toBe(false);
    w.player.gold = 100;
    d = new DialogueRunner(w, def, npc);
    d.choose(0);
    expect(d.openStorage).toBe(true);
    expect(w.player.gold).toBe(70);

    d = new DialogueRunner(w, def, npc);
    d.choose(1);
    // Never been anywhere but town, and town itself is hidden.
    expect(d.view()!.choices).toEqual(['Never mind']);
    w.changeMap('saltmere', { x: 3, y: 13 });
    w.changeMap('town', { x: 15, y: 21 });
    w.player.gold = 1000;
    d = new DialogueRunner(w, def, npc);
    d.choose(1);
    expect(d.view()!.choices[0]).toMatch(/Saltmere/);
    d.choose(0);
    expect(w.map.id).toBe('saltmere');
    expect(w.player.gold).toBe(700);
  });

  it('is saved once for every slot, alongside each save', async () => {
    const db = new SaveDb(`storage-${Math.random()}`);
    const a = newWorld();
    a.addItem('panacea', 3);
    a.store('panacea', 3);
    await db.write(1, toSaveDoc(a, 0), toStorageDoc(a));

    // Another character loads the same storage.
    const b = newWorld();
    applyStorageDoc(b, await db.loadStorage());
    expect(b.storage.items.get('panacea')).toBe(3);
    b.takeOut('panacea', 3);
    await db.write(2, toSaveDoc(b, 0), toStorageDoc(b));
    const c = newWorld();
    applyStorageDoc(c, await db.loadStorage());
    expect(c.storageUsed()).toBe(0);
    db.close();
  });

  it('starts empty when nothing was stored yet', async () => {
    const db = new SaveDb(`storage-${Math.random()}`);
    expect(await db.loadStorage()).toEqual({ items: {}, gear: [] });
    db.close();
  });
});
