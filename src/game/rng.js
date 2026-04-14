// Seedable RNG. Unseeded: delegates to Math.random() so existing vi.spyOn tests keep working.
// Seeded: deterministic xorshift32 for reproducible simulations.

let state = null; // null = use Math.random; otherwise holds xorshift32 state as int32

export function seed(n) {
  if (n == null) {
    state = null;
    return;
  }
  // xorshift32 cannot use 0 as state; nudge to 1 if the caller passes 0.
  const s = n | 0;
  state = s === 0 ? 1 : s;
}

export function random() {
  if (state === null) return Math.random();
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state = s | 0;
  return (state >>> 0) / 0x100000000;
}

export const rand = (a, b) => Math.floor(random() * (b - a + 1)) + a;

export const pick = (arr) => arr[Math.floor(random() * arr.length)];
