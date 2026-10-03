import Phaser from 'phaser';
import { DPR } from './view';

/**
 * High-resolution world art. Generated textures (trees, houses, monsters, the
 * ground) are drawn ART_RES times bigger than their size in the world, so they
 * stay sharp on high-DPI screens. Images of those textures compensate
 * automatically: game code keeps using world-size scales (1 = natural size).
 */
export const ART_RES = Math.max(1, Math.min(3, Math.ceil(DPR)));
/** The ground is a big texture per map, so it gets less supersampling. */
export const GROUND_RES = Math.min(2, ART_RES);

const resByKey = new Map<string, number>();

/** Records that texture `key` was drawn `res` times its world size. */
export function setArtRes(key: string, res: number): void {
  resByKey.set(key, res);
}

/** How many times bigger than its world size texture `key` is (1 for ordinary textures). */
export function artRes(key: string): number {
  return resByKey.get(key) ?? 1;
}

/**
 * Makes `scene.add.image` compensate for supersampled textures. The image's
 * scaleX/scaleY read and write world-size values; only while rendering do they
 * report the real scale (world scale / texture resolution) to the renderer.
 */
export function installArtImages(): void {
  const proto = Phaser.GameObjects.Image.prototype as unknown as Record<string, unknown>;
  type Art = Phaser.GameObjects.Image & { _rendering?: boolean };
  const res = (img: Art) => (img._rendering ? 1 : artRes(img.texture.key));
  for (const name of ['scaleX', 'scaleY'] as const) {
    const d = (Phaser.GameObjects.Components as unknown as Record<string, Record<string, { get: () => number; set: (v: number) => void }>>).Transform![name]!;
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: Art) {
        return d.get.call(this) * res(this);
      },
      set(this: Art, v: number) {
        d.set.call(this, v / artRes(this.texture.key));
      },
    });
  }
  Object.defineProperty(proto, 'scale', {
    configurable: true,
    get(this: Art) {
      return (this.scaleX + this.scaleY) / 2;
    },
    set(this: Art, v: number) {
      this.scaleX = v;
      this.scaleY = v;
    },
  });
  for (const method of ['renderWebGL', 'renderCanvas'] as const) {
    const render = proto[method] as ((...args: unknown[]) => void) | undefined;
    if (!render) continue;
    proto[method] = function (this: Art, ...args: unknown[]) {
      this._rendering = true;
      try {
        render.apply(this, args);
      } finally {
        this._rendering = false;
      }
    };
  }
  // New images start at world scale 1, whatever their texture's resolution.
  const addImage = Phaser.GameObjects.GameObjectFactory.prototype.image;
  Phaser.GameObjects.GameObjectFactory.prototype.image = function (this: Phaser.GameObjects.GameObjectFactory, x, y, texture, frame) {
    return addImage.call(this, x, y, texture, frame).setScale(1);
  };
  // Changing to a texture of a different resolution keeps the world-size scale.
  const setTexture = Phaser.GameObjects.Image.prototype.setTexture;
  Phaser.GameObjects.Image.prototype.setTexture = function (this: Art, key, frame) {
    const sx = this.texture ? this.scaleX : 1;
    const sy = this.texture ? this.scaleY : 1;
    setTexture.call(this, key, frame);
    return this.setScale(sx, sy);
  };
}
