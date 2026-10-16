<script setup>
// "Fitting a repeating pattern": the idea behind phase regression on a made-up signal you control.
// Pulse + a keyframe pattern + noise, folded by phase, fitted with K sine/cosine pairs, subtracted.
import { computed, ref } from 'vue'
import CategoryBars from '../components/CategoryBars.vue'
import LineChart from '../components/LineChart.vue'
import PhaseClock from '../components/PhaseClock.vue'
import Scatter from '../components/Scatter.vue'
import Stepper from '../components/Stepper.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { gauss } from '../lib/synth.js'

const FS = 30, SECS = 60, N = FS * SECS
const ART = '#eb6834', PUL = '#2a78d6', FIT = '#1baf7a', GREY = '#9a9892'

const step = ref(0)
const hr = ref(84), period = ref(60), height = ref(1.5), noise = ref(0.6), K = ref(6)
const PERIODS = [[30, '1 s'], [60, '2 s'], [120, '4 s']]
const NOISE = gauss(N, 7)

// ---- the made-up signal (every part kept separately so each step can show what is inside) ----
const keyIdx = computed(() => Array.from({ length: Math.ceil(N / period.value) }, (_, i) => i * period.value))
const phase = computed(() => D.gopPhase(keyIdx.value, N))
const shape = (p) => Math.exp(-5 * p)                       // jump at the keyframe, relaxing over the cycle
const pulseAt = (i, bpm, ph0 = 0.7) => Math.sin(2 * Math.PI * (bpm / 60) * (i / FS) + ph0)
const pulse = computed(() => Float64Array.from({ length: N }, (_, i) => pulseAt(i, hr.value)))
const art = computed(() => Float64Array.from({ length: N }, (_, i) => height.value * shape(phase.value[i])))
const noiseV = computed(() => Float64Array.from(NOISE, (v) => noise.value * v))
const demean = (x) => { const m = D.mean(x); return x.map((v) => v - m) }
const sig = computed(() => demean(Float64Array.from({ length: N }, (_, i) => pulse.value[i] + art.value[i] + noiseV.value[i])))
const clean = computed(() => demean(Float64Array.from({ length: N }, (_, i) => pulse.value[i] + noiseV.value[i])))
const artZ = computed(() => demean(art.value))

const T = (i) => i / FS
const tick = computed(() => keyIdx.value.map((i) => ({ x: T(i), color: ART, opacity: 0.55 })))

// ---- step 1: every frame has a phase ----
const t1 = ref(7.3)
const i1 = computed(() => Math.min(N - 1, Math.round(t1.value * FS)))
const w1 = computed(() => [{ name: 'Face colour (made up)', color: '#6b6a66', y: sig.value.subarray(0, 12 * FS), x0: 0, dx: 1 / FS, width: 1.8 }])
const w1p = computed(() => [{ name: 'Phase', color: ART, y: phase.value.subarray(0, 12 * FS), x0: 0, dx: 1 / FS, width: 2, step: true }])

// ---- step 2: fold ----
const cycles = ref(3)
const maxCycles = computed(() => Math.floor(N / period.value))
const showClean = ref(false)
const BINS = 40
const pts = computed(() => {
  const src = showClean.value ? clean.value : sig.value
  const last = Math.min(N, cycles.value * period.value)
  const out = []
  for (let i = 0; i < last; i++) out.push({ x: phase.value[i], y: src[i], color: GREY })
  return out
})
const binMean = (src, last) => {
  const s = new Float64Array(BINS), c = new Float64Array(BINS)
  for (let i = 0; i < last; i++) { const b = Math.min(BINS - 1, Math.floor(phase.value[i] * BINS)); s[b] += src[i]; c[b]++ }
  return Array.from(s, (v, b) => (c[b] ? v / c[b] : 0))
}
const binPts = computed(() => binMean(showClean.value ? clean.value : sig.value, Math.min(N, cycles.value * period.value)).map((y, b) => ({ x: (b + 0.5) / BINS, y, color: showClean.value ? PUL : ART, title: `phase ${((b + 0.5) / BINS).toFixed(2)}, average ${y.toFixed(2)}` })))
const foldPts = computed(() => [...pts.value, ...binPts.value])
const ys = computed(() => { const m = Math.max(...sig.value.map(Math.abs)); return [-Math.ceil(m), Math.ceil(m)] })

