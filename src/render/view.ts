import type Phaser from 'phaser';

/**
 * Device pixel ratio the game renders at. Phones have 2-3 physical pixels per
 * CSS pixel; rendering at 1x and letting the browser stretch it looks soft.
 * The canvas is sized in physical pixels and every scene's camera zooms by DPR,
 * so game code keeps working in CSS-pixel units.
 */
export const DPR = typeof window === 'undefined' ? 1 : Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 4) / 4));

/** Screen size in CSS pixels (what layout code should use). */
export function viewSize(scene: Phaser.Scene): { width: number; height: number } {
  return { width: scene.scale.width / DPR, height: scene.scale.height / DPR };
}

/** For screen-space scenes (UI, title): zoom by DPR with (0, 0) at the top-left. */
export function screenCamera(scene: Phaser.Scene): void {
  scene.cameras.main.setOrigin(0, 0).setZoom(DPR);
}
