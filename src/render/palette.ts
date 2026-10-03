/**
 * Color-manga palette: saturated flat colors with black ink and warm paper.
 * World colors are brighter than before, since ink outlines carry the contrast.
 */
export const COLORS = {
  grass: [0x9adf73, 0x9adf73],
  flower: [0x9adf73, 0x9adf73],
  path: [0xf2dca2, 0xf2dca2],
  cobble: [0xe4ded0, 0xe4ded0],
  wall: [0xe4ded0, 0xe4ded0],
  cavewall: [0x5b5660, 0x5b5660],
  houseWall: 0xfff2d8,
  houseShade: 0xe8d2a8,
  houseRoof: 0xe8563f,
  houseRoofShade: 0xbd3f2c,
  water: [0x5fd0f5, 0x5fd0f5],
  sand: [0xf7e3a8, 0xf7e3a8],
  plank: [0xd69d5e, 0xd69d5e],
  tileEdge: 0x16131c,
  treeTrunk: 0x9a5f38,
  treeLeaves: [0x56c45a, 0x6ad66b, 0x43a84a],
  rock: 0xc3cad4,
  rockShade: 0x8d96a3,
  shadow: 0x16131c,
  playerSkin: 0xffe3cc,
  playerHair: 0x6b4a8c,
  playerBody: 0x3f7cf0,
  hpBar: 0x3fd15a,
  hpBarLow: 0xff4a3a,
  spBar: 0x3f8ff8,
  xpBar: 0xffcc2e,
  jobXpBar: 0xb46cf0,
  barBack: 0xe9e3d6,
  ink: 0x16131c,
  paper: 0xfffaf0,
  /** Panels are paper with a black border and a hard offset shadow. */
  ui: 0xfffaf0,
  uiBorder: 0x16131c,
} as const;

/** Text colors for use on paper panels. */
export const TONE: Record<'ink' | 'muted' | 'accent' | 'gold' | 'good' | 'bad' | 'warn' | 'disabled', string> = {
  ink: '#16131c',
  muted: '#5d5866',
  accent: '#2f5fc4',
  gold: '#a8740a',
  good: '#24863a',
  bad: '#c43a2a',
  warn: '#c76a12',
  disabled: '#a5a1ab',
};

export const BODY_FONT = '"M PLUS Rounded 1c", "Trebuchet MS", Verdana, sans-serif';
/** Comic display face for titles, damage numbers and sound effects. */
export const IMPACT_FONT = 'Bangers, "Arial Black", Impact, sans-serif';

/** Ink on paper: panel and window text. */
export const TEXT = {
  fontFamily: BODY_FONT,
  fontSize: '13px',
  color: TONE.ink,
  stroke: '#fffaf0',
  strokeThickness: 0,
};

/** White with a heavy ink outline: anything drawn straight over the world. */
export const WORLD_TEXT = {
  fontFamily: BODY_FONT,
  fontSize: '13px',
  fontStyle: 'bold',
  color: '#ffffff',
  stroke: '#16131c',
  strokeThickness: 4,
};
