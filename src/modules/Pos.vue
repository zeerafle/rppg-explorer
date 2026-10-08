<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import Stepper from '../components/Stepper.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadSubject, refBvp, rgbOf } from '../lib/data.js'

const s = await loadSubject(HERO)
const fps = s.fps
const L = D.windowLen(fps)
const rgb = rgbOf(s, 'source')
const ref0 = refBvp(s)

const step = ref(0)
const method = ref('pos')
const e = ref(Math.round(24 * fps))                    // window END frame
const t0 = computed(() => (e.value - L) / fps)
const proj = computed(() => D.projectWindow(rgb, e.value, L, method.value))
const xs = computed(() => Array.from({ length: L }, (_, i) => (e.value - L + i) / fps))

const win = (arr) => Array.from(arr)
const raw = computed(() => [0, 1, 2].map((c) => Array.from({ length: L }, (_, i) => rgb[(e.value - L + i) * 3 + c])))
const COL = ['#d64545', '#1baf7a', '#2a78d6']
const NAME = ['R', 'G', 'B']
const rawSeries = computed(() => raw.value.map((y, c) => ({ name: NAME[c] + ' (0-255)', color: COL[c], x: xs.value, y, width: 1.8 })))
const normSeries = computed(() => proj.value.norm.map((y, c) => ({ name: NAME[c] + ' ÷ its own mean', color: COL[c], x: xs.value, y: win(y), width: 1.8 })))
const projNames = computed(() => (method.value === 'pos' ? ['S₁ = G − B', 'S₂ = −2R + G + B'] : ['X = 3R − 2G', 'Y = 1.5R + G − 1.5B']))
const projSeries = computed(() => [
  { name: projNames.value[0], color: '#8a63d2', x: xs.value, y: win(proj.value.S0), width: 1.8 },
  { name: projNames.value[1], color: '#c13b7a', x: xs.value, y: win(proj.value.S1), width: 1.8 },
])
const sign = computed(() => (method.value === 'pos' ? '+' : '−'))
const hSeries = computed(() => [
  { name: 'Combined h (this window)', color: '#eb6834', x: xs.value, y: win(proj.value.h), width: 2.2 },
  { name: projNames.value[0], color: '#8a63d2', x: xs.value, y: win(proj.value.S0), width: 1, opacity: 0.45 },
])

// full pulse signals, all three recipes
const green = D.greenOnly(rgb, fps, s.ba)
const posSig = D.pos(rgb, fps, s.ba)
const chromSig = D.chrom(rgb, fps, s.ba)
const sig = computed(() => ({ pos: posSig, chrom: chromSig, green }[method.value === 'green' ? 'green' : method.value]))

const view0 = ref(16)
const compare = computed(() => {
  const a = Math.round(view0.value * fps), b = Math.round((view0.value + 12) * fps)
  const norm = (arr) => { const sub = arr.subarray(a, b); const k = 1 / D.std(sub); return Array.from(sub, (v) => v * k) }
  return [
    { name: method.value === 'pos' ? 'POS' : 'CHROM', color: '#eb6834', y: norm(sig.value), x0: view0.value, dx: 1 / fps, width: 2 },
    { name: 'Contact sensor', color: '#6b6a66', y: norm(ref0), x0: view0.value, dx: 1 / fps, dash: '4 3', width: 1.3 },
  ]
})
const corrAll = computed(() => {
  const m = Math.min(sig.value.length, ref0.length), lag = Math.round(0.3 * fps)
  const a = sig.value, sa = D.std(a), sr = D.std(ref0)
  let best = 0
  for (let l = -lag; l <= lag; l++) {
    let sum = 0, cnt = 0
    for (let i = Math.max(0, -l); i < Math.min(m, m - l); i++) { sum += a[i + l] * ref0[i]; cnt++ }
    best = Math.max(best, Math.abs(sum / cnt / (sa * sr)))
  }
  return best
})

// ---- the "why does POS work" experiment: add flicker on top of the REAL trace ----
const flick = ref(0.03)
const FLICK_HZ = 1.4
const t1 = ref(30)
const flickCmp = computed(() => {
  const a = Math.round(t1.value * fps), n = Math.round(10 * fps), pad = Math.round(2 * fps)
  const lo = Math.max(0, a - pad), hi = a + n + pad
  const seg = new Float64Array((hi - lo) * 3)
  for (let i = lo; i < hi; i++) {
    const g = 1 + flick.value * Math.sin(2 * Math.PI * FLICK_HZ * (i / fps))
    for (let c = 0; c < 3; c++) seg[(i - lo) * 3 + c] = rgb[i * 3 + c] * g
  }
  const gr = D.greenOnly(seg, fps, s.ba), po = D.pos(seg, fps, s.ba)
  const cut = (x) => x.subarray(a - lo, a - lo + n)
  const truth = D.hrBpm(ref0.subarray(a, a + n), fps)
  const hg = D.hrBpm(cut(gr), fps), hp = D.hrBpm(cut(po), fps)
  return { truth, hg, hp, g: cut(gr), p: cut(po) }
})

const STEPS = ['Raw window', 'Normalise', 'Project', 'Combine', 'Slide & add']
const T = {
  pos: { s1: 'S_1 = G_n - B_n', s2: 'S_2 = -2R_n + G_n + B_n', a: '\\alpha = \\dfrac{\\sigma(S_1)}{\\sigma(S_2)}', h: 'h = S_1 + \\alpha S_2' },
  chrom: { s1: 'X = 3R_n - 2G_n', s2: 'Y = 1.5R_n + G_n - 1.5B_n', a: '\\alpha = \\dfrac{\\sigma(X)}{\\sigma(Y)}', h: 'h = X - \\alpha Y' },
}
</script>

