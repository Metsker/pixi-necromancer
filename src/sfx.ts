// Every sound in the game is made here, at runtime. Pixi renders pictures and
// has no synthesis in it, so this is the platform's own oscillator: nothing to
// load, nothing to ship, and a whole sound bank costs a page of numbers.

type Voice = {
  wave?: OscillatorType; // absent means noise
  f: number; // hz, or the band the noise is squeezed into
  to?: number; // where it slides by the end
  at?: number; // seconds after the sound begins
  atk?: number; // how long it takes to arrive - long enough and it swells
  dur: number;
  gain: number;
  q?: number; // how narrow the noise band is
};

const SOUNDS = {
  // the sheets
  tap: [{ wave: "square", f: 940, to: 700, dur: 0.045, gain: 0.12 }],
  open: [
    { wave: "square", f: 520, dur: 0.05, gain: 0.1 },
    { wave: "square", f: 780, at: 0.045, dur: 0.06, gain: 0.1 },
  ],
  close: [{ wave: "square", f: 620, to: 380, dur: 0.06, gain: 0.1 }],
  // Shuffling a line is done over and over, so it gets a dry tick with no pitch
  // in it: a blip you hear eight times running is a blip you come to hate.
  move: [{ f: 420, to: 220, dur: 0.035, gain: 0.09, q: 2.2 }],
  type: [{ wave: "square", f: 1500, to: 1200, dur: 0.014, gain: 0.05 }],
  // the map
  step: [{ f: 260, to: 150, dur: 0.07, gain: 0.07, q: 1.4 }],
  send: [{ f: 1800, to: 380, dur: 0.28, gain: 0.09, q: 0.6 }],
  // blows
  hit: [
    { f: 1500, to: 420, dur: 0.08, gain: 0.16, q: 0.8 },
    { wave: "square", f: 190, to: 70, dur: 0.1, gain: 0.13 },
  ],
  hurt: [
    { f: 900, to: 200, dur: 0.11, gain: 0.13, q: 0.7 },
    { wave: "sawtooth", f: 210, to: 85, dur: 0.15, gain: 0.14 },
  ],
  die: [
    { wave: "square", f: 300, to: 55, dur: 0.26, gain: 0.15 },
    { f: 700, to: 130, dur: 0.3, gain: 0.1, q: 0.6 },
  ],
  // the dead
  // Weight, then a falling minor, then a breath drawn in. Anything that climbs
  // as it arrives is a power-up, and nothing here is pleased to be standing.
  rise: [
    { wave: "sine", f: 55, dur: 0.5, gain: 0.2, atk: 0.05 },
    { wave: "triangle", f: 165, to: 131, dur: 0.55, gain: 0.09, atk: 0.12 },
    { f: 240, to: 900, dur: 0.4, gain: 0.07, q: 1.2, atk: 0.22 },
  ],
  eat: [
    { f: 340, to: 110, dur: 0.16, gain: 0.16, q: 0.9 },
    { wave: "sine", f: 95, to: 60, dur: 0.14, gain: 0.14 },
  ],
  mend: [
    { wave: "sine", f: 660, dur: 0.12, gain: 0.12 },
    { wave: "sine", f: 990, at: 0.08, dur: 0.16, gain: 0.1 },
  ],
  // what a room pays
  clear: [
    { wave: "triangle", f: 392, dur: 0.1, gain: 0.13 },
    { wave: "triangle", f: 523, at: 0.08, dur: 0.1, gain: 0.13 },
    { wave: "triangle", f: 659, at: 0.16, dur: 0.16, gain: 0.13 },
  ],
  buy: [
    { wave: "sine", f: 880, dur: 0.14, gain: 0.12 },
    { wave: "sine", f: 1320, at: 0.02, dur: 0.2, gain: 0.07 },
  ],
  level: [
    { wave: "square", f: 523, dur: 0.08, gain: 0.1 },
    { wave: "square", f: 659, at: 0.07, dur: 0.08, gain: 0.1 },
    { wave: "square", f: 784, at: 0.14, dur: 0.08, gain: 0.1 },
    { wave: "square", f: 1046, at: 0.21, dur: 0.22, gain: 0.11 },
  ],
  // the end of it
  win: [
    { wave: "triangle", f: 523, dur: 0.16, gain: 0.14 },
    { wave: "triangle", f: 784, at: 0.15, dur: 0.16, gain: 0.14 },
    { wave: "triangle", f: 1046, at: 0.3, dur: 0.5, gain: 0.16 },
  ],
  lose: [
    { wave: "sawtooth", f: 220, to: 55, dur: 0.9, gain: 0.16 },
    { f: 400, to: 90, dur: 1, gain: 0.08, q: 0.7 },
  ],
} satisfies Record<string, Voice[]>;

export type SfxName = keyof typeof SOUNDS;

const MASTER = 0.35;
const ATTACK = 0.006;
// Two of the same noise inside this window is one noise. A frame can settle a
// whole turn, and six rats hitting on the same tick is a click, not a chord.
const MIN_GAP = 0.04;
const MUTE_KEY = "gravelight.mute";

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let hiss: AudioBuffer | null = null;
let muted: boolean | null = null;
const last: Record<string, number> = {};

// Read late and guarded: this module is pulled in by the layout check, which
// runs in node where there is no store to ask
const stored = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

export const sfxMuted = () => (muted ??= stored());

export function toggleSfx() {
  muted = !sfxMuted();
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // a blocked store only costs the setting
  }
}

function boot(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  bus = ctx.createGain();
  bus.gain.value = MASTER;
  bus.connect(ctx.destination);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  hiss = buf;
  return ctx;
}

// A touch is what buys the right to make a sound at all
export function unlock() {
  const c = boot();
  if (c && c.state !== "running") void c.resume();
}

function voice(c: AudioContext, v: Voice, t: number, bend: number) {
  const t0 = t + (v.at ?? 0);
  const t1 = t0 + v.dur;
  const g = c.createGain();
  // Never longer than half of it, or a sound spends its whole life arriving
  const atk = Math.min(v.atk ?? ATTACK, v.dur / 2);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v.gain, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  g.connect(bus!);

  const from = v.f * bend;
  const to = (v.to ?? v.f) * bend;
  let src: AudioScheduledSourceNode;
  if (v.wave) {
    const o = c.createOscillator();
    o.type = v.wave;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t1);
    o.connect(g);
    o.start(t0);
    src = o;
  } else {
    const s = c.createBufferSource();
    s.buffer = hiss;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = v.q ?? 1;
    band.frequency.setValueAtTime(from, t0);
    band.frequency.exponentialRampToValueAtTime(to, t1);
    s.connect(band).connect(g);
    // A different slice of the hiss each time, so twenty blows are twenty blows
    s.start(t0, Math.random() * 0.4);
    src = s;
  }
  src.stop(t1 + 0.02);
}

// `shift` is in semitones: a heavier blow lands lower than a glancing one
export function sfx(name: SfxName, shift = 0) {
  if (sfxMuted()) return;
  const c = boot();
  // Nothing is scheduled before the first touch, or the whole queue would land
  // at once the moment there is one
  if (!c || c.state !== "running") return;
  const now = c.currentTime;
  if (now - (last[name] ?? -9) < MIN_GAP) return;
  last[name] = now;
  const bend = 2 ** (shift / 12);
  for (const v of SOUNDS[name]) voice(c, v, now, bend);
}
