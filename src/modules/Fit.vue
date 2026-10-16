<script setup>
// "Fitting a repeating pattern": the idea behind phase regression on a made-up signal you control.
// Pulse + a keyframe pattern + noise: phase, fold, fit K sine/cosine pairs, subtract, read the heart rate.
import { computed, ref } from 'vue'
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
// One dot per frame: x = its phase (how far through its cycle it is), y = its colour value.
// Frame j of every cycle has the same phase j/period, so those frames land in one vertical column.
const cycles = ref(1)
const maxCycles = computed(() => Math.floor(N / period.value))
const showClean = ref(false)
const span = computed(() => Math.min(N, cycles.value * period.value))
const pick = ref(Math.round(0.25 * 60))
const pk = computed(() => Math.min(pick.value, span.value - 1))
const pkCycle = computed(() => Math.floor(pk.value / period.value))
const pkPos = computed(() => pk.value % period.value)
const src2 = computed(() => (showClean.value ? clean.value : sig.value))
const hue = (c) => `hsl(${(170 + c * 67) % 360} 50% 50%)`
const avg = computed(() => {
  const s = new Float64Array(period.value)
  for (let i = 0; i < span.value; i++) s[i % period.value] += src2.value[i]
  return Array.from(s, (v) => v / cycles.value)
})
const foldPts = computed(() => {
  const out = []
  for (let i = 0; i < span.value; i++) {
    const c = Math.floor(i / period.value)
    out.push({ x: phase.value[i], y: src2.value[i], color: hue(c), opacity: 0.55, title: `frame ${i} (cycle ${c + 1}), phase ${phase.value[i].toFixed(2)}, value ${src2.value[i].toFixed(2)}` })
  }
  avg.value.forEach((y, j) => out.push({ x: j / period.value, y, color: showClean.value ? PUL : ART, r: 4.2, opacity: 1, title: `average of the ${cycles.value} frame(s) at phase ${(j / period.value).toFixed(2)}: ${y.toFixed(2)}` }))
  out.push({ x: phase.value[pk.value], y: src2.value[pk.value], color: hue(pkCycle.value), r: 8, opacity: 1, stroke: 'var(--ink)', title: `frame ${pk.value}` })
  return out
})
const time2 = computed(() => [{ name: showClean.value ? 'Pulse + noise only' : 'Face colour (made up)', color: '#6b6a66', y: src2.value.subarray(0, span.value), x0: 0, dx: 1 / FS, width: 1.6 }])
const bands2 = computed(() => Array.from({ length: cycles.value }, (_, c) => ({ x0: (c * period.value) / FS, x1: ((c + 1) * period.value) / FS, color: hue(c), label: cycles.value <= 6 ? `cycle ${c + 1}` : undefined })))
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
const fitErr = computed(() => Math.sqrt(D.mean(Float64Array.from(fitCurve.value, (v, g) => (v - truthCurve.value[g]) ** 2))))
// what step 2 measured, over all cycles: one average per position in the cycle
const avgAll = computed(() => {
  const P = period.value, s = new Float64Array(P), c = Math.floor(N / P)
  for (let i = 0; i < c * P; i++) s[i % P] += sig.value[i]
  return Array.from(s, (v) => v / c)
})
const avgPts = computed(() => avgAll.value.map((y, j) => ({ x: j / period.value, y, color: ART, r: 3.4, opacity: 0.9, title: `average at phase ${(j / period.value).toFixed(2)}: ${y.toFixed(2)}` })))
const y3 = computed(() => { const m = Math.max(...avgAll.value.map(Math.abs), ...truthCurve.value.map(Math.abs)); const r = Math.ceil(m * 1.15 * 2) / 2 || 1; return [-r, r] })
const showBuild = ref(false)
const curves3 = computed(() => [
  { x: xs, y: truthCurve.value, color: '#6b6a66', dash: '5 3', width: 1.8 },
  ...(showBuild.value ? Array.from({ length: K.value - 1 }, (_, k) => ({ x: xs, y: curve(beta.value, k + 1), color: FIT, width: 1, opacity: 0.35 })) : []),
  { x: xs, y: fitCurve.value, color: FIT, width: 2.8 },
])
const waveK = ref(2)
const wk = computed(() => Math.min(waveK.value, K.value))
const sinPart = computed(() => xs.map((p) => beta.value[2 * (wk.value - 1)] * Math.sin(2 * Math.PI * wk.value * p)))
const cosPart = computed(() => xs.map((p) => beta.value[2 * (wk.value - 1) + 1] * Math.cos(2 * Math.PI * wk.value * p)))
const waveSeries = computed(() => [
  { name: 'a × sine', color: '#2a78d6', x: xs, y: sinPart.value, width: 1.6, dash: '4 3' },
  { name: 'b × cosine', color: '#c13b7a', x: xs, y: cosPart.value, width: 1.6, dash: '4 3' },
  { name: 'Their sum: this wave', color: FIT, x: xs, y: sinPart.value.map((v, i) => v + cosPart.value[i]), width: 2.8 },
])
const wkBpm = computed(() => (wk.value * 60 * FS) / period.value)
const rows = computed(() => Array.from({ length: 12 }, (_, i) => {
  const k = i + 1, bpm = (k * 60 * FS) / period.value, used = k <= K.value
  return { k, bpm, used, w: used ? Math.hypot(beta.value[2 * i], beta.value[2 * i + 1]) : 0, band: bpm < 42 ? 'below' : bpm > 180 ? 'above' : 'in' }
}))
const wmax = computed(() => Math.max(...rows.value.map((r) => r.w), 1e-9))
const covered = computed(() => teeth.value.filter((t) => t.k <= K.value).length)