<template>
  <h1>From colour to pulse</h1>
  <p class="lede">The three traces mix the pulse with everything else that changes skin brightness: lighting, head movement, the camera's exposure. POS and CHROM are two small recipes that combine the channels so the pulse stays and most of the rest cancels. No learning involved, just a few lines of algebra on 1.6 second windows.</p>

  <div class="card">
    <div class="controls">
      <div class="seg" role="group" aria-label="Method">
        <button :class="{ on: method === 'pos' }" @click="method = 'pos'">POS (Wang 2016)</button>
        <button :class="{ on: method === 'chrom' }" @click="method = 'chrom'">CHROM (de Haan 2013)</button>
      </div>
      <label>Window position <input v-model.number="e" type="range" :min="L" :max="s.usable - 1" step="1" /> {{ t0.toFixed(1) }} to {{ (t0 + L / fps).toFixed(1) }} s</label>
    </div>
    <Stepper v-model="step" :steps="STEPS">
      <template #default="{ index }">
        <div v-if="index === 0">
          <h3>Take 1.6 seconds ({{ L }} frames) of raw colour</h3>
          <LineChart :series="rawSeries" :height="230" y-label="Pixel value" x-label="Time (s)" label="Raw window" />
          <p class="small muted">Red is bright, green and blue are dim, which is just skin tone. The pulse is a ripple of a fraction of a grey level, invisible at this scale. <span class="tag real">real data</span></p>
        </div>
        <div v-else-if="index === 1">
          <h3>Divide each channel by its own average</h3>
          <Tex block tex="C_n(t) = \dfrac{C(t)}{\overline{C}}, \quad C \in \{R, G, B\}" />
          <LineChart :series="normSeries" :height="230" y-label="Relative to window mean" x-label="Time (s)" label="Normalised window" />
          <p class="small muted">All three now hover around 1, so they share a scale. If the lighting brightens by 3 %, every channel moves by about 3 %; the pulse moves them by <em>different</em> amounts (green most). That difference is the clue.</p>
        </div>
        <div v-else-if="index === 2">
          <h3>Project onto two directions that cancel brightness</h3>
          <Tex block :tex="T[method].s1" /><Tex block :tex="T[method].s2" />
          <LineChart :series="projSeries" :height="230" y-label="Projection" x-label="Time (s)" label="Projections" />
          <p class="small muted">The weights in each line add to zero, so a change that moves R, G and B by the same fraction (lighting, distance) cancels. What survives is colour change that is <em>not</em> equal across channels: the pulse, plus noise.</p>
        </div>
        <div v-else-if="index === 3">
          <h3>Mix the two with a weight so noise cancels</h3>
          <Tex block :tex="T[method].a" /><Tex block :tex="T[method].h" />
          <div class="stats"><div class="stat"><b>{{ proj.alpha.toFixed(2) }}</b><span>α in this window</span></div></div>
          <LineChart :series="hSeries" :height="230" y-label="h" x-label="Time (s)" label="Combined" />
          <p class="small muted">α is picked per window so that the two projections have equal spread; adding S₂ with that weight cancels the part of S₁ that is not pulse. Subtract the window's mean and we have {{ L }} samples of pulse signal, {{ sign === '+' ? 'S₁ plus' : 'X minus' }} a scaled other projection.</p>
        </div>
        <div v-else>
          <h3>Slide the window one frame at a time and add the results</h3>
          <p class="small muted">Every frame is covered by about {{ L }} overlapping windows; summing their outputs is called overlap-add and averages out each window's mistakes. A band-pass filter (0.7 to 3 Hz) finishes the job.</p>
          <div class="controls"><label>View from <input v-model.number="view0" type="range" min="0" :max="Math.floor(s.usable / fps - 12)" step="1" /> {{ view0 }} s</label>
            <span class="stat"><b>{{ corrAll.toFixed(2) }}</b><span>|r| with contact sensor, whole minute</span></span></div>
          <LineChart :series="compare" :height="260" x-label="Time (s)" y-label="Normalised" label="Pulse signal against contact sensor" />
          <p class="small muted">Each peak is one heartbeat. Both curves are scaled to unit spread so shapes compare directly.</p>
        </div>
      </template>
    </Stepper>
  </div>

  <div class="card">
    <h3>Why does this beat "just use green"?</h3>
    <p class="small muted">Here we add a lighting flicker on top of the <b>real</b> recording: all three channels are multiplied by 1 + a·sin(2π·{{ FLICK_HZ }} Hz·t). <span class="tag illus">added by us</span> Raise the strength and compare the two methods in the same 10 s window.</p>
    <div class="controls">
      <label>Flicker strength <input v-model.number="flick" type="range" min="0" max="0.1" step="0.005" /> {{ (flick * 100).toFixed(1) }} %</label>
      <label>Window <input v-model.number="t1" type="range" min="2" :max="Math.floor(s.usable / fps - 14)" step="1" /> {{ t1 }} to {{ t1 + 10 }} s</label>
    </div>
    <div class="stats">
      <div class="stat"><b>{{ flickCmp.truth.toFixed(0) }} bpm</b><span>truth (contact sensor)</span></div>
      <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(flickCmp.hg - flickCmp.truth) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ flickCmp.hg.toFixed(0) }} bpm</b><span>green channel only</span></div>
      <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(flickCmp.hp - flickCmp.truth) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ flickCmp.hp.toFixed(0) }} bpm</b><span>POS</span></div>
    </div>
    <p class="small muted">Green-only reads the flicker as a heartbeat as soon as it is larger than the pulse (0.1 %). POS divides it out, because it moves all channels equally. This is the same trick that the keyframe artefact will defeat: a periodic change that is <em>not</em> equal across channels slips through POS.</p>
  </div>
</template>
