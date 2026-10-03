import type { MapDef } from '../data/schemas';
import { jobOf, SECOND_JOB_LEVEL } from './jobs';
import { skillLevel } from './skills';
import { storyHint } from './story';
import { bossFlag, visitedFlag, type World } from './world';

/** Lowest and highest monster level on a map (bosses left out), or null for towns. */
export function mapLevelRange(world: Pick<World, 'content'>, map: MapDef): [number, number] | null {
  const levels = map.spawns.map((s) => world.content.monsters.get(s.monster)!).filter((m) => !m.boss).map((m) => m.level);
  return levels.length ? [Math.min(...levels), Math.max(...levels)] : null;
}

/** The best hunting ground for this level: the hardest map whose weakest monster isn't above the player. */
export function recommendedMap(world: World): MapDef | null {
  const lv = world.player.baseLevel;
  let best: { map: MapDef; low: number } | null = null;
  for (const map of world.content.maps.values()) {
    const range = mapLevelRange(world, map);
    if (!map.hunt || !range || range[0] > lv + 2) continue;
    if (!best || range[0] > best.low) best = { map, low: range[0] };
  }
  return best?.map ?? null;
}

/** One short line telling the player what to do next. */
export function nextGoal(world: World): string {
  const p = world.player;
  const job = jobOf(p);
  const been = (map: string) => world.flags.has(visitedFlag(map));
  if (job.id === 'novice') {
    if (p.jobLevel < 10) return 'Reach job level 10: hunt Jellops in the Southern Meadow, south of Brightmoor.';
    if (skillLevel(p, 'basic_training') < 9) return 'Put your skill points into Basic Training (Skills).';
    return 'Join a guild in Brightmoor: Captain Harlan, Magister Ilse, Wren or Sister Maren.';
  }
  if (job.tier === 1 && p.jobLevel >= SECOND_JOB_LEVEL) {
    return been('sunspire') ? 'Take your second-job trial with your guild in Sunspire.' : 'Sail to Sunspire from Saltmere for your second-job trial.';
  }
  // The main story, when its next step is within reach.
  const story = storyHint(world.flags, p.baseLevel, been);
  if (story) return story;
  if (p.baseLevel >= 18 && !been('saltmere')) return 'Head east from Whisperwood to the harbor town of Saltmere.';
  if (p.baseLevel >= 30 && !been('sunspire')) return "Captain Rook's ship sails from Saltmere to the desert city of Sunspire.";
  if (p.baseLevel >= 28 && p.baseLevel < 45 && !world.flags.has(bossFlag('crystal_golem'))) return 'The Crystal Golem waits below the Glimmer Caves (Lv 30 boss).';
  if (p.baseLevel >= 45 && !been('iron-wastes')) return 'Pass through the east gate of Sunspire into the Iron Wastes.';
  if (p.baseLevel >= 50 && !world.flags.has(bossFlag('dust_pharaoh'))) return 'Face the Dust Pharaoh in the heart of the Sunken Ruins (Lv 55 boss).';
  if (p.baseLevel >= 58 && !world.flags.has(bossFlag('clockwork_titan'))) return 'Bring down the Clockwork Titan atop the Clockwork Citadel (Lv 65 boss).';
  const map = recommendedMap(world);
  const range = map ? mapLevelRange(world, map) : null;
  return map && range ? `Train in ${map.name} (monsters Lv ${range[0]}–${range[1]}).` : 'Explore!';
}
