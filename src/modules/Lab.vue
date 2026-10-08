<script setup>
// Free play: every knob in one place. Same data and same code as the guided modules.
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import * as D from '../lib/dsp.js'
import { MODE_COLOR, MODE_LABEL, SUBJECTS, hrTrack, loadSubject, periodOf, refBvp, refHr, windows } from '../lib/data.js'

const subs = Object.fromEntries(await Promise.all(SUBJECTS.map(async (id) => [id, await loadSubject(id)])))
const sid = ref(10)
const cond = ref('g60')
const method = ref('pos')
const fix = ref(false)
const win = ref(4)
const CONDS = ['source', 'long', 'g30', 'g60', 'g120', 'intra-refresh']

const s = computed(() => subs[sid.value])
const fps = computed(() => s.value.fps)
const w = computed(() => windows(s.value))
const wi = computed(() => Math.min(win.value, w.value.starts.length - 1))
const a0 = computed(() => w.value.starts[wi.value])
const canFix = computed(() => !!s.value.conds[cond.value].bvpPhase && method.value === 'pos')
const sig = computed(() => {
  if (fix.value && canFix.value) return s.value.conds[cond.value].bvpPhase
  return D.pulseSignal(s.value.conds[cond.value].rgb.subarray(0, s.value.usable * 3), fps.value, s.value.ba, method.value)
})
const sigSrc = computed(() => D.pulseSignal(s.value.conds.source.rgb.subarray(0, s.value.usable * 3), fps.value, s.value.ba, method.value))
const ref0 = computed(() => refBvp(s.value))
const period = computed(() => periodOf(s.value, cond.value))
const teeth = computed(() => (period.value ? D.keyframeHarmonics(fps.value, period.value) : []))

const seg = (x) => x.subarray(a0.value, a0.value + w.value.wn)
const t0 = computed(() => a0.value / fps.value)
const xs = computed(() => Array.from({ length: w.value.wn }, (_, i) => t0.value + i / fps.value))
const z = (x) => { const k = 1 / D.std(x); return Array.from(x, (v) => v * k) }
const pulseSeries = computed(() => [
  { name: 'Truth (contact sensor)', color: '#6b6a66', x: xs.value, y: z(seg(ref0.value)), dash: '4 3', width: 1.4 },
  { name: `${MODE_LABEL[cond.value]}${fix.value && canFix.value ? ', corrected' : ''}`, color: MODE_COLOR[cond.value], x: xs.value, y: z(seg(sig.value)), width: 2 },
])
const specs = computed(() => {
  const a = D.spectrum(seg(sig.value), fps.value), b = D.spectrum(seg(sigSrc.value), fps.value), r = D.spectrum(seg(ref0.value), fps.value)
  const mx = Math.max(...a.p, ...b.p)
  return { a, b, r, series: [
    { name: 'Uncompressed', color: '#6b6a66', x: Array.from(b.f, (v) => v * 60), y: Array.from(b.p, (v) => v / mx), dash: '4 3', width: 1.3 },
    { name: MODE_LABEL[cond.value], color: MODE_COLOR[cond.value], x: Array.from(a.f, (v) => v * 60), y: Array.from(a.p, (v) => v / mx), width: 2.2 },
  ] }
})
const truth = computed(() => refHr(s.value)[wi.value])
const est = computed(() => D.peakBpm(specs.value.a))
const track = computed(() => {
  const xx = w.value.starts.map((v) => (v + w.value.wn / 2) / fps.value)
  const est = w.value.starts.map((v) => D.hrBpm(sig.value.subarray(v, v + w.value.wn), fps.value))
  const rf = refHr(s.value)
  const e = est.map((v, i) => Math.abs(v - rf[i]))
  return { est, mae: e.reduce((p, c) => p + c, 0) / e.length, med: D.median(e), series: [
    { name: 'Truth', color: '#6b6a66', x: xx, y: rf, width: 2 },
    { name: MODE_LABEL[cond.value], color: MODE_COLOR[cond.value], x: xx, y: est, width: 2.2 },
  ] }
})
</script>

<template>
  <h1>Lab</h1>
  <p class="lede">Every control from the guided modules, in one place. Pick a person, an encode, an algorithm and a window.</p>
  <div class="card">
    <div class="controls">
      <label>Subject <span class="seg"><button v-for="id in SUBJECTS" :key="id" :class="{ on: sid === id }" @click="sid = id">{{ id }}</button></span></label>
      <label>Algorithm <span class="seg"><button :class="{ on: method === 'pos' }" @click="method = 'pos'">POS</button><button :class="{ on: method === 'chrom' }" @click="method = 'chrom'">CHROM</button></span></label>
    </div>
    <div class="controls">
      <label>Encode <span class="seg"><button v-for="c in CONDS" :key="c" :class="{ on: cond === c }" @click="cond = c">{{ MODE_LABEL[c] }}</button></span></label>
    </div>
    <div class="controls">
      <label><input v-model="fix" type="checkbox" :disabled="!canFix" /> Remove keyframe pattern (POS, keyframe encodes only)</label>
      <label>Window <input v-model.number="win" type="range" min="0" :max="w.starts.length - 1" step="1" /> {{ t0.toFixed(0) }} to {{ (t0 + w.wn / fps).toFixed(0) }} s</label>
    </div>
  </div>
  <div class="row">
    <div class="card"><h3>Pulse in this window</h3><LineChart :series="pulseSeries" :height="220" x-label="Time (s)" label="Pulse signal" /></div>
    <div class="card"><h3>Spectrum</h3>
      <LineChart :series="specs.series" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :markers="[...teeth.map((t) => ({ x: t.bpm, color: MODE_COLOR[cond], dash: '2 3', opacity: 0.5 })), { x: truth, label: 'truth', color: '#0b0b0b', dash: '5 2' }]" :height="220" x-label="Heart rate (bpm)" label="Spectrum" />
      <div class="stats"><div class="stat"><b>{{ est.toFixed(1) }}</b><span>video says (bpm)</span></div><div class="stat"><b>{{ truth.toFixed(1) }}</b><span>truth (bpm)</span></div></div>
    </div>
  </div>
  <div class="card"><h3>Whole minute</h3>
    <LineChart :series="track.series" :y-domain="[40, 185]" :hlines="teeth.map((t) => ({ y: t.bpm, label: t.bpm.toFixed(0), color: MODE_COLOR[cond] }))" :height="260" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart rate track" />
    <div class="stats"><div class="stat"><b>{{ track.med.toFixed(1) }}</b><span>median error (bpm)</span></div><div class="stat"><b>{{ track.mae.toFixed(1) }}</b><span>mean abs. error (bpm)</span></div></div>
  </div>
</template>
