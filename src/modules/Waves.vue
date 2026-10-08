<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadSubject, refBvp, refHr, windows } from '../lib/data.js'
import { add, sine, times } from '../lib/synth.js'

const s = await loadSubject(HERO)
const FS = 100, SPAN = 6
const t = times(SPAN * FS, FS)

const bpm1 = ref(72), amp1 = ref(1), ph1 = ref(0)
const bpm2 = ref(150), amp2 = ref(0.5), two = ref(false)
const f1 = computed(() => bpm1.value / 60)
const w1 = computed(() => sine(t, f1.value, amp1.value, (ph1.value * Math.PI) / 180))
const w2 = computed(() => sine(t, bpm2.value / 60, amp2.value, 0))
const wave = computed(() => [{ name: 'Wave 1', color: '#eb6834', y: w1.value, x0: 0, dx: 1 / FS, width: 2.4 }])
const peaks = computed(() => {
  const out = [], T = 1 / f1.value, t0 = (Math.PI / 2 - (ph1.value * Math.PI) / 180) / (2 * Math.PI * f1.value)
  for (let k = -1; t0 + k * T <= SPAN; k++) if (t0 + k * T >= 0) out.push(t0 + k * T)
  return out
})
const peakMarks = computed(() => peaks.value.map((x, i) => ({ x, color: '#eb6834', opacity: 0.5, label: i === 0 ? 'peak' : undefined })))
const sum = computed(() => [
  { name: 'Wave 1', color: '#eb6834', y: w1.value, x0: 0, dx: 1 / FS, width: 1.2, opacity: 0.5 },
  { name: 'Wave 2', color: '#2a78d6', y: w2.value, x0: 0, dx: 1 / FS, width: 1.2, opacity: 0.5 },
  { name: 'Sum', color: '#0b0b0b', y: add(w1.value, w2.value), x0: 0, dx: 1 / FS, width: 2.4 },
])

// ---- the real pulse, read as a wave ----
const wi = ref(5)
const wins = windows(s), ref0 = refBvp(s)
const a0 = computed(() => wins.starts[wi.value])
const seg = computed(() => ref0.subarray(a0.value, a0.value + Math.round(6 * s.fps)))
const real = computed(() => {
  const x = seg.value, mx = Math.max(...x), pk = []
  for (let i = 1; i < x.length - 1; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > 0.3 * mx) pk.push((a0.value + i) / s.fps)
  const gaps = pk.slice(1).map((v, i) => v - pk[i])
  const period = gaps.reduce((p, c) => p + c, 0) / (gaps.length || 1)
  return { pk, period, bpm: 60 / period }
})
const realSeries = computed(() => [{ name: 'Contact pulse sensor', color: '#6b6a66', y: seg.value, x0: a0.value / s.fps, dx: 1 / s.fps, width: 2 }])
</script>