// ---- step 3: fit K sine/cosine pairs ----
const cols = computed(() => D.phaseBasis(phase.value, K.value))
const beta = computed(() => D.lstsq(cols.value, sig.value))
const GRID = 200
const curve = (b, k) => Array.from({ length: GRID + 1 }, (_, g) => {
  let v = 0; const p = g / GRID
  for (let j = 0; j < k; j++) v += b[2 * j] * Math.sin(2 * Math.PI * (j + 1) * p) + b[2 * j + 1] * Math.cos(2 * Math.PI * (j + 1) * p)
  return v
})
const xs = Array.from({ length: GRID + 1 }, (_, g) => g / GRID)
const truthCurve = computed(() => { const m = D.mean(art.value); return xs.map((p) => height.value * shape(p) - m) })
const fitCurve = computed(() => curve(beta.value, K.value))
const fitSeries = computed(() => [
  { name: 'True keyframe pattern', color: ART, x: xs, y: truthCurve.value, dash: '5 3', width: 1.8 },
  { name: `Fit with ${K.value} pair${K.value > 1 ? 's' : ''}`, color: FIT, x: xs, y: fitCurve.value, width: 2.6 },
])
const fitErr = computed(() => Math.sqrt(D.mean(Float64Array.from(fitCurve.value, (v, g) => (v - truthCurve.value[g]) ** 2))))
const sizes = computed(() => Array.from({ length: K.value }, (_, j) => ({ label: `${j + 1}× (${(j + 1) * 60 * FS / period.value} bpm)`, value: Math.hypot(beta.value[2 * j], beta.value[2 * j + 1]), color: FIT })))

// ---- step 4: subtract ----
const fitted = computed(() => { const f = new Float64Array(N); cols.value.forEach((c, j) => { for (let i = 0; i < N; i++) f[i] += beta.value[j] * c[i] }); return f })
const after = computed(() => sig.value.map((v, i) => v - fitted.value[i]))
const w4 = ref(2)
const WN = 10 * FS
const a4 = computed(() => w4.value * 5 * FS)
const teeth = computed(() => D.keyframeHarmonics(FS, period.value))
const specOf = (x) => D.spectrum(x.subarray(a4.value, a4.value + WN), FS, { range: [0.7, 3] })
const sB = computed(() => specOf(sig.value)), sA = computed(() => specOf(after.value))
const mx4 = computed(() => Math.max(...sB.value.p, ...sA.value.p))
const spec4 = computed(() => [
  { name: 'Before', color: ART, x: Array.from(sB.value.f, (v) => v * 60), y: Array.from(sB.value.p, (v) => v / mx4.value), width: 1.8, opacity: 0.55 },
  { name: 'After subtracting the fit', color: FIT, x: Array.from(sA.value.f, (v) => v * 60), y: Array.from(sA.value.p, (v) => v / mx4.value), width: 2.4 },
])
const peakB = computed(() => D.peakBpm(sB.value)), peakA = computed(() => D.peakBpm(sA.value))
const marks4 = computed(() => [...teeth.value.map((t) => ({ x: t.bpm, color: ART, dash: '2 3', opacity: 0.55 })), { x: hr.value, label: `truth ${hr.value}`, color: '#0b0b0b', dash: '5 2' }])

// how much of a pure pulse at each heart rate does the fit swallow?
const HRS = Array.from({ length: 70 }, (_, i) => 42 + 2 * i)
const lost = computed(() => {
  const c = D.phaseBasis(phase.value, K.value)
  return HRS.map((bpm) => {
    let frac = 0
    for (const ph0 of [0, Math.PI / 2]) {
      const y = demean(Float64Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * (bpm / 60) * (i / FS) + ph0)))
      const b = D.lstsq(c, y)
      let num = 0, den = 0
      for (let i = 0; i < N; i++) { let f = 0; for (let j = 0; j < c.length; j++) f += b[j] * c[j][i]; num += f * f; den += y[i] * y[i] }
      frac += num / den / 2
    }
    return frac * 100
  })
})
const lostSeries = computed(() => [{ name: 'Pulse power removed by the fit', color: '#c13b7a', x: HRS, y: lost.value, width: 2.2 }])
const lostHere = computed(() => lost.value[Math.max(0, Math.min(HRS.length - 1, Math.round((hr.value - 42) / 2)))])
const marks4b = computed(() => [...teeth.value.map((t) => ({ x: t.bpm, color: ART, dash: '2 3', opacity: 0.55 })), { x: hr.value, label: 'this pulse', color: '#0b0b0b', dash: '5 2' }])

const STEPS = ['Phase', 'Fold', 'Fit', 'Subtract']
</script>

