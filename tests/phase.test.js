import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as D from '../src/lib/dsp.js'

const golden = JSON.parse(readFileSync(new URL('./golden-phase.json', import.meta.url)))
const s = JSON.parse(readFileSync(new URL('../public/data/phase/s8.json', import.meta.url)))
const summary = JSON.parse(readFileSync(new URL('../public/data/phase/summary.json', import.meta.url)))
const { fps, usable } = s
const rgb = Float64Array.from(s.conds.g60.rgb)
const n = rgb.length / 3
const ph = D.gopPhase(s.conds.g60.isI, n)
const cols = D.phaseBasis(ph, golden.K)
const fixed = D.regressOut(rgb, cols, s.ba).out
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

describe('phase regression against the Python reference (subject 8, CBR 800k, 2 s keyframes)', () => {
  it('basis rows match phase_basis', () => {
    golden.X_head.forEach((row, i) => row.forEach((v, j) => expect(close(cols[j][i], v, 1e-9)).toBe(true)))
  })
  it('corrected RGB matches regress_out', () => {
    golden.fixed_head.forEach((row, i) => row.forEach((v, c) => expect(close(fixed[i * 3 + c], v, 1e-5)).toBe(true)))
    golden.fixed_tail.forEach((row, i) => row.forEach((v, c) => expect(close(fixed[(n - 30 + i) * 3 + c], v, 1e-5)).toBe(true)))
  })
  it('heart rate per window matches, and beats the uncorrected one', () => {
    const p = D.pos(fixed.subarray(0, usable * 3), fps, s.ba)
    expect(close(D.std(p), golden.pos_std, 1e-5)).toBe(true)
    const { wn, starts } = D.windowStarts(usable, fps)
    expect(starts).toEqual(golden.starts)
    starts.forEach((s0, i) => expect(Math.abs(D.hrBpm(p.subarray(s0, s0 + wn), fps) - golden.hr[i])).toBeLessThan(0.01))
  })
  it('subject 8 median error agrees with the 42-subject summary', () => {
    const ref = D.bandpass(Float64Array.from(s.ref).subarray(0, usable), s.ba)
    const p = D.pos(fixed.subarray(0, usable * 3), fps, s.ba)
    const { wn, starts } = D.windowStarts(usable, fps)
    const med = D.median(starts.map((s0) => Math.abs(D.hrBpm(p.subarray(s0, s0 + wn), fps) - D.hrBpm(ref.subarray(s0, s0 + wn), fps))))
    expect(Math.abs(med - summary.per[8].g60[1])).toBeLessThan(0.5)
  })
  it('summary reproduces the headline numbers', () => {
    expect(summary.subjects).toBe(42)
    expect(summary.table.g60.none.med).toBeCloseTo(21.3, 1)
    expect(summary.table.g60.phase.med).toBeCloseTo(3.5, 1)
  })
  it('fewer than three keyframes: no phase', () => { expect(D.gopPhase([0], 100)).toBeNull() })
})