<template>
  <h1>Waves and frequency</h1>
  <p class="lede">A pulse is a wave: something that repeats. Three numbers describe a simple wave completely, and everything later in this explorer is built from waves added together.</p>

  <div class="card">
    <h3>1. One wave, three knobs</h3>
    <p class="small muted">A sine wave. Drag the sliders and watch what each does. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <label>Frequency <input v-model.number="bpm1" type="range" min="30" max="240" step="1" /> <b>{{ bpm1 }} bpm</b></label>
      <label>Amplitude <input v-model.number="amp1" type="range" min="0.2" max="1.5" step="0.05" /> <b>{{ amp1.toFixed(2) }}</b></label>
      <label>Phase <input v-model.number="ph1" type="range" min="0" max="360" step="5" /> <b>{{ ph1 }}°</b></label>
    </div>
    <LineChart :series="wave" :markers="peakMarks" :y-domain="[-1.7, 1.7]" :x-domain="[0, SPAN]" :height="220" x-label="Time (s)" label="Sine wave" />
    <div class="stats">
      <div class="stat"><b>{{ f1.toFixed(2) }} Hz</b><span>frequency = bpm ÷ 60</span></div>
      <div class="stat"><b>{{ (1 / f1).toFixed(2) }} s</b><span>period = 1 ÷ frequency</span></div>
      <div class="stat"><b>{{ (SPAN * f1).toFixed(1) }}</b><span>cycles in {{ SPAN }} s</span></div>
    </div>
    <Tex block tex="x(t) = A \sin\!\left(2\pi f\, t + \varphi\right)" />
    <div class="callout">
      <strong>Why bpm and Hz are the same thing.</strong> "72 beats per minute" means 72 peaks every 60 s, which is 1.2 peaks per second, which is 1.2 Hz. Researchers write Hz; this explorer mostly writes bpm because it is the unit of the answer. The heart-rate band 0.7 to 3 Hz is 42 to 180 bpm.
      <br /><strong>Amplitude</strong> is how tall the wave is: in rPPG, how big the colour change is. <strong>Phase</strong> is where in its cycle the wave starts: moving it slides the wave sideways without changing its rate.
    </div>
  </div>

  <div class="card">
    <h3>2. Waves add up</h3>
    <p class="small muted">Real signals are sums. Turn on a second wave and look at the black line: it is just the two added point by point. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <label><input v-model="two" type="checkbox" /> Add wave 2</label>
      <template v-if="two">
        <label>Wave 2 frequency <input v-model.number="bpm2" type="range" min="30" max="300" step="1" /> <b>{{ bpm2 }} bpm</b></label>
        <label>Amplitude <input v-model.number="amp2" type="range" min="0.1" max="1.5" step="0.05" /> <b>{{ amp2.toFixed(2) }}</b></label>
      </template>
    </div>
    <LineChart :series="two ? sum : wave" :y-domain="[-3.2, 3.2]" :x-domain="[0, SPAN]" :height="240" x-label="Time (s)" label="Sum of two sine waves" />
    <p class="small muted">The sum is no longer a clean wave, yet nothing was lost: it still contains exactly the two. The Fourier transform (module C) is the tool that takes a sum like this and finds the ingredients again. That is how a heart rate gets read out of a messy trace.</p>
    <div v-if="two && Math.abs(bpm1 - bpm2) <= 12" class="callout warn"><strong>Beating.</strong> Two waves with nearly the same frequency drift in and out of step, so the sum swells and fades {{ Math.abs(bpm1 - bpm2) }} times a minute. Close frequencies are hard to tell apart; module C returns to this.</div>
  </div>

  <div class="card">
    <h3>3. The real pulse is a wave too</h3>
    <p class="small muted">Six seconds of the contact pulse sensor from subject {{ HERO }}. Heart rate is the spacing of its peaks. <span class="tag real">real data</span></p>
    <div class="controls"><label>Window <input v-model.number="wi" type="range" min="0" :max="wins.starts.length - 1" step="1" /> {{ (a0 / s.fps).toFixed(0) }} s</label></div>
    <LineChart :series="realSeries" :markers="real.pk.map((x) => ({ x, color: '#eb6834', opacity: 0.6 }))" :height="200" x-label="Time (s)" y-label="Sensor signal" label="Contact pulse sensor" />
    <div class="stats">
      <div class="stat"><b>{{ real.period.toFixed(2) }} s</b><span>average spacing of the peaks</span></div>
      <div class="stat"><b>{{ real.bpm.toFixed(0) }} bpm</b><span>60 ÷ spacing</span></div>
      <div class="stat"><b>{{ refHr(s)[wi].toFixed(0) }} bpm</b><span>10 s spectrum peak (module 4)</span></div>
    </div>
    <p class="small muted">It is not a perfect sine: each beat has a sharp rise and a slower fall, so it carries extra frequencies at multiples of the heart rate (module D). The video pulse is the same shape, only far weaker and noisier.</p>
  </div>
</template>
