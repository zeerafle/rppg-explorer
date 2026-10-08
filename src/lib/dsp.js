// Signal processing for rPPG, ported line-for-line from qp-probe/pilot/extract.py
// (POS, CHROM, band-pass, zero-padded Hann periodogram, HR peak). tests/dsp.test.js
// checks every function here against Python outputs on the real recordings.

export const BAND = [0.7, 3.0]      // Hz: rPPG band and heart-rate search band
export const WIN_S = 10
export const HOP_S = 5
export const POS_WIN_S = 1.6
export const NFFT = 1 << 16

// ------------------------------------------------------------- filtering ----

/** Direct form II transposed, scipy.signal.lfilter semantics. zi is copied. */
export function lfilter(b, a, x, zi) {
  const n = Math.max(a.length, b.length)
  const bb = new Float64Array(n), aa = new Float64Array(n)
  for (let i = 0; i < b.length; i++) bb[i] = b[i] / a[0]
  for (let i = 0; i < a.length; i++) aa[i] = a[i] / a[0]
  const z = new Float64Array(n - 1)
  if (zi) z.set(zi)
  const y = new Float64Array(x.length)
  for (let k = 0; k < x.length; k++) {
    const xk = x[k]
    const yk = bb[0] * xk + (n > 1 ? z[0] : 0)
    for (let i = 0; i < n - 2; i++) z[i] = z[i + 1] + bb[i + 1] * xk - aa[i + 1] * yk
    if (n > 1) z[n - 2] = bb[n - 1] * xk - aa[n - 1] * yk
    y[k] = yk
  }
  return y
}

function solve(A, B) {            // Gauss-Jordan with partial pivoting, small systems only
  const n = B.length
  const M = A.map((r, i) => [...r, B[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}

/** scipy.signal.lfilter_zi: the state for a unit step input. */
export function lfilterZi(b, a) {
  const n = Math.max(a.length, b.length)
  const bb = Array.from({ length: n }, (_, i) => (b[i] ?? 0) / a[0])
  const aa = Array.from({ length: n }, (_, i) => (a[i] ?? 0) / a[0])
  const m = n - 1
  // I - companion(a).T. companion(a) has first row -a[1:] and a subdiagonal of ones,
  // so its transpose has first column -a[1:] and a superdiagonal of ones.
  const IminusA = Array.from({ length: m }, () => new Array(m).fill(0))
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    const ct = (j === 0 ? -aa[i + 1] : 0) + (j === i + 1 ? 1 : 0)
    IminusA[i][j] = (i === j ? 1 : 0) - ct
  }
  const B = Array.from({ length: m }, (_, i) => bb[i + 1] - aa[i + 1] * bb[0])
  return solve(IminusA, B)
}

/** scipy.signal.filtfilt with its default odd-extension padding. */
export function filtfilt(b, a, x) {
  const n = x.length
  const padlen = 3 * Math.max(a.length, b.length)
  const ext = new Float64Array(n + 2 * padlen)
  for (let i = 0; i < padlen; i++) {
    ext[i] = 2 * x[0] - x[padlen - i]
    ext[n + padlen + i] = 2 * x[n - 1] - x[n - 2 - i]
  }
  ext.set(x, padlen)
  const zi = lfilterZi(b, a)
  let y = lfilter(b, a, ext, zi.map((z) => z * ext[0]))
  y.reverse()
  y = lfilter(b, a, y, zi.map((z) => z * y[0]))
  y.reverse()
  return y.slice(padlen, padlen + n)
}

export function bandpass(x, ba) {
  return filtfilt(ba.b, ba.a, x)
}

// ------------------------------------------------------------------ rPPG ----

const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length }
const std = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / a.length) }
export { mean, std }

export function windowLen(fps) { return Math.ceil(POS_WIN_S * fps) }

/** One POS / CHROM step on frames [e-l, e) of an (n,3) flat RGB trace.
 *  Returns every intermediate so the UI can show the algebra, not just the answer. */