<template>
  <h1>Fitting a repeating pattern</h1>
  <p class="lede">The keyframe artefact repeats in every cycle; the pulse does not. That difference is enough to separate them. This module shows the idea on a signal we make up, so every part is known and you can turn each one up or down. The next module does the same on real recordings. <span class="tag illus">illustration</span></p>

  <div class="card sticky">
    <div class="controls">
      <label>Pulse <input v-model.number="hr" type="range" min="45" max="175" step="1" /> <b>{{ hr }} bpm</b></label>
      <label>Keyframe every <span class="seg"><button v-for="[p, l] in PERIODS" :key="p" :class="{ on: period === p }" @click="period = p">{{ l }}</button></span></label>
      <label>Pattern height <input v-model.number="height" type="range" min="0" max="3" step="0.1" /> <b>{{ height.toFixed(1) }}</b></label>
      <label>Noise <input v-model.number="noise" type="range" min="0" max="1.5" step="0.1" /> <b>{{ noise.toFixed(1) }}</b></label>
    </div>
  </div>

  <Stepper v-model="step" :steps="STEPS">
    <template #default="{ index }">
      <div v-if="index === 0" class="card">
        <h3>1. Every frame knows where it is in its cycle</h3>
        <p class="small muted">The video file tells the decoder which frames are keyframes. From that, each frame gets a <b>phase</b>: 0 at a keyframe, climbing steadily towards 1 just before the next one, then back to 0. Drag the time to see one frame's phase on the clock.</p>
        <LineChart :series="w1" :markers="tick" :playhead="t1" scrub :x-domain="[0, 12]" :height="170" x-label="Time (s)" y-label="Face colour (made up)" label="Made-up face colour" @scrub="(x) => (t1 = Math.max(0, Math.min(12, x)))" />
        <LineChart :series="w1p" :markers="tick" :playhead="t1" scrub :x-domain="[0, 12]" :y-domain="[0, 1.05]" :height="130" x-label="Time (s)" y-label="Phase" label="Phase of each frame" @scrub="(x) => (t1 = Math.max(0, Math.min(12, x)))" />
        <div class="row">
          <PhaseClock :phase="phase[i1]" :size="130" :color="ART" />
          <div class="small">At <b>{{ t1.toFixed(1) }} s</b> this frame is number {{ i1 }}. The last keyframe was {{ (i1 - Math.max(...keyIdx.filter((k) => k <= i1))) }} frames ago and the cycle is {{ period }} frames long, so its phase is {{ (i1 - Math.max(...keyIdx.filter((k) => k <= i1))) }} / {{ period }} = <b>{{ phase[i1].toFixed(2) }}</b>. Nothing about the picture is needed, only the frame types.</div>
        </div>
      </div>

      <div v-else-if="index === 1" class="card">
        <h3>2. Fold: stack every cycle on top of the others</h3>
        <p class="small muted">Each dot is one frame, placed by its phase (left to right = through the cycle) and its colour value. Alone, one cycle looks like noise. Add cycles and the average per phase (coloured dots) settles onto the repeating pattern, because the pulse and noise point up as often as down.</p>
        <div class="controls">
          <label>Cycles stacked <input v-model.number="cycles" type="range" min="1" :max="maxCycles" step="1" /> <b>{{ cycles }}</b> of {{ maxCycles }}</label>
          <label><input v-model="showClean" type="checkbox" /> Remove the keyframe pattern (pulse + noise only)</label>
        </div>
        <Scatter :points="foldPts" :diagonal="false" :x-domain="[0, 1]" :y-domain="ys" :height="300" x-label="Phase (0 = keyframe, 1 = next keyframe)" y-label="Colour value (made up)" label="Frames folded by phase" />
        <div class="callout">
          <strong>Try it.</strong> With 1 cycle the average is jagged. With all {{ maxCycles }} it is smooth. Tick the box and the average goes flat: with no repeating pattern there is nothing for the fold to find. The <i>pulse</i> is not locked to the keyframes, so it cancels; this is why the heartbeat survives the fit. (When the pulse <i>is</i> locked to them, it does not cancel. Step 4.)
        </div>
      </div>

      <div v-else-if="index === 2" class="card">
        <h3>3. Describe the average shape with a few waves</h3>
        <p class="small muted">The fold gives the shape only at a few dozen points. We want a smooth formula for it, so we write it as a sum of sine and cosine waves that fit exactly once into a cycle (1×), twice (2×), and so on up to K×. The computer chooses how much of each wave to add so that the sum is as close as possible to the dots: <b>least squares</b>.</p>
        <p><Tex block tex="y_t \;\approx\; \sum_{k=1}^{K} a_k \sin(2\pi k\,\varphi_t) + b_k \cos(2\pi k\,\varphi_t)" /></p>
        <p class="small muted">In words: the colour at frame <i>t</i> is the sum of K sine-and-cosine pairs of its phase φ<sub>t</sub>. The weights a<sub>k</sub>, b<sub>k</sub> are found by minimising the squared gap to all {{ N }} frames at once. The thesis uses K = 6.</p>
        <div class="controls"><label>Pairs of waves, K <input v-model.number="K" type="range" min="1" max="12" step="1" /> <b>{{ K }}</b></label></div>
        <LineChart :series="fitSeries" :x-domain="[0, 1]" :height="250" x-label="Phase" y-label="Colour value" label="Fitted keyframe pattern" />
        <div class="stats">
          <div class="stat"><b>{{ fitErr.toFixed(2) }}</b><span>average gap between fit and true pattern</span></div>
          <div class="stat"><b>{{ 2 * K }}</b><span>numbers the fit has to learn</span></div>
        </div>
        <h4>How much of each wave</h4>
        <CategoryBars :items="sizes" :decimals="2" />
        <div class="callout warn">
          <strong>Too few, too many.</strong> K = 1 is a smooth hump and misses the sharp jump at phase 0. A few more waves capture it. Raise K and the gap shrinks until the extra waves mostly follow noise (watch the curve wiggle around the dashed line). Fewer numbers to learn also means less chance of fitting something that is not the artefact.
        </div>
      </div>

      <div v-else class="card">
        <h3>4. Subtract the fit, and the one thing that can go wrong</h3>
        <p class="small muted">Take the fitted pattern away from every frame. The repeating jumps go, and the heartbeat is left. One 10 s window of the made-up signal, as the heart-rate algorithm sees it:</p>
        <div class="controls"><label>Window <input v-model.number="w4" type="range" min="0" :max="Math.floor((N - WN) / (5 * FS))" step="1" /> {{ a4 / FS }} to {{ a4 / FS + 10 }} s</label></div>
        <LineChart :series="spec4" :markers="marks4" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :height="250" x-label="Heart rate (bpm)" y-label="Power (shared scale)" label="Spectrum before and after subtracting the fit" />
        <div class="stats">
          <div class="stat"><b>{{ hr }}</b><span>truth (bpm)</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(peakB - hr) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ peakB.toFixed(0) }}</b><span>before</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(peakA - hr) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ peakA.toFixed(0) }}</b><span>after</span></div>
        </div>
        <p class="small muted">Dotted lines are the keyframe teeth. Turn the pattern height up and the "before" peak moves to a tooth; the fit puts it back.</p>

        <h3>What if the pulse is on a tooth?</h3>
        <p class="small muted">The fit cannot tell a repeating <i>artefact</i> from a pulse that happens to repeat at the same rate. For every heart rate, we build a pure pulse, fit the same waves to it, and ask how much of it the fit swallows.</p>
        <LineChart :series="lostSeries" :markers="marks4b" :x-domain="[42, 180]" :y-domain="[0, 100]" :height="220" x-label="Heart rate (bpm)" y-label="Pulse power removed (%)" label="Pulse removed by the fit, by heart rate" />
        <div class="stats">
          <div class="stat" :style="{ borderLeft: `4px solid ${lostHere > 20 ? 'var(--red)' : 'var(--green)'}` }"><b>{{ lostHere.toFixed(0) }} %</b><span>of a {{ hr }} bpm pulse removed</span></div>
        </div>
        <div class="callout warn">
          <strong>Our reading, not yet tested on real data.</strong> Almost everywhere the fit leaves the pulse alone (near 0 %). At the teeth it removes most of it. On the made-up signal that is exact; on real recordings it predicts why 1 s keyframes (teeth every 30 bpm, so many heart rates sit near one) are harder than 2 s keyframes. Drag the pulse slider onto a dotted line and watch the "after" spectrum lose its peak in the step above.
        </div>
      </div>
    </template>
  </Stepper>
</template>

<style scoped>
.sticky { position: sticky; top: 49px; z-index: 3; margin-bottom: 14px; }
@media (max-height: 820px) { .sticky { position: static; } }
.row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.row > .small { flex: 1; min-width: 220px; }
</style>
