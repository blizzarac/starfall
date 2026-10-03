/**
 * The main story: a cold splinter, three Starglass fragments, and what you do
 * with them. It hints rather than tells: a line or two per beat, item text,
 * and NPCs who change what they say. Progress lives in world flags
 * (`story:*`), so it saves with everything else.
 *
 * Three choices decide which endings the last room offers:
 *   the splinter (Act I)  — kept, left with Nim, or buried in Whisperwood
 *   the crown (Act II)    — taken from the throne, or left on it
 *   Pell (Act III)        — fought, followed, or walked past
 */
import type { JobId } from './jobs';

/** Flag keys. Choice flags hold the choice as a string. */
export const STORY = {
  /** The splinter is lying on the ground somewhere, waiting to be picked up. */
  splinterOut: 'story:splinter_out',
  splinter: 'story:splinter',
  pell: 'story:pell',
  /** 'nim' | 'kept' | 'buried' */
  splinterFate: 'story:splinter_fate',
  frag1: 'story:frag1',
  map: 'story:map',
  rook: 'story:rook',
  fountain: 'story:fountain',
  archivist: 'story:archivist',
  frag2: 'story:frag2',
  /** 'taken' | 'left' */
  crown: 'story:crown',
  /** Visits to the Iron Wastes since the second fragment: the scrap heap grows. */
  heap: 'story:heap',
  /** 'fought' | 'followed' | 'passed' */
  pellFate: 'story:pell_fate',
  frag3: 'story:frag3',
  /** 'silence' | 'crown' | 'return' | 'gap' */
  ending: 'story:ending',
} as const;

export const SPLINTER = 'star_splinter';

/** Which fragment each boss guards, and the flag set when you pick it up. */
export const FRAGMENTS: Record<string, { item: string; flag: string }> = {
  crystal_golem: { item: 'starglass_1', flag: STORY.frag1 },
  dust_pharaoh: { item: 'starglass_2', flag: STORY.frag2 },
  clockwork_titan: { item: 'starglass_3', flag: STORY.frag3 },
};

/** Story items: the flag picking each one up sets (the splinter and fragments). */
export const PICKUP_FLAGS: Record<string, string> = {
  [SPLINTER]: STORY.splinter,
  ...Object.fromEntries(Object.values(FRAGMENTS).map((f) => [f.item, f.flag])),
};

/** A line shown over the world when a boss first turns on you (only once you carry Starglass). */
export const BOSS_LINES: Record<string, { aggro?: string; lastPhase?: string }> = {
  crystal_golem: { aggro: 'It faces the wall, as if holding something in.' },
  dust_pharaoh: { aggro: '“You carry it too.”' },
  clockwork_titan: { lastPhase: '“Home.”' },
};

/** Each first job's guild hands you a keepsake: how that guild reads the shards. */
export const JOB_RELICS: Partial<Record<JobId, string>> = {
  swordsman: 'oathstone',
  mage: 'burnt_notebook',
  archer: 'silent_feather',
  acolyte: 'prayer_cord',
};

export type Ending = 'silence' | 'crown' | 'return' | 'gap';

/** What each ending leaves you: a keepsake, and the closing line. */
export const ENDINGS: Record<Ending, { reward: string; title: string }> = {
  silence: { reward: 'quiet_stone', title: 'Silence' },
  crown: { reward: 'guild_seal', title: 'The Crown' },
  return: { reward: 'empty_setting', title: 'Return' },
  gap: { reward: 'starglass_heart', title: 'The Gap' },
};

/**
 * The journal: fragments of what happened, never explanations. Each entry
 * shows once its flag is set (with `value`, only when the flag holds it).
 */
export const JOURNAL: Array<{ flag: string; value?: string | number | boolean; text: string }> = [
  { flag: STORY.splinter, text: 'A splinter. Warm to the touch. It wasn’t, a moment ago.' },
  { flag: STORY.pell, text: 'Pell: “Put that away. Don’t show Nim.”' },
  { flag: STORY.splinterFate, value: 'nim', text: 'You left the splinter with Nim. Nim didn’t ask where it came from.' },
  { flag: STORY.splinterFate, value: 'kept', text: 'You kept the splinter. Nim watched you put it away.' },
  { flag: STORY.splinterFate, value: 'buried', text: 'You buried the splinter where the trees lean away. They straightened, a little.' },
  { flag: STORY.frag1, text: 'The golem was holding something shut.' },
  { flag: STORY.map, text: 'Pell’s map. Sunspire, circled twice. Something east of it, scratched out.' },
  { flag: STORY.rook, text: 'Rook: “Same stones, every crossing. Someone in the sand pays double.”' },
  { flag: STORY.fountain, text: 'The fountain in Sunspire ran uphill as you passed.' },
  { flag: STORY.archivist, text: 'The Archivist: “We gave it a name. That was the mistake.”' },
  { flag: STORY.frag2, text: 'The king under the sand: “You carry it too.”' },
  { flag: STORY.crown, value: 'taken', text: 'You took the crown. It was sized for a head that wasn’t his.' },
  { flag: STORY.crown, value: 'left', text: 'You left the crown where he left it.' },
  { flag: STORY.pellFate, value: 'fought', text: 'You drew on Pell. He didn’t raise his sword.' },
  { flag: STORY.pellFate, value: 'followed', text: 'You followed Pell. “Then keep up.”' },
  { flag: STORY.pellFate, value: 'passed', text: 'You walked past Pell. “Good. Someone should.”' },
  { flag: STORY.frag3, text: 'The machine said one word. “Home.”' },
  { flag: STORY.ending, value: 'silence', text: 'The light went out of them. Out of everything, a little.' },
  { flag: STORY.ending, value: 'crown', text: 'They answer to you now. So does everything that comes for them.' },
  { flag: STORY.ending, value: 'return', text: 'Far above, a star went out, and one came back.' },
  { flag: STORY.ending, value: 'gap', text: 'Pell was right. It was a door. You are what stands in it.' },
];

type Flags = ReadonlyMap<string, string | number | boolean>;

/**
 * The next story step as a ★ hint, or null when there's nothing to chase (or
 * the next step is beyond the player's level for now).
 */
export function storyHint(flags: Flags, level: number, visited: (map: string) => boolean): string | null {
  const has = (f: string) => flags.has(f);
  if (has(STORY.ending)) return null;
  if (has(STORY.splinter) && !has(STORY.pell)) return 'The splinter is warm again. Pell, in Brightmoor’s square, looks away when you pass.';
  if (has(STORY.pell) && !has(STORY.frag1)) {
    return level >= 25 ? 'Deep in the Glimmer Caves, something is holding something shut.' : null;
  }
  if (has(STORY.frag1) && !has(STORY.map)) return 'Pell is gone. His desk is still in Brightmoor’s square.';
  if (has(STORY.map) && !has(STORY.frag2)) {
    if (!visited('sunspire')) return 'Pell’s map: Sunspire, circled twice. Captain Rook sails there from Saltmere.';
    return level >= 45 ? 'Beneath the Sunken Ruins, a king still sits on his throne.' : null;
  }
  if (has(STORY.frag2) && !has(STORY.crown)) return 'The throne in the Sunken Ruins isn’t empty yet.';
  if (has(STORY.crown) && !has(STORY.pellFate)) return 'East of Sunspire, the scrap is taking a shape. Pell’s scratched-out mark was there.';
  if (has(STORY.pellFate) && !has(STORY.frag3)) return level >= 55 ? 'The Clockwork Citadel. It’s almost finished.' : null;
  if (has(STORY.frag3)) return 'Three fragments. Atop the Citadel, there’s a place they fit.';
  return null;
}