export function projectWindow(rgb, e, l, method = 'pos') {
  const s = e - l
  const m = [0, 0, 0]
  for (let t = 0; t < l; t++) for (let c = 0; c < 3; c++) m[c] += rgb[(s + t) * 3 + c]
  for (let c = 0; c < 3; c++) m[c] = m[c] / l + 1e-9
  const norm = [new Float64Array(l), new Float64Array(l), new Float64Array(l)]
  for (let t = 0; t < l; t++) for (let c = 0; c < 3; c++) norm[c][t] = rgb[(s + t) * 3 + c] / m[c]
  const S0 = new Float64Array(l), S1 = new Float64Array(l)
  for (let t = 0; t < l; t++) {
    const [r, g, b] = [norm[0][t], norm[1][t], norm[2][t]]
    if (method === 'pos') { S0[t] = g - b; S1[t] = -2 * r + g + b }
    else { S0[t] = 3 * r - 2 * g; S1[t] = 1.5 * r + g - 1.5 * b }
  }
  const alpha = std(S0) / (std(S1) + 1e-9)
  const sign = method === 'pos' ? 1 : -1
  const h = new Float64Array(l)
  for (let t = 0; t < l; t++) h[t] = S0[t] + sign * alpha * S1[t]
  const hm = mean(h)
  for (let t = 0; t < l; t++) h[t] -= hm
  return { mean: m, norm, S0, S1, alpha, h }
}

function overlapAdd(rgb, fps, method) {
  const n = rgb.length / 3
  const l = windowLen(fps)
  const H = new Float64Array(n)
  for (let e = l; e <= n; e++) {
    const { h } = projectWindow(rgb, e, l, method)
    for (let t = 0; t < l; t++) H[e - l + t] += h[t]
  }
  return H
}

/** Wang et al. 2016. rgb: flat (n*3) trace. Returns the band-passed pulse signal. */
export function pos(rgb, fps, ba) { return bandpass(overlapAdd(rgb, fps, 'pos'), ba) }
/** de Haan & Jeanne 2013, same 1.6 s overlap-add framing. */
export function chrom(rgb, fps, ba) { return bandpass(overlapAdd(rgb, fps, 'chrom'), ba) }
export function pulseSignal(rgb, fps, ba, method) { return method === 'chrom' ? chrom(rgb, fps, ba) : pos(rgb, fps, ba) }

/** Green channel only: the naive baseline (relative trace, band-passed). */
export function greenOnly(rgb, fps, ba) {
  const n = rgb.length / 3
  const g = new Float64Array(n)
  let m = 0
  for (let i = 0; i < n; i++) m += rgb[i * 3 + 1]
  m /= n
  for (let i = 0; i < n; i++) g[i] = rgb[i * 3 + 1] / m - 1
  return bandpass(g, ba)
}

// -------------------------------------------------------------- spectrum ----

