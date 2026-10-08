import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as D from '../src/lib/dsp.js'

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url)))
const subj = JSON.parse(readFileSync(new URL('../public/data/subjects/s10.json', import.meta.url)))
const { fps, usable } = subj
const rgbOf = (name) => Float64Array.from(subj.conds[name].rgb).subarray(0, usable * 3)
const close = (a, b, tol) => Math.abs(a - b) <= tol

describe('against the Python pipeline (subject 10, 800k)', () => {
  for (const name of ['source', 'long', 'g60']) {
    it(`POS ${name}`, () => {
      const g = golden.conds[name]
      const p = D.pos(rgbOf(name), fps, subj.ba)
      for (let i = 0; i < 40; i++) expect(close(p[i], g.pos_head[i], 1e-6)).toBe(true)
      for (let i = 0; i < 40; i++) expect(close(p[p.length - 40 + i], g.pos_tail[i], 1e-6)).toBe(true)
      expect(close(D.std(p), g.pos_std, 1e-8)).toBe(true)
    })
    it(`CHROM std ${name}`, () => {
      expect(close(D.std(D.chrom(rgbOf(name), fps, subj.ba)), golden.conds[name].chrom_std, 1e-8)).toBe(true)
    })
    it(`HR per window ${name}`, () => {
      const g = golden.conds[name]
      const p = D.pos(rgbOf(name), fps, subj.ba)
      const { wn, starts } = D.windowStarts(usable, fps)
      expect(wn).toBe(golden.wn)
      expect(starts).toEqual(golden.starts)
      starts.forEach((s, i) => expect(close(D.hrBpm(p.subarray(s, s + wn), fps), g.hr_pos[i], 1e-6)).toBe(true))
    })
  }
  it('reference HR per window', () => {
    const ref = D.bandpass(Float64Array.from(subj.ref), subj.ba)
    golden.starts.forEach((s, i) => expect(close(D.hrBpm(ref.subarray(s, s + golden.wn), fps), golden.hr_ref[i], 1e-6)).toBe(true))
  })
  it('spectrum shape', () => {
    const p = D.pos(rgbOf('g60'), fps, subj.ba)
    const { f, p: pw } = D.spectrum(p.subarray(0, golden.wn), fps)
    let mx = 0
    for (const v of pw) mx = Math.max(mx, v)
    golden.spec_g60_first.f.forEach((fv, i) => {
      expect(close(f[i * 200], fv, 1e-9)).toBe(true)
      expect(close(pw[i * 200] / mx, golden.spec_g60_first.p[i], 1e-6)).toBe(true)
    })
  })
})

describe('helpers', () => {
  it('keyframe harmonics fall on multiples of fps/period', () => {
    const h = D.keyframeHarmonics(30, 60)               // 0.5 Hz fundamental
    expect(h.map((x) => x.k)).toEqual([2, 3, 4, 5, 6])  // 1x = 30 bpm is below the 42 bpm floor
    expect(h[0].bpm).toBeCloseTo(60, 6)
    expect(h.at(-1).bpm).toBeCloseTo(180, 6)
  })
  it('keyframe period is the median gap, null for a single keyframe', () => {
    expect(D.keyframePeriod([0, 60, 120, 180, 241])).toBe(60)
    expect(D.keyframePeriod([0])).toBeNull()
    expect(D.keyframePeriod([0, 60])).toBeNull()
  })
  it('folding recovers a repeating ramp and removes each cycle mean', () => {
    const P = 10, x = new Float64Array(50)
    for (let i = 0; i < 50; i++) x[i] = (i % P) + 100 * Math.floor(i / P)    // ramp + a different offset per cycle
    const { mean, sd, cycles } = D.foldCycles(x, [0, 10, 20, 30, 40], P)
    expect(cycles).toBe(5)
    expect(mean[0]).toBeCloseTo(-4.5, 9)
    expect(mean[9]).toBeCloseTo(4.5, 9)
    expect(Math.max(...sd)).toBeLessThan(1e-9)
  })
  it('lfilterZi gives a constant output for a constant input', () => {
    const { ba } = subj
    const y = D.lfilter(ba.b, ba.a, new Float64Array(200).fill(3), D.lfilterZi(ba.b, ba.a).map((z) => z * 3))
    expect(Math.abs(y[199] - y[0])).toBeLessThan(1e-9)
  })
  it('spectrum peak lands on a pure tone', () => {
    const fps = 30, x = Float64Array.from({ length: 300 }, (_, i) => Math.sin(2 * Math.PI * 1.5 * i / fps))
    expect(D.hrBpm(x, fps)).toBeCloseTo(90, 1)
  })
})

describe('teaching filter', () => {
  const fs = 30, n = 600
  const tone = (f) => Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / fs))
  const rms = (x) => D.std(x.subarray(150, 450))
  it('passes in-band, removes drift and high frequencies', () => {
    expect(rms(D.filterBand(tone(1.5), fs, 0.7, 3))).toBeGreaterThan(0.6)
    expect(rms(D.filterBand(tone(0.1), fs, 0.7, 3))).toBeLessThan(0.05)
    expect(rms(D.filterBand(tone(7), fs, 0.7, 3))).toBeLessThan(0.1)
  })
  it('lo = 0 and hi >= Nyquist leave the signal alone', () => {
    const x = tone(1.5), y = D.filterBand(x, fs, 0, 20)
    expect(Math.abs(y[100] - x[100])).toBeLessThan(1e-12)
  })
})
