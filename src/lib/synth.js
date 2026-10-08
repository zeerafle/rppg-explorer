// Small signal generators for the Foundations modules. Everything built here is labelled
// "illustration" in the UI; the real recordings are used wherever the idea allows it.
export const times = (n, fs) => Float64Array.from({ length: n }, (_, i) => i / fs)
export const sine = (t, f, a = 1, ph = 0) => t.map((x) => a * Math.sin(2 * Math.PI * f * x + ph))
export const add = (...xs) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0))

/** Seeded N(0,1) samples (mulberry32 + Box-Muller) so a slider moves a fixed noise draw, not a new one. */
export function gauss(n, seed = 1) {
  let a = seed >>> 0
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return Float64Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()))
}

/** Periodic shapes with period T seconds. */
export const SHAPES = {
  sine: (t, T) => t.map((x) => Math.sin((2 * Math.PI * x) / T)),
  triangle: (t, T) => t.map((x) => 2 * Math.abs(2 * ((x / T) % 1) - 1) - 1),
  sawtooth: (t, T) => t.map((x) => 2 * ((x / T) % 1) - 1),
  pulses: (t, T) => t.map((x, i) => (i > 0 && Math.floor(x / T + 1e-9) !== Math.floor(t[i - 1] / T + 1e-9) ? 1 : 0) + (i === 0 ? 1 : 0)),
}
export const db = (p, ref, floor = -100) => Math.max(10 * Math.log10(Math.max(p / ref, 1e-30)), floor)