function fft(re, im) {              // in-place iterative radix-2
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

/** numpy.hanning */
export function hann(n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = n === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/** Zero-padded Hann periodogram restricted to a frequency range (default: the HR band).
 *  opts: nfft (zero padding), hann (taper), range ([lo,hi] Hz). Returns {f (Hz), p}. */
export function spectrum(x, fps, opts = {}) {
  const nfft = opts.nfft ?? NFFT, useHann = opts.hann ?? true, range = opts.range ?? BAND
  const m = mean(x), n = x.length
  const w = useHann ? hann(n) : new Float64Array(n).fill(1)
  const re = new Float64Array(nfft), im = new Float64Array(nfft)
  for (let i = 0; i < n; i++) re[i] = (x[i] - m) * w[i]
  fft(re, im)
  const k0 = Math.ceil((range[0] * nfft) / fps - 1e-9), k1 = Math.min(nfft >> 1, Math.floor((range[1] * nfft) / fps + 1e-9))
  const f = new Float64Array(k1 - k0 + 1), p = new Float64Array(k1 - k0 + 1)
  for (let k = k0; k <= k1; k++) {
    f[k - k0] = (k * fps) / nfft
    p[k - k0] = re[k] * re[k] + im[k] * im[k]
  }
  return { f, p }
}

export function peakBpm({ f, p }) {
  let k = 0
  for (let i = 1; i < p.length; i++) if (p[i] > p[k]) k = i
  return 60 * f[k]
}

export function hrBpm(x, fps) { return peakBpm(spectrum(x, fps)) }

/** Highest local maxima, at least minSepBpm apart, as [{bpm, rel}] (rel = power / max). */
export function topPeaks({ f, p }, count = 4, minSepBpm = 6) {
  let pmax = 0
  for (const v of p) if (v > pmax) pmax = v
  const cand = []
  for (let i = 1; i < p.length - 1; i++) if (p[i] > p[i - 1] && p[i] >= p[i + 1]) cand.push(i)
  cand.sort((a, b) => p[b] - p[a])
  const out = []
  for (const i of cand) {
    if (out.every((o) => Math.abs(o.bpm - 60 * f[i]) >= minSepBpm)) out.push({ bpm: 60 * f[i], rel: p[i] / pmax })
    if (out.length >= count) break
  }
  return out
}

// ------------------------------------------------------------- windowing ----

export function windowStarts(usable, fps) {
  const wn = Math.round(WIN_S * fps), hop = Math.round(HOP_S * fps)
  const out = []
  for (let s = 0; s + wn <= usable; s += hop) out.push(s)
  return { wn, starts: out }
}

/** Multiples of the keyframe frequency fps/period that fall in the HR band, in bpm. */
export function keyframeHarmonics(fps, period) {
  const out = []
  for (let k = 1; ; k++) {
    const b = (60 * k * fps) / period
    if (b > 60 * BAND[1]) break
    if (b >= 60 * BAND[0]) out.push({ k, bpm: b })
  }
  return out
}

/** Median of the gaps between keyframes, in frames (null if fewer than three keyframes). */
export function keyframePeriod(isIdx) {
  if (isIdx.length < 3) return null
  const g = []
  for (let i = 1; i < isIdx.length; i++) g.push(isIdx[i] - isIdx[i - 1])
  g.sort((a, b) => a - b)
  const m = g.length >> 1
  return g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2
}

export function median(a) {
  const s = Float64Array.from(a).sort()
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** x minus its centred moving average (win samples, shrinking at the edges): a crude high-pass. */
export function highpassMA(x, win) {
  const n = x.length, h = Math.floor(win / 2)
  const cs = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n, i + h + 1)
    out[i] = x[i] - (cs[b] - cs[a]) / (b - a)
  }
  return out
}

/** Mean and std of x folded on a repeating cycle. starts = frame index where each cycle begins;
 *  only complete cycles of exactly `period` frames are used and each cycle's own mean is removed. */
export function foldCycles(x, starts, period) {
  const sum = new Float64Array(period), sq = new Float64Array(period)
  let cnt = 0
  for (const s0 of starts) {
    if (s0 + period > x.length) continue
    let m = 0
    for (let j = 0; j < period; j++) m += x[s0 + j]
    m /= period
    for (let j = 0; j < period; j++) { const v = x[s0 + j] - m; sum[j] += v; sq[j] += v * v }
    cnt++
  }
  const mean = new Float64Array(period), sd = new Float64Array(period)
  for (let j = 0; j < period; j++) { mean[j] = sum[j] / cnt; sd[j] = Math.sqrt(Math.max(0, sq[j] / cnt - mean[j] ** 2)) }
  return { mean, sd, cycles: cnt }
}

/** RBJ-cookbook second-order Butterworth-style section (Q = 1/sqrt 2). type: 'lp' | 'hp'. */
export function biquad(type, f0, fs, Q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q)
  const a0 = 1 + al
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2]
  return { b: b.map((v) => v / a0), a: [1, (-2 * c) / a0, (1 - al) / a0] }
}

/** Zero-phase band-pass from one high-pass and one low-pass section; lo <= 0 or hi >= Nyquist skips that side.
 *  A teaching filter: gentler than the pipeline's 3rd-order Butterworth, same idea. */
export function filterBand(x, fs, lo, hi) {
  let y = Float64Array.from(x)
  if (lo > 0) { const f = biquad('hp', lo, fs); y = filtfilt(f.b, f.a, y) }
  if (hi > 0 && hi < fs / 2) { const f = biquad('lp', hi, fs); y = filtfilt(f.b, f.a, y) }
  return y
}
