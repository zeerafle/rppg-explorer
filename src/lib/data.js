// Loaders and memoised derived signals for the files produced by data-build/build_data.py.
import * as D from './dsp.js'

const BASE = import.meta.env.BASE_URL + 'data/'
const memo = new Map()
const once = (key, fn) => {
  if (!memo.has(key)) memo.set(key, fn())
  return memo.get(key)
}
const json = (p) =>
  fetch(BASE + p).then((r) => {
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`)
    return r.json()
  })

export const SUBJECTS = [1, 10, 20, 30, 40]
export const HERO = 10
export const MODES = ['long', 'g30', 'g60', 'g120', 'intra-refresh']
export const MODE_LABEL = {
  source: 'Uncompressed',
  long: 'One keyframe',
  g30: 'Keyframe every 1 s',
  g60: 'Keyframe every 2 s',
  g120: 'Keyframe every 4 s',
  'intra-refresh': 'Intra-refresh',
}
export const MODE_COLOR = {
  source: '#6b6a66',
  long: '#2a78d6',
  g30: '#c13b7a',
  g60: '#eb6834',
  g120: '#8a63d2',
  'intra-refresh': '#1baf7a',
}
export const MODE_PERIOD_NOMINAL = { g30: 30, g60: 60, g120: 120 }

export const loadSubject = (sid) =>
  once(`s${sid}`, async () => {
    const o = await json(`subjects/s${sid}.json`)
    const conds = {}
    for (const [k, c] of Object.entries(o.conds)) {
      conds[k] = {
        rgb: Float64Array.from(c.rgb),
        isI: c.isI ?? [],
        qroi: c.qroi ? Float64Array.from(c.qroi) : null,
        qmean: c.qmean ? Float64Array.from(c.qmean) : null,
        bvpPhase: c.bvp_phase ? Float64Array.from(c.bvp_phase) : null,
      }
    }
    return { ...o, ref: Float64Array.from(o.ref), conds }
  })

export const loadDamage = () =>
  once('damage', async () => {
    const o = await json('damage.json')
    return { ...o, rows: o.rows.map(([subject, cond, win, ref, pos, chrom, q]) => ({ subject, cond: o.conds[cond], win, ref, pos, chrom, q, err: Math.abs(pos - ref) })) }
  })

export const loadWindows = () =>
  once('windows', async () => {
    const o = await json('windows.json')
    return o.rows.map(([subject, mode, method, win, ref, pos, harm]) => ({ subject, mode, method, win, ref, pos, harm, err: Math.abs(pos - ref) }))
  })

/** Repeated re-encodes of subject 10 (data-build/encode_variance.py); null if that study has not been run. */
export const loadEncodeVariance = () => once('encvar', () => json('hero/encode-variance.json').catch(() => null))

/** Subject 10 at fixed QP (data-build stage `qp`). */
export const loadQp = () => once('qp', () => json('qp/qp.json'))

export const loadHeroMeta = () => once('view', () => json('hero/view.json'))

export const loadTiles = () =>
  once('tiles', async () => {
    const meta = await json('hero/tiles.json')
    const buf = await fetch(BASE + 'hero/tiles.f32').then((r) => r.arrayBuffer())
    return { ...meta, data: new Float32Array(buf) }
  })

// ---- derived signals (memoised; every one is cheap enough to compute on demand) ----

export const rgbOf = (s, cond) => s.conds[cond].rgb.subarray(0, s.usable * 3)
export const refBvp = (s) => once(`ref${s.sid}`, () => D.bandpass(s.ref.subarray(0, s.usable), s.ba))
export const pulse = (s, cond, method = 'pos') => once(`p${s.sid}-${cond}-${method}`, () => D.pulseSignal(rgbOf(s, cond), s.fps, s.ba, method))
export const windows = (s) => once(`w${s.sid}`, () => D.windowStarts(s.usable, s.fps))
export const refHr = (s) => once(`rh${s.sid}`, () => {
  const { wn, starts } = windows(s)
  const r = refBvp(s)
  return starts.map((a) => D.hrBpm(r.subarray(a, a + wn), s.fps))
})
export const hrTrack = (s, cond, method = 'pos') => once(`ht${s.sid}-${cond}-${method}`, () => {
  const { wn, starts } = windows(s)
  const p = pulse(s, cond, method)
  return starts.map((a) => D.hrBpm(p.subarray(a, a + wn), s.fps))
})

/** Period of the keyframe cycle in frames, from the real bitstream (null for a single keyframe). */
export const periodOf = (s, cond) => (s.conds[cond]?.isI ? D.keyframePeriod(s.conds[cond].isI) : null)

/** Share of windows whose HR sits within tol bpm of a keyframe harmonic, for pos and for the reference. */
export function harmonicShare(s, cond, tol = 1.5) {
  const period = periodOf(s, cond)
  if (!period) return null
  const harm = D.keyframeHarmonics(s.fps, period).map((h) => h.bpm)
  const near = (b) => harm.some((h) => Math.abs(b - h) <= tol)
  const pos = hrTrack(s, cond)
  const ref = refHr(s)
  return {
    period,
    pos: pos.filter(near).length / pos.length,
    chance: ref.filter(near).length / ref.length,
    n: pos.length,
  }
}

export const median = D.median

/** Tile pulse map: how well each tile's green wiggle follows the contact PPG (max |r| over small lags). */
export function tileMap(tiles, s) {
  return once('tilemap', () => {
    const { n, ny, nx } = tiles
    const ref = refBvp(s)
    const m = Math.min(n, ref.length)
    const maxLag = Math.round(0.3 * s.fps)
    const out = new Float64Array(ny * nx)
    const traces = []
    const r0 = ref.subarray(0, m)
    const rs = D.std(r0)
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      const g = new Float64Array(n)
      let mean = 0
      for (let i = 0; i < n; i++) { g[i] = tiles.data[((i * ny + ty) * nx + tx) * 3 + 1]; mean += g[i] }
      mean /= n
      for (let i = 0; i < n; i++) g[i] = g[i] / mean - 1
      const b = D.bandpass(g, s.ba)
      traces.push(b)
      const gs = D.std(b)
      let best = 0
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0, cnt = 0
        for (let i = Math.max(0, -lag); i < Math.min(m, m - lag); i++) { sum += b[i + lag] * r0[i]; cnt++ }
        const r = Math.abs(sum / cnt / (gs * rs + 1e-12))
        if (r > best) best = r
      }
      out[ty * nx + tx] = best
    }
    return { corr: out, traces }
  })
}
