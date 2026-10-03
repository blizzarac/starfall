import { weaponOf } from '../core/equipment';
import type { World } from '../core/world';
import type { MapDef } from '../data/schemas';
import { audio, type Sfx } from './engine';
import type { ThemeId } from './music';

const SKILL_SFX: Record<string, Sfx> = {
  bash: 'bash',
  magnum_break: 'magnum',
  endure: 'buff',
  fire_bolt: 'fire',
  cold_bolt: 'cold',
  lightning_bolt: 'lightning',
  soul_strike: 'soul',
  double_strafe: 'arrow',
  arrow_shower: 'arrow',
  improve_concentration: 'buff',
  heal: 'heal',
  blessing: 'buff',
  increase_agi: 'buff',
  holy_light: 'holy',
  pierce: 'bash',
  bowling_bash: 'magnum',
  two_hand_quicken: 'buff',
  sight_rasher: 'fire',
  thunderstorm: 'lightning',
  meteor_storm: 'magnum',
  blitz_beat: 'arrow',
  claymore_trap: 'magnum',
  kyrie_eleison: 'buff',
  magnus_exorcismus: 'holy',
  impositio_manus: 'buff',
};

/** The tune for a map: its own if set, otherwise by kind. */
export function themeFor(map: MapDef): ThemeId {
  if (map.music) return map.music;
  return map.kind === 'town' ? 'town' : map.kind === 'dungeon' ? 'cave' : 'field';
}

/** Plays sounds for world events and switches music with the map. Returns an unbind function. */
export function bindWorldAudio(world: World): () => void {
  const ev = world.events;
  audio.setTheme(themeFor(world.map));
  const offs = [
    ev.on('damage', (e) => {
      if (e.sourceId === 'player' && e.targetId !== 'player') {
        if (e.crit) audio.play('crit');
        else audio.play(weaponOf(world.player).type === 'bow' ? 'arrow' : 'hit');
      } else if (e.targetId === 'player' && e.sourceId !== 'player') {
        audio.play('hurt');
      }
    }),
    ev.on('miss', () => audio.play('miss')),
    ev.on('petAttack', () => audio.play('hit')),
    ev.on('skillUsed', (e) => {
      const s = SKILL_SFX[e.skillId];
      if (s) audio.play(s);
    }),
    ev.on('itemPicked', () => audio.play('pickup')),
    ev.on('itemUsed', (e) => audio.play(e.item.effect ? 'warp' : 'potion')),
    ev.on('levelUp', () => audio.play('levelUp')),
    ev.on('jobChanged', () => audio.play('levelUp')),
    ev.on('playerDied', () => audio.play('die')),
    ev.on('monsterDied', () => audio.play('kill')),
    ev.on('telegraph', () => audio.play('warn')),
    ev.on('slam', () => audio.play('slam')),
    ev.on('castInterrupted', () => audio.play('error')),
    ev.on('refined', (e) => audio.play(e.success ? 'refineGood' : 'refineBad')),
    ev.on('crafted', () => audio.play('refineGood')),
    ev.on('questCompleted', () => audio.play('quest')),
    ev.on('petTamed', () => audio.play('tame')),
    ev.on('petLevelUp', () => audio.play('levelUp')),
    ev.on('tameFailed', () => audio.play('error')),
    ev.on('petFed', (e) => audio.play(e.delta > 0 ? 'tame' : 'error')),
    ev.on('boss', (e) => e.kind === 'appeared' && audio.play('warn')),
    ev.on('mapChanged', () => {
      audio.play('warp');
      audio.setTheme(themeFor(world.map));
    }),
  ];
  return () => offs.forEach((off) => off());
}
