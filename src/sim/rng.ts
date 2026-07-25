// mulberry32: one number of state, so a save can restore the exact stream
let s = 1;

export const seed = (n: number) => {
  s = n >>> 0;
};
export const rngState = () => s;
export const setRngState = (n: number) => {
  s = n >>> 0;
};

export function rnd(): number {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
export const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

// Fisher-Yates on a copy, so a caller's array is never reordered underneath it
export function shuffle<T>(a: readonly T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