// ---- step 4: subtract, in time ----
const subCyc = ref(1)
const s4 = computed(() => Math.min(subCyc.value, Math.max(0, maxCycles.value - 3)) * period.value)
const L4 = computed(() => 3 * period.value)
const subPick = ref(62)
const fp = computed(() => Math.min(Math.max(subPick.value, s4.value), s4.value + L4.value - 1))
const seg4 = (x) => x.subarray(s4.value, s4.value + L4.value)
const line4 = (name, color, y, extra = {}) => ({ name, color, y: seg4(y), x0: s4.value / FS, dx: 1 / FS, width: 1.6, ...extra })
const sub4 = computed(() => [line4('Face colour (made up)', '#6b6a66', sig.value), line4('Fitted pattern, repeated in every cycle', FIT, fitted.value, { width: 2.8 })])
const sub4b = computed(() => [line4('Pulse + noise we started with', PUL, clean.value, { dash: '4 3', width: 1.4 }), line4('After subtracting the curve', FIT, after.value, { width: 2.2 })])
const kmarks4 = computed(() => keyIdx.value.filter((i) => i >= s4.value && i < s4.value + L4.value).map((i) => ({ x: i / FS, color: ART, opacity: 0.55 })))
const rms = (x) => Math.sqrt(D.mean(Float64Array.from(x, (v) => v * v)))
const left4 = computed(() => ({ art: rms(artZ.value), left: rms(Float64Array.from({ length: N }, (_, i) => after.value[i] - clean.value[i])) }))
const ex = computed(() => ({ f: fp.value, cyc: Math.floor(fp.value / period.value) + 1, pos: fp.value % period.value, ph: phase.value[fp.value], v: sig.value[fp.value], c: fitted.value[fp.value], r: after.value[fp.value], next: fp.value + period.value < N ? fitted.value[fp.value + period.value] : null }))

// ---- step 5: heart rate ----
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

