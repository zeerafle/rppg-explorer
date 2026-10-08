<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadSubject, refBvp, refHr, windows } from '../lib/data.js'
import { SHAPES, times } from '../lib/synth.js'

const s = await loadSubject(HERO)
const fps = s.fps, wins = windows(s), ref0 = refBvp(s)
const rawG = (() => { const r = s.conds.source.rgb; let m = 0; for (let i = 0; i < s.usable; i++) m += r[i * 3 + 1]; m /= s.usable; return Float64Array.from({ length: s.usable }, (_, i) => r[i * 3 + 1] / m - 1) })()

// ---- 1. band-pass on the real trace ----
const lo = ref(0.7), hi = ref(3.0), wi = ref(5)
const filt = computed(() => D.filterBand(rawG, fps, lo.value, hi.value))
const full = computed(() => {
  const a = D.spectrum(rawG, fps, { range: [0.02, 5] }), b = D.spectrum(filt.value, fps, { range: [0.02, 5] })
  const m = Math.max(...a.p)
  return [
    { name: 'Raw trace', color: '#6b6a66', x: Array.from(a.f, (v) => v * 60), y: Array.from(a.p, (v) => Math.max(10 * Math.log10(v / m + 1e-12), -80)), width: 1.6 },
    { name: 'After band-pass', color: '#eb6834', x: Array.from(b.f, (v) => v * 60), y: Array.from(b.p, (v) => Math.max(10 * Math.log10(v / m + 1e-12), -80)), width: 2.2 },
  ]
})
const a0 = computed(() => wins.starts[wi.value])
const win = computed(() => {
  const n = wins.wn, x = filt.value.subarray(a0.value, a0.value + n), r = rawG.subarray(a0.value, a0.value + n)
  const k = D.std(ref0.subarray(a0.value, a0.value + n)) / (D.std(x) || 1)
  const z = (v) => { const m = D.mean(v); return Array.from(v, (q) => q - m) }
  return {
    hr: D.peakBpm(D.spectrum(x, fps, { range: [0.05, 6] })),
    series: [
      { name: 'Raw trace', color: '#6b6a66', y: z(r), x0: a0.value / fps, dx: 1 / fps, width: 1.4, opacity: 0.7 },
      { name: 'Filtered', color: '#eb6834', y: z(x), x0: a0.value / fps, dx: 1 / fps, width: 2.2 },
    ],
    filt: [
      { name: 'Filtered', color: '#eb6834', y: Array.from(x), x0: a0.value / fps, dx: 1 / fps, width: 2.2 },
      { name: 'Contact sensor (scaled)', color: '#6b6a66', y: Array.from(ref0.subarray(a0.value, a0.value + n), (v) => v / k), x0: a0.value / fps, dx: 1 / fps, dash: '4 3', width: 1.3 },
    ],
  }
})
const truth = computed(() => refHr(s)[wi.value])
const preset = (l, h) => { lo.value = l; hi.value = h }

// ---- 2. harmonics ----
const shape = ref('sawtooth'), Tp = ref(2)
const SF = 30
const sig2 = computed(() => SHAPES[shape.value](times(60 * SF, SF), Tp.value))
const sp2 = computed(() => D.spectrum(sig2.value, SF, { range: [0.05, 5] }))
const teeth = computed(() => D.keyframeHarmonics(1, Tp.value))
const comb = computed(() => { const m = Math.max(...sp2.value.p); return [{ name: 'Spectrum', color: '#8a63d2', x: Array.from(sp2.value.f, (v) => v * 60), y: Array.from(sp2.value.p, (v) => v / m), width: 2 }] })
const shown = computed(() => { const x = sig2.value; return [{ name: shape.value, color: '#8a63d2', y: Array.from(x.subarray(0, 12 * SF)), x0: 0, dx: 1 / SF, width: 2 }] })
const lines = computed(() => { const out = []; for (let k = 1; (60 * k) / Tp.value <= 300; k++) out.push({ x: (60 * k) / Tp.value, color: '#8a63d2', opacity: 0.4, label: k <= 6 ? `${k}×` : undefined }); return out })
</script>

