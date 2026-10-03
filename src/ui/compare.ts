import { equipBlocker, type GearPiece } from '../core/equipment';
import { formatDeltas, previewEquip } from '../core/progression';
import type { Player } from '../core/entities';
import { TONE } from '../render/palette';

/**
 * How a piece of gear compares with what's worn now: "If worn: ATK +12", in
 * green when strictly better, red when strictly worse (or not wearable), ink
 * when mixed.
 */
export function gearVerdict(player: Player, piece: GearPiece): { text: string; color: string; better: boolean } {
  const blocker = equipBlocker(player, piece.item);
  if (blocker) return { text: blocker, color: TONE.bad, better: false };
  const deltas = previewEquip(player, piece);
  const better = deltas.length > 0 && deltas.every((d) => d.delta > 0);
  const worse = deltas.length > 0 && deltas.every((d) => d.delta < 0);
  return { text: `If worn: ${formatDeltas(deltas)}`, color: better ? TONE.good : worse ? TONE.bad : TONE.ink, better };
}
