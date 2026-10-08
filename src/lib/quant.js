// Toy transform coder for teaching: orthonormal 8x8 DCT, uniform quantiser. H.264 really uses a 4x4 integer
// transform and rate-distortion tricks, but the step-size rule (doubles every +6 QP) is the same.
export const qstep = (qp) => 0.625 * 2 ** (qp / 6)

const N = 8
const C = Array.from({ length: N }, (_, k) => Array.from({ length: N }, (_, n) => (k ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))))

/** 2-D DCT of an 8x8 block given as a flat array of 64 (row-major). */
export function dct8(b) {
  const t = new Float64Array(64), o = new Float64Array(64)
  for (let y = 0; y < N; y++) for (let k = 0; k < N; k++) { let s = 0; for (let x = 0; x < N; x++) s += C[k][x] * b[y * N + x]; t[y * N + k] = s }
  for (let k = 0; k < N; k++) for (let l = 0; l < N; l++) { let s = 0; for (let y = 0; y < N; y++) s += C[k][y] * t[y * N + l]; o[k * N + l] = s }
  return o
}

export function idct8(c) {
  const t = new Float64Array(64), o = new Float64Array(64)
  for (let k = 0; k < N; k++) for (let x = 0; x < N; x++) { let s = 0; for (let l = 0; l < N; l++) s += C[l][x] * c[k * N + l]; t[k * N + x] = s }
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) { let s = 0; for (let k = 0; k < N; k++) s += C[k][y] * t[k * N + x]; o[y * N + x] = s }
  return o
}

/** Quantise a block's DCT with the step for `qp` and rebuild it. Returns coefficients, levels, result, rms error, non-zero count. */
export function codeBlock(block, qp) {
  const step = qstep(qp)
  const mean = block.reduce((a, v) => a + v, 0) / 64
  const coef = dct8(Float64Array.from(block, (v) => v - 128))
  const lev = Float64Array.from(coef, (c) => Math.round(c / step))
  const rec = idct8(Float64Array.from(lev, (l) => l * step))
  const out = Float64Array.from(rec, (v) => Math.min(255, Math.max(0, v + 128)))
  let se = 0, nz = 0
  for (let i = 0; i < 64; i++) { se += (out[i] - block[i]) ** 2; if (lev[i] !== 0) nz++ }
  return { step, coef, lev, out, rms: Math.sqrt(se / 64), nz, mean }
}