<template>
  <h1>Filters and harmonics</h1>
  <p class="lede">Two ideas finish the toolkit. A filter keeps the frequencies you want and discards the rest; this is how a 0.1 % pulse is dug out from slow drift. Harmonics explain why a repeating <em>jump</em>, not just a repeating wave, floods the spectrum with false heart rates.</p>

  <div class="card">
    <h3>1. A band-pass filter on the real trace</h3>
    <div class="callout">
      <strong>In plain words.</strong> A <b>filter</b> is a tone control. Like turning down the bass and treble on a stereo, a <b>band-pass</b> filter keeps one range of speeds (the "band") and removes everything slower or faster. Here we keep 0.7 to 3 Hz, i.e. 42 to 180 beats per minute, which is where human heart rates live. What we throw away: slow drift (changing room light, the person swaying) below, and fast jitter and sensor noise above. <b>What to do:</b> press "No filtering" and see what the heart-rate box reads; then press "Pipeline" and compare. Without the filter the tallest peak is slow drift; with it the heart rate comes out right (about 0.5 bpm median error across the recording, against about 108 bpm unfiltered).
    </div>
    <p class="small muted">The raw green trace of subject {{ HERO }}, in decibels so small things are visible. Move the cut-offs. The pipeline uses 0.7 to 3 Hz (42 to 180 bpm). <span class="tag real">real data</span> <span class="tag illus">teaching filter</span></p>
    <div class="controls">
      <label>Low cut <input v-model.number="lo" type="range" min="0" max="2" step="0.05" /> <b>{{ lo.toFixed(2) }} Hz</b> <span class="muted">({{ (lo * 60).toFixed(0) }} bpm)</span></label>
      <label>High cut <input v-model.number="hi" type="range" min="1" max="6" step="0.1" /> <b>{{ hi.toFixed(1) }} Hz</b> <span class="muted">({{ (hi * 60).toFixed(0) }} bpm)</span></label>
    </div>
    <div class="controls">
      <button class="btn" @click="preset(0.7, 3)">Pipeline (0.7 to 3)</button>
      <button class="btn" @click="preset(0, 6)">No filtering</button>
      <button class="btn" @click="preset(0.05, 6)">Remove only the slowest drift</button>
      <button class="btn" @click="preset(1.5, 1.6)">Far too narrow</button>
    </div>
    <LineChart :series="full" :bands="[{ x0: lo * 60, x1: hi * 60, color: 'var(--green)' }]" :x-domain="[0, 300]" :y-domain="[-80, 3]" :height="240" x-label="Frequency (bpm)" y-label="Power (dB, whole minute)" label="Spectrum before and after filtering" />
    <div class="controls"><label>Window <input v-model.number="wi" type="range" min="0" :max="wins.starts.length - 1" step="1" /> {{ (a0 / fps).toFixed(0) }} to {{ (a0 / fps + wins.wn / fps).toFixed(0) }} s</label></div>
    <div class="row">
      <div><LineChart :series="win.series" :height="200" x-label="Time (s)" label="Raw against filtered" /></div>
      <div><LineChart :series="win.filt" :height="200" x-label="Time (s)" label="Filtered against contact sensor" /></div>
    </div>
    <div class="stats">
      <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(win.hr - truth) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ win.hr.toFixed(0) }} bpm</b><span>tallest peak anywhere from 3 to 360 bpm</span></div>
      <div class="stat"><b>{{ truth.toFixed(0) }} bpm</b><span>truth</span></div>
    </div>
    <div class="callout">
      <strong>Things to try.</strong> With "No filtering" the heart rate read from the trace is a few bpm (the slow wander of lighting and posture), because the loudest thing in the raw trace is drift. Removing only the very slowest drift (cut at 0.05 Hz) is not enough: on this recording the drift reaches up to roughly 0.25 Hz (15 bpm), so the estimate is still wrong. Only a cut near 0.7 Hz works. A band so narrow it holds just 90 to 96 bpm throws the pulse away except in windows where the heart rate happens to sit inside it. Choosing the band is a modelling decision, and the artefact in module 6 lives <em>inside</em> the allowed band, so no choice of band can remove it.
    </div>
  </div>

  <div class="card">
    <h3>2. A repeating shape is a family of waves</h3>
    <p class="small"><b>In plain words.</b> A plucked guitar string vibrates at its main pitch and also, more quietly, at 2×, 3×, 4× that pitch. Those extra pitches are <b>harmonics</b>. A perfectly smooth sine wave has none; any sharper repeating shape (a sudden jump, a spike) is built from the main frequency plus a whole ladder of harmonics, evenly spaced like the teeth of a comb. <b>What to do:</b> press "sine", then "sawtooth", and count the lines inside the green heart-rate band. <b>Takeaway:</b> a repeating jump in brightness is a sawtooth-like shape, so it puts many false "heart rates" into the band at once.</p>
    <p class="small muted">A sine contains one frequency. Any other repeating shape contains that frequency plus its multiples (harmonics): 2×, 3×, 4× and so on. Pick a shape and a period and read off the lines. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <div class="seg" role="group" aria-label="Shape"><button v-for="k in ['sine', 'triangle', 'sawtooth', 'pulses']" :key="k" :class="{ on: shape === k }" @click="shape = k">{{ k }}</button></div>
      <label>Repeats every <input v-model.number="Tp" type="range" min="0.5" max="4" step="0.1" /> <b>{{ Tp.toFixed(1) }} s</b> <span class="muted">(1× = {{ (60 / Tp).toFixed(1) }} bpm)</span></label>
    </div>
    <LineChart :series="shown" :height="160" :x-domain="[0, 12]" x-label="Time (s)" label="Repeating shape" />
    <LineChart :series="comb" :markers="lines" :bands="[{ x0: 42, x1: 180, color: 'var(--green)' }]" :x-domain="[0, 300]" :y-domain="[0, 1.1]" :height="220" x-label="Frequency (bpm)" y-label="Relative power" label="Harmonic comb" />
    <div class="stats">
      <div class="stat" :style="{ borderLeft: `4px solid ${teeth.length > 1 ? 'var(--red)' : 'var(--green)'}` }"><b>{{ teeth.length }}</b><span>harmonic{{ teeth.length === 1 ? '' : 's' }} inside the heart-rate band</span></div>
    </div>
    <div class="callout">
      <strong>The link to compression.</strong> A smooth sine gives one line. A sharp shape (sawtooth, pulses) gives many, with strengths that fall slowly. Triangle only has odd multiples. A keyframe every <em>T</em> seconds makes the face brightness jump on a regular beat, so its spectrum has lines at every multiple of 60 ÷ <em>T</em> bpm. Make the period 2 s and watch 60, 90, 120, 150, 180 light up inside the green band: exactly the comb seen in <a href="#keyframe">module 6</a>. A heart-rate estimator that picks the tallest peak in the band can land on any of them.
    </div>
  </div>
</template>
