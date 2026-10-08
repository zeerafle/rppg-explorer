<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadSubject, pulse, refHr, windows } from '../lib/data.js'
import { sine, times } from '../lib/synth.js'

const s = await loadSubject(HERO)
const T = 4
const dense = times(T * 200, 200)
const f = ref(1.2), fps = ref(30)
const cont = computed(() => sine(dense, f.value, 1, 0))
const n = computed(() => Math.floor(T * fps.value) + 1)
const ti = computed(() => Array.from({ length: n.value }, (_, i) => i / fps.value))
const samples = computed(() => ti.value.map((x) => Math.sin(2 * Math.PI * f.value * x)))
const nyq = computed(() => fps.value / 2)
const k = computed(() => Math.round(f.value / fps.value))
const fa = computed(() => f.value - k.value * fps.value)         // signed apparent frequency
const aliased = computed(() => Math.abs(fa.value) < f.value - 1e-9)
const recon = computed(() => sine(dense, fa.value, 1, 0))
const series = computed(() => [
  { name: 'True wave', color: '#6b6a66', y: cont.value, x0: 0, dx: 1 / 200, width: 1.4 },
  ...(aliased.value ? [{ name: 'What the samples seem to show', color: '#c13b7a', y: recon.value, x0: 0, dx: 1 / 200, width: 2.2, dash: '5 3' }] : []),
  { name: `Frames (${fps.value} per s)`, color: '#2a78d6', y: samples.value, x: ti.value, dots: true, width: 0.01, opacity: 1 },
])

// ---- real: throw frames away from the real pulse signal ----
const sig = pulse(s, 'source'), wins = windows(s), truth = refHr(s)
const keep = ref(1)
const eff = computed(() => s.fps / keep.value)
const est = computed(() => wins.starts.map((a) => {
  const x = Array.from(sig.subarray(a, a + wins.wn)).filter((_, i) => i % keep.value === 0)
  return D.hrBpm(Float64Array.from(x), eff.value)
}))
const err = computed(() => D.median(est.value.map((v, i) => Math.abs(v - truth[i]))))
const track = computed(() => {
  const xs = wins.starts.map((v) => (v + wins.wn / 2) / s.fps)
  return [
    { name: 'Truth', color: '#6b6a66', x: xs, y: truth, width: 2 },
    { name: `Video pulse kept at ${eff.value.toFixed(1)} fps`, color: '#eb6834', x: xs, y: est.value, width: 2.2 },
  ]
})
</script>

<template>
  <h1>Sampling a signal</h1>
  <p class="lede">A camera does not record a continuous wave; it takes snapshots, one per frame. How often it does so sets what it can and cannot see. This matters for rPPG because the whole pulse is a wave we only ever observe through video frames.</p>

  <div class="card">
    <h3>1. Samples can lie: aliasing</h3>
    <p class="small muted">The grey wave is the truth. The blue dots are what the camera records. Slow the camera down or speed the wave up until the dots stop describing the wave. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <label>Wave frequency <input v-model.number="f" type="range" min="0.2" max="14" step="0.1" /> <b>{{ f.toFixed(1) }} Hz</b> <span class="muted">({{ (f * 60).toFixed(0) }} bpm)</span></label>
      <label>Frame rate <input v-model.number="fps" type="range" min="2" max="30" step="1" /> <b>{{ fps }} fps</b></label>
    </div>
    <LineChart :series="series" :y-domain="[-1.4, 1.4]" :x-domain="[0, T]" :height="240" x-label="Time (s)" label="Wave and its samples" />
    <div class="stats">
      <div class="stat"><b>{{ nyq.toFixed(1) }} Hz</b><span>Nyquist limit = fps ÷ 2</span></div>
      <div class="stat" :style="{ borderLeft: `4px solid ${aliased ? 'var(--red)' : 'var(--green)'}` }"><b>{{ aliased ? 'Aliased' : 'Faithful' }}</b><span>{{ aliased ? `looks like ${Math.abs(fa).toFixed(1)} Hz (${(Math.abs(fa) * 60).toFixed(0)} bpm)` : 'samples describe the wave' }}</span></div>
    </div>
    <Tex block tex="f_{\text{apparent}} = \left| f - k\cdot \text{fps} \right|, \quad k = \text{round}(f / \text{fps})" />
    <div class="callout">
      <strong>The rule (Nyquist).</strong> You need more than two samples per cycle. At exactly two the dots can land on the zero crossings and see nothing; beyond that the dots draw a slower wave that was never there (pink), like a wagon wheel appearing to spin backwards in a film.
    </div>
  </div>

  <div class="card">
    <h3>2. Does this threaten rPPG?</h3>
    <p class="small muted">The question: could a slow camera miss a heartbeat the way it can miss a fast wave above? Short answer: not at normal frame rates. This demo shows why, and where it would finally break. <span class="tag real">real data</span></p>
    <div class="callout">
      <strong>In plain words, step by step.</strong>
      <ol class="small">
        <li><b>Hz</b> means cycles per second. A heart beating once per second is 1 Hz = 60 beats per minute (bpm). So bpm = Hz × 60.</li>
        <li>A camera at 30 fps takes 30 snapshots per second. The fastest wiggle it can still draw correctly is <b>half</b> the frame rate: 15 Hz. That limit is the <b>Nyquist limit</b>. Faster wiggles get misread as slower ones (the pink wave above).</li>
        <li>15 Hz = 15 × 60 = 900 bpm. The fastest heart rate we search for is 180 bpm (3 Hz). That is five times below the limit, so a normal camera has plenty of room.</li>
        <li>This demo asks: how far can we cut the frame rate before that room runs out? We delete frames from the real recording and re-measure the heart rate each time.</li>
      </ol>
    </div>
    <p class="small"><b>What to do:</b> drag the slider to the right. "Keep every 7" means we keep frame 1, delete the next 6, keep frame 8, and so on. At 30 fps that leaves 30 ÷ 7 ≈ 4.3 frames per second. The limit is then half of that, 2.15 Hz × 60 = 128 bpm, still above most resting heart rates.</p>
    <div class="controls"><label>Keep every <input v-model.number="keep" type="range" min="1" max="12" step="1" /> <b>{{ keep }}</b> frame{{ keep > 1 ? 's' : '' }}</label></div>
    <LineChart :series="track" :y-domain="[40, 185]" :height="240" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart rate at reduced frame rate" />
    <div class="stats">
      <div class="stat"><b>{{ eff.toFixed(1) }} fps</b><span>frames per second after deleting (the "effective frame rate")</span></div>
      <div class="stat"><b>{{ (eff * 30).toFixed(0) }} bpm</b><span>fastest heart rate this frame rate can show (Nyquist limit)</span></div>
      <div class="stat"><b>{{ err.toFixed(1) }} bpm</b><span>typical error: half the windows are off by less than this, half by more ("median error")</span></div>
    </div>
    <div class="callout">
      <strong>What you should see.</strong> The orange line (our measurement) sits on the grey line (the truth) for most settings. It only goes wrong once the speed limit drops close to real heart rates, about 6 fps here. <b>Takeaway:</b> frame rate alone does not break rPPG, because a heartbeat is a slow wave. Whatever hurts rPPG in compressed video is something else; module 6 shows what.
    </div>
    <p class="small muted">Two caveats, in plain words. (1) This recording was already smoothed so that nothing faster than 3 Hz was left before we deleted frames. Without that, fast flicker could be misread as a slow wave and pollute the heart rate (the aliasing from section 1). (2) We deleted frames evenly. Real video calls drop frames at random, which this test does not cover.</p>
  </div>
</template>