const STEPS = ['Phase', 'Fold', 'Fit a curve', 'Subtract', 'Heart rate']
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
        <h3>2. Fold: turn every frame into a dot, then stack the cycles</h3>
        <p class="small muted">Reminder from step 1: phase is not an on/off switch. It is a <b>ramp</b>: 0 on the keyframe, then {{ (1 / period).toFixed(3) }}, {{ (2 / period).toFixed(3) }}, … one small step per frame, reaching {{ ((period - 1) / period).toFixed(2) }} on the last frame before the next keyframe. So the phase says <i>how far through its cycle</i> a frame is.</p>

        <h4>a. Pick a frame in time</h4>
        <p class="small muted">The first {{ cycles }} cycle{{ cycles > 1 ? 's' : '' }} of the signal, each shaded in its own colour. Drag on the chart to pick a frame.</p>
        <LineChart :series="time2" :bands="bands2" :playhead="pk / FS" scrub :x-domain="[0, span / FS]" :height="170" x-label="Time (s)" y-label="Colour value" :legend="false" label="The cycles in time" @scrub="(x) => (pick = Math.max(0, Math.round(x * FS)))" />
        <div class="callout">
          <strong>How frame {{ pk }} becomes one dot.</strong> It is at {{ (pk / FS).toFixed(2) }} s, in cycle {{ pkCycle + 1 }}. The last keyframe was frame {{ pkCycle * period }}, so it is {{ pkPos }} frames into a {{ period }}-frame cycle: phase = {{ pkPos }} ÷ {{ period }} = <b>{{ (pkPos / period).toFixed(3) }}</b>. Its colour value is <b>{{ src2[pk].toFixed(2) }}</b>. So it is drawn at <b>x = {{ (pkPos / period).toFixed(3) }}, y = {{ src2[pk].toFixed(2) }}</b> (the big ringed dot below). Do this for every frame: x = phase, y = colour.
        </div>

        <h4>b. Every frame as a dot, placed by its phase</h4>
        <p class="small muted">Left to right is no longer time, it is the position inside the cycle. One cycle of {{ period }} frames gives {{ period }} dots spread from 0 to 1, the same shape as the shaded stretch above. A second cycle drops its {{ period }} dots on the <i>same</i> x positions, because its frame number {{ pkPos }} also has phase {{ (pkPos / period).toFixed(3) }}. That is the "stacking": the cycles are cut at the keyframes and laid on top of each other. Dot colour = which cycle it came from.</p>
        <div class="controls">
          <label>Cycles stacked <input v-model.number="cycles" type="range" min="1" :max="maxCycles" step="1" /> <b>{{ cycles }}</b> of {{ maxCycles }}</label>
          <label><input v-model="showClean" type="checkbox" /> Remove the keyframe pattern (pulse + noise only)</label>
        </div>
        <Scatter :points="foldPts" :diagonal="false" :x-domain="[0, 1]" :y-domain="ys" :height="300" x-label="Phase (0 = keyframe, 1 = next keyframe)" y-label="Colour value" label="Frames folded by phase" />

        <h4>c. The average at each phase</h4>
        <p class="small muted">The {{ showClean ? 'blue' : 'orange' }} dots: at each of the {{ period }} phase positions, the average of the frames stacked there. Each one averages <b>{{ cycles }}</b> frame{{ cycles > 1 ? 's' : '' }}.</p>
        <div v-if="cycles === 1" class="callout warn"><strong>With 1 cycle there is nothing to average yet.</strong> Each phase position holds exactly one frame, and the average of one number is that number, so the {{ showClean ? 'blue' : 'orange' }} dots sit right on the frame dots. It is just the first cycle, pulse and noise included. Move the slider to 2 and each position now averages two frames.</div>
        <div v-else class="callout"><strong>Why the pattern appears.</strong> The keyframe pattern has the same value at the same phase in every cycle, so averaging keeps it. The pulse is at {{ hr }} bpm, not in step with the {{ period / FS }} s cycle, so at a given phase it is up in some cycles and down in others, and averaging cancels it; so does the noise. With {{ cycles }} cycles the {{ showClean ? 'blue' : 'orange' }} dots are already {{ cycles >= 10 ? 'a smooth curve' : 'smoothing out' }}. Tick the box: with no pattern, the average goes flat.</div>
      </div>

      <div v-else-if="index === 2" class="card">
        <h3>3. Replace the dots with one smooth curve</h3>
        <p class="small muted"><b>Yes: this step finds the keyframe pattern.</b> The orange dots are what step 2 measured, the average colour at each of the {{ period }} positions in the cycle. They are a little jagged, because some pulse and noise survives the averaging. We want one smooth curve through them, written with a handful of numbers, because then the same curve can be used for <i>every</i> frame, including cycles a few frames longer or shorter than the rest.</p>
        <div class="controls">
          <label>Pairs of waves, K <input v-model.number="K" type="range" min="1" max="12" step="1" /> <b>{{ K }}</b></label>
          <label><input v-model="showBuild" type="checkbox" /> Show it being built up wave by wave</label>
        </div>
        <Scatter :points="avgPts" :curves="curves3" :diagonal="false" :x-domain="[0, 1]" :y-domain="y3" :height="290" x-label="Phase (0 = keyframe, 1 = next keyframe)" y-label="Colour value (0 = average of the cycle)" label="Averages by phase with the fitted curve" />
        <p class="small muted">Orange dots: the averages from step 2. <b style="color: var(--green)">Green</b>: the fitted curve. Dashed grey: the pattern we secretly put into this toy signal, so you can check the fit. A real recording gives you no dashed line.</p>
        <div class="stats">
          <div class="stat"><b>{{ fitErr.toFixed(2) }}</b><span>average gap between green and dashed</span></div>
          <div class="stat"><b>{{ 2 * K }}</b><span>numbers describe the curve</span></div>
        </div>
        <div class="callout">
          <strong>Why does it start high and fall below 0?</strong> Only because of how we built this toy: a jump at the keyframe that fades over the cycle, copied from what the real data show in <a href="#keyframe">module 6, step 2</a>. The vertical scale has 0 at the average colour of the whole cycle, so "below 0" just means darker than average. On a real recording we assume no shape at all: the curve is whatever the dots say (<a href="#phase">module 8, step 2</a>).
        </div>

        <h4>Why sines and cosines?</h4>
        <ul class="small muted">
          <li>The pattern repeats every cycle, so it can be built from waves that fit a whole number of times into one cycle: once (1×), twice (2×), and so on. That is the "ramp built from sine waves" idea from <a href="#keyframe">module 6, step 3</a>.</li>
          <li>A sine wave is always 0 at the keyframe, so alone it can never put a peak there. Adding a cosine of the same speed, which starts at its maximum, lets the pair peak anywhere in the cycle.</li>
          <li>Each pair is "a × sine + b × cosine", so the computer only has to choose two weights per speed. It picks all of them at once to make the curve as close as possible to the dots in the least-squares sense: the smallest total squared gap.</li>
        </ul>
        <p><Tex block tex="y_t \;\approx\; \sum_{k=1}^{K} a_k \sin(2\pi k\,\varphi_t) + b_k \cos(2\pi k\,\varphi_t)" /></p>
        <p class="small muted">In words: the pattern's value at phase φ is the sum of K pairs of waves. The green curve above is all {{ K }} pairs added together. Look at one pair:</p>
        <div class="controls"><label>Wave number <input v-model.number="waveK" type="range" min="1" :max="K" step="1" /> <b>{{ wk }}×</b></label></div>
        <LineChart :series="waveSeries" :x-domain="[0, 1]" :height="200" x-label="Phase" y-label="Contribution" label="One sine and cosine pair" />
        <p class="small muted">Wave {{ wk }}× fits {{ wk }} time{{ wk > 1 ? 's' : '' }} into the cycle, which is {{ wkBpm.toFixed(0) }} bpm. The fit chose a = {{ beta[2 * (wk - 1)].toFixed(2) }} for the sine and b = {{ beta[2 * (wk - 1) + 1].toFixed(2) }} for the cosine.</p>

        <h4>Why K = 6?</h4>
        <p class="small muted">Wave k runs at exactly k × the keyframe rate, which are the keyframe teeth from <a href="#keyframe">module 6</a>. Here is each wave for the current spacing, and whether it lands in the heart-rate band that POS searches:</p>
        <table class="t">
          <thead><tr><th>Wave</th><th>Speed (bpm)</th><th>In the 42–180 bpm band?</th><th>Weight</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.k" :style="{ opacity: r.used ? 1 : 0.38 }">
              <td>{{ r.k }}×</td><td>{{ r.bpm.toFixed(0) }}</td>
              <td>{{ r.band === 'in' ? '✅ a keyframe tooth' : r.band === 'below' ? 'below: slow drift' : 'above' }}</td>
              <td><template v-if="r.used"><span class="wbar" :style="{ width: (r.w / wmax) * 90 + 'px' }" /> {{ r.w.toFixed(2) }}</template><template v-else>not used</template></td>
            </tr>
          </tbody>
        </table>
        <div class="stats">
          <div class="stat" :style="{ borderLeft: `4px solid ${covered === teeth.length ? 'var(--green)' : 'var(--red)'}` }"><b>{{ covered }} of {{ teeth.length }}</b><span>keyframe teeth in the band that have a wave (K = {{ K }})</span></div>
        </div>
        <div class="callout warn">
          <strong>Honest answer: K = 6 is a setting, not a derived number.</strong> The thesis code uses 6 for every keyframe spacing and never compared other values. What the table suggests (our reading, not yet tested): at 2 s, wave 6× is 180 bpm, exactly the top of the band, so 6 is just enough to give every tooth a wave. At 1 s only waves 1 to 3 reach the band. At 4 s six waves stop at 90 bpm, so the teeth at 105 to 180 bpm have no wave; try the 4 s button above with K = 6. Too few waves miss the sharp jump at phase 0; many more start to follow noise, and every extra wave also gives the fit more freedom to swallow part of the pulse (step 5).
        </div>
      </div>

      <div v-else-if="index === 3" class="card">
        <h3>4. Use the curve to clean every frame</h3>
        <p class="small muted"><b>What is removed is the keyframe artefact's share of each frame.</b> Every frame has a phase, and the curve tells us how much the keyframe pushed the colour at that phase. So for every frame: look up its phase, read the curve there, subtract. Three cycles of the made-up signal, with keyframes marked in orange:</p>
        <div class="controls"><label>Start at cycle <input v-model.number="subCyc" type="range" min="0" :max="Math.max(0, maxCycles - 3)" step="1" /> <b>{{ s4 / period + 1 }}</b></label></div>
        <LineChart :series="sub4" :markers="kmarks4" :playhead="fp / FS" scrub :x-domain="[s4 / FS, (s4 + L4) / FS]" :height="190" x-label="Time (s)" y-label="Colour value" label="Signal and the fitted pattern repeated in every cycle" @scrub="(x) => (subPick = Math.round(x * FS))" />
        <p class="small muted">Grey: the face colour. <b style="color: var(--green)">Green</b>: the fitted curve from step 3, copied into every cycle because every cycle has the same phases. Drag on the chart to pick a frame.</p>
        <div class="callout">
          <strong>Frame {{ ex.f }}, worked through.</strong> It is {{ ex.pos }} frame{{ ex.pos === 1 ? '' : 's' }} after the keyframe of cycle {{ ex.cyc }}, in a {{ period }}-frame cycle, so its phase is {{ ex.pos }} ÷ {{ period }} = <b>{{ ex.ph.toFixed(3) }}</b>. The curve at that phase reads <b>{{ ex.c.toFixed(2) }}</b>: that much of this frame's colour is the keyframe artefact. Its colour value is {{ ex.v.toFixed(2) }}, so after subtracting it is {{ ex.v.toFixed(2) }} − ({{ ex.c.toFixed(2) }}) = <b>{{ ex.r.toFixed(2) }}</b>.<template v-if="ex.next !== null"> The same position in the next cycle has the same phase and loses the same amount ({{ ex.next.toFixed(2) }}), even though its colour value is different.</template>
        </div>
        <h4>What is left</h4>
        <LineChart :series="sub4b" :markers="kmarks4" :x-domain="[s4 / FS, (s4 + L4) / FS]" :height="190" x-label="Time (s)" y-label="Colour value" label="Signal after subtracting the curve, against pulse plus noise" />
        <p class="small muted">Green after the subtraction; dashed blue, the pulse and noise we put into the toy before adding any keyframe pattern. The orange jumps are gone and the two mostly agree; the gap that remains is the part of the pattern the curve missed (try raising K in step 3).</p>
        <div class="stats">
          <div class="stat"><b>{{ left4.art.toFixed(2) }}</b><span>size of the keyframe pattern (rms)</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${left4.left < 0.5 * left4.art ? 'var(--green)' : 'var(--red)'}` }"><b>{{ left4.left.toFixed(2) }}</b><span>what is left of it after subtracting (rms)</span></div>
        </div>
        <div class="callout warn">
          <strong>Not removed.</strong> What remains is the pulse and the noise, plus whatever part of the pattern the curve missed. The fit has no way to know which wiggles are "artefact" and which are "pulse"; it only knows what repeats in step with the keyframes. Step 5 shows when that goes wrong.
        </div>
      </div>

      <div v-else class="card">
        <h3>5. Read the heart rate, and the one thing that can go wrong</h3>
        <p class="small muted">The heart-rate algorithm takes the spectrum of 10 s of the cleaned signal and picks the tallest peak. Before and after the subtraction of step 4:</p>
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
          <strong>Our reading, not yet tested on real data.</strong> Almost everywhere the fit leaves the pulse alone (near 0 %). At the teeth it removes most of it. On the made-up signal that is exact; on real recordings it predicts why 1 s keyframes (teeth every 30 bpm, so many heart rates sit near one) are harder than 2 s keyframes. Drag the pulse slider onto a dotted line and watch the "after" spectrum lose its peak in the first chart.
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
.wbar { display: inline-block; height: 10px; background: var(--green); border-radius: 3px; vertical-align: middle; }
</style>
