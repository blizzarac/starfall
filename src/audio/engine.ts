import { composeLoop, loopSteps, midiToHz, STEPS_PER_BAR, THEMES, type Note, type ThemeId, type Wave } from './music';

/** Every sound effect the game plays. All are synthesized; nothing is downloaded. */
export type Sfx =
  | 'hit'
  | 'crit'
  | 'bash'
  | 'miss'
  | 'hurt'
  | 'arrow'
  | 'fire'
  | 'cold'
  | 'lightning'
  | 'soul'
  | 'holy'
  | 'magnum'
  | 'heal'
  | 'buff'
  | 'potion'
  | 'levelUp'
  | 'pickup'
  | 'tap'
  | 'die'
  | 'kill'
  | 'slam'
  | 'warn'
  | 'warp'
  | 'refineGood'
  | 'refineBad'
  | 'quest'
  | 'error'
  | 'tame';

export interface AudioSettings {
  /** 0–1. */
  music: number;
  /** 0–1. */
  sfx: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { music: 0.6, sfx: 1, muted: false };

/** Seconds of music scheduled ahead of the playhead. */
const LOOKAHEAD = 0.25;
const TICK_MS = 60;
const FADE = 0.8;

interface ToneOpts {
  wave?: Wave;
  gain?: number;
  attack?: number;
  /** Frequency at the end of the note, for slides. */
  to?: number;
  dest?: AudioNode;
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  gain?: number;
  dest?: AudioNode;
}

/**
 * One AudioContext for the game. It can only start after the player touches
 * the screen (browser rule), so everything before that is remembered and
 * applied on unlock.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private settings: AudioSettings = { ...DEFAULT_AUDIO };
  private lastPlayed = new Map<Sfx, number>();

  private theme: ThemeId | null = null;
  private track: { id: ThemeId; notes: Map<number, Note[]>; steps: number; stepDur: number; out: GainNode; step: number; at: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Starts listening for the first touch, and pauses audio while the page is hidden. */
  install(): void {
    // iOS only counts some events as a user gesture, so listen to all of them.
    const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
    const unlock = () => {
      this.unlock();
      if (this.ctx?.state === 'running') for (const e of events) window.removeEventListener(e, unlock);
    };
    for (const e of events) window.addEventListener(e, unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get current(): AudioSettings {
    return { ...this.settings };
  }

  apply(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.music * 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
  }

  private unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // A gentle limiter so stacked hits never clip on phone speakers.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.apply(this.settings);
    void ctx.resume();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    if (this.theme) this.startTrack(this.theme);
  }

  // ---- Music ---------------------------------------------------------------

  /** Crossfades to a theme (or to silence with null). Calling with the current theme does nothing. */
  setTheme(id: ThemeId | null): void {
    if (id === this.theme) return;
    this.theme = id;
    if (!this.ctx) return;
    this.stopTrack();
    if (id) this.startTrack(id);
  }

  private startTrack(id: ThemeId): void {
    const ctx = this.ctx!;
    const theme = THEMES[id];
    const notes = new Map<number, Note[]>();
    for (const n of composeLoop(theme)) {
      const list = notes.get(n.step) ?? [];
      list.push(n);
      notes.set(n.step, list);
    }
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    out.connect(this.musicBus);
    this.track = { id, notes, steps: loopSteps(theme), stepDur: 60 / theme.bpm / 4, out, step: 0, at: ctx.currentTime + 0.1 };
  }

  private stopTrack(): void {
    const ctx = this.ctx;
    const track = this.track;
    this.track = null;
    if (!ctx || !track) return;
    track.out.gain.cancelScheduledValues(ctx.currentTime);
    track.out.gain.setValueAtTime(track.out.gain.value, ctx.currentTime);
    track.out.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
    setTimeout(() => track.out.disconnect(), FADE * 1000 + 300);
  }

  /** Queues every music note that starts within the lookahead window. */
  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track || ctx.state !== 'running') return;
    // After a long pause (tab hidden), skip ahead instead of playing a burst of old notes.
    if (track.at < ctx.currentTime - 0.5) track.at = ctx.currentTime + 0.05;
    const theme = THEMES[track.id];
    while (track.at < ctx.currentTime + LOOKAHEAD) {
      for (const n of track.notes.get(track.step) ?? []) this.playNote(n, track.at, track.stepDur, theme, track.out);
      track.step = (track.step + 1) % track.steps;
      track.at += track.stepDur;
    }
  }

  private playNote(n: Note, at: number, stepDur: number, theme: (typeof THEMES)[ThemeId], out: GainNode): void {
    const dur = n.length * stepDur;
    switch (n.voice) {
      case 'lead':
        this.tone(at, dur * 0.9, midiToHz(n.midi), { wave: theme.lead.wave, gain: theme.lead.gain, attack: 0.01, dest: out });
        break;
      case 'bass':
        this.tone(at, dur * 0.8, midiToHz(n.midi), { wave: theme.bass.wave, gain: theme.bass.gain, attack: 0.01, dest: out });
        break;
      case 'pad':
        if (theme.pad) this.tone(at, STEPS_PER_BAR * stepDur, midiToHz(n.midi), { wave: theme.pad.wave, gain: theme.pad.gain, attack: 0.4, dest: out });
        break;
      case 'kick':
        if (theme.drums) this.tone(at, 0.18, 110, { wave: 'sine', gain: theme.drums.gain * 4, to: 40, dest: out });
        break;
      case 'hat':
        if (theme.drums) this.noiseAt(at, 0.04, { filter: 'highpass', freq: 7000, gain: theme.drums.gain, dest: out });
        break;
    }
  }

  // ---- Sound effects -----------------------------------------------------

  play(sfx: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.settings.muted || this.settings.sfx === 0) return;
    // Many hits can land in one frame; one sound per kind per 40 ms is plenty.
    const now = performance.now();
    if (now - (this.lastPlayed.get(sfx) ?? -1e9) < 40) return;
    this.lastPlayed.set(sfx, now);
    const t = ctx.currentTime + 0.005;
    const S = this;
    const arp = (notes: number[], gap: number, len: number, wave: Wave, gain: number) =>
      notes.forEach((f, i) => S.tone(t + i * gap, len, f, { wave, gain }));
    switch (sfx) {
      case 'hit':
        this.noiseAt(t, 0.08, { filter: 'bandpass', freq: 1400, to: 500, q: 1.5, gain: 0.5 });
        this.tone(t, 0.1, 150, { wave: 'sine', gain: 0.5, to: 60 });
        break;
      case 'crit':
        this.noiseAt(t, 0.14, { filter: 'bandpass', freq: 2200, to: 400, q: 1, gain: 0.7 });
        this.tone(t, 0.16, 180, { wave: 'sine', gain: 0.7, to: 50 });
        arp([1320, 1760], 0.04, 0.08, 'square', 0.08);
        break;
      case 'bash':
        this.noiseAt(t, 0.15, { filter: 'lowpass', freq: 1800, to: 300, gain: 0.7 });
        this.tone(t, 0.2, 120, { wave: 'sine', gain: 0.8, to: 40 });
        break;
      case 'miss':
        this.noiseAt(t, 0.14, { filter: 'highpass', freq: 2500, to: 6000, gain: 0.18 });
        break;
      case 'hurt':
        this.tone(t, 0.16, 320, { wave: 'square', gain: 0.12, to: 120 });
        this.noiseAt(t, 0.06, { filter: 'lowpass', freq: 1200, gain: 0.3 });
        break;
      case 'arrow':
        this.tone(t, 0.09, 900, { wave: 'triangle', gain: 0.25, to: 220 });
        this.noiseAt(t + 0.02, 0.07, { filter: 'highpass', freq: 4000, gain: 0.12 });
        break;
      case 'fire':
        this.noiseAt(t, 0.4, { filter: 'lowpass', freq: 400, to: 2400, gain: 0.5 });
        this.tone(t, 0.3, 110, { wave: 'sawtooth', gain: 0.12, to: 70 });
        break;
      case 'cold':
        arp([1568, 2093, 2637, 3136], 0.035, 0.18, 'sine', 0.12);
        this.noiseAt(t, 0.25, { filter: 'highpass', freq: 6000, gain: 0.12 });
        break;
      case 'lightning':
        this.tone(t, 0.22, 1400, { wave: 'sawtooth', gain: 0.18, to: 80 });
        this.noiseAt(t, 0.2, { filter: 'bandpass', freq: 3000, q: 0.7, gain: 0.35 });
        break;
      case 'soul':
        this.tone(t, 0.22, 440, { wave: 'sine', gain: 0.25, to: 990 });
        this.tone(t + 0.05, 0.2, 660, { wave: 'triangle', gain: 0.12, to: 1320 });
        break;
      case 'holy':
        for (const f of [523, 659, 784, 1047]) this.tone(t, 0.6, f, { wave: 'sine', gain: 0.1, attack: 0.08 });
        this.noiseAt(t, 0.4, { filter: 'highpass', freq: 7000, gain: 0.08 });
        break;
      case 'magnum':
        this.tone(t, 0.45, 90, { wave: 'sine', gain: 0.9, to: 30 });
        this.noiseAt(t, 0.5, { filter: 'lowpass', freq: 3000, to: 200, gain: 0.7 });
        break;
      case 'heal':
        arp([523, 659, 784, 1047, 1319], 0.06, 0.25, 'triangle', 0.16);
        break;
      case 'buff':
        arp([392, 523, 784], 0.07, 0.22, 'square', 0.07);
        break;
      case 'potion':
        this.tone(t, 0.12, 300, { wave: 'sine', gain: 0.25, to: 600 });
        this.tone(t + 0.1, 0.12, 400, { wave: 'sine', gain: 0.2, to: 800 });
        break;
      case 'levelUp':
        arp([523, 659, 784], 0.09, 0.12, 'square', 0.1);
        this.tone(t + 0.27, 0.5, 1047, { wave: 'square', gain: 0.1 });
        this.tone(t + 0.27, 0.5, 1319, { wave: 'triangle', gain: 0.12 });
        break;
      case 'pickup':
        this.tone(t, 0.07, 880, { wave: 'sine', gain: 0.22, to: 1320 });
        break;
      case 'tap':
        this.tone(t, 0.035, 700, { wave: 'sine', gain: 0.12 });
        break;
      case 'die':
        this.tone(t, 0.9, 392, { wave: 'sawtooth', gain: 0.12, to: 90 });
        this.tone(t, 0.9, 294, { wave: 'triangle', gain: 0.15, to: 70 });
        break;
      case 'kill':
        this.noiseAt(t, 0.08, { filter: 'bandpass', freq: 900, q: 2, gain: 0.3 });
        this.tone(t + 0.03, 0.12, 330, { wave: 'triangle', gain: 0.2, to: 880 });
        break;
      case 'slam':
        this.tone(t, 0.6, 70, { wave: 'sine', gain: 1, to: 25 });
        this.noiseAt(t, 0.45, { filter: 'lowpass', freq: 600, to: 120, gain: 0.8 });
        break;
      case 'warn':
        this.tone(t, 0.12, 880, { wave: 'square', gain: 0.07 });
        this.tone(t + 0.16, 0.12, 880, { wave: 'square', gain: 0.07 });
        break;
      case 'warp':
        this.tone(t, 0.4, 220, { wave: 'sine', gain: 0.2, to: 1200 });
        this.tone(t + 0.05, 0.35, 330, { wave: 'triangle', gain: 0.1, to: 1800 });
        break;
      case 'refineGood':
        arp([784, 1047, 1568], 0.08, 0.35, 'triangle', 0.18);
        break;
      case 'refineBad':
        this.noiseAt(t, 0.5, { filter: 'highpass', freq: 1500, to: 400, gain: 0.5 });
        this.tone(t, 0.5, 220, { wave: 'sawtooth', gain: 0.1, to: 55 });
        break;
      case 'quest':
        arp([659, 784, 1047, 1319], 0.08, 0.2, 'triangle', 0.16);
        break;
      case 'error':
        this.tone(t, 0.1, 196, { wave: 'square', gain: 0.08 });
        this.tone(t + 0.12, 0.1, 165, { wave: 'square', gain: 0.08 });
        break;
      case 'tame':
        arp([523, 784, 659, 1047], 0.1, 0.22, 'sine', 0.18);
        break;
    }
  }

  // ---- Synth primitives -----------------------------------------------------

  private tone(at: number, dur: number, freq: number, o: ToneOpts = {}): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(freq, at);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), at + dur);
    const peak = o.gain ?? 0.2;
    const attack = Math.min(o.attack ?? 0.005, dur / 2);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(o.dest ?? this.sfxBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noiseAt(at: number, dur: number, o: NoiseOpts = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter ?? 'lowpass';
    filter.frequency.setValueAtTime(o.freq ?? 1000, at);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, at + dur);
    filter.Q.value = o.q ?? 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain ?? 0.3, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(env).connect(o.dest ?? this.sfxBus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }
}

/** The game's one audio engine. */
export const audio = new AudioEngine();
