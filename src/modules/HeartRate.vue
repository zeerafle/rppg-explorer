<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import * as D from '../lib/dsp.js'
import { HERO, hrTrack, loadSubject, pulse, refBvp, refHr, windows } from '../lib/data.js'

const s = await loadSubject(HERO)
const fps = s.fps
const { wn, starts } = windows(s)
const sig = pulse(s, 'source')
const ref0 = refBvp(s)
const trackPos = hrTrack(s, 'source')
const trackRef = refHr(s)

const w = ref(5)                                  // index into starts
const hann = ref(true)
const nfft = ref(1 << 16)
const a = computed(() => starts[w.value])
const seg = computed(() => sig.subarray(a.value, a.value + wn))
const taper = computed(() => D.hann(wn))
const spec = computed(() => D.spectrum(seg.value, fps, { nfft: nfft.value, hann: hann.value }))
const peak = computed(() => D.peakBpm(spec.value))
const truthSpec = computed(() => D.spectrum(ref0.subarray(a.value, a.value + wn), fps))
const truth = computed(() => D.peakBpm(truthSpec.value))
const err = computed(() => Math.abs(peak.value - truth.value))

const t0 = computed(() => a.value / fps)
const tr = computed(() => Array.from({ length: wn }, (_, i) => t0.value + i / fps))
const segSeries = computed(() => {
  const x = Array.from(seg.value)
  const k = 1 / (D.std(seg.value) * 3.2)
  return [
    { name: 'Pulse signal (POS)', color: '#eb6834', x: tr.value, y: x, width: 1.8 },
    ...(hann.value ? [{ name: 'After taper', color: '#8a63d2', x: tr.value, y: x.map((v, i) => v * taper.value[i]), width: 1.6 }, { name: 'Taper shape', color: '#6b6a66', x: tr.value, y: Array.from(taper.value, (v) => v * (Math.max(...x.map(Math.abs)) )), dash: '3 3', width: 1, opacity: 0.8 }] : []),
  ]
})
const specSeries = computed(() => {
  const mx = Math.max(...spec.value.p), tm = Math.max(...truthSpec.value.p)
  return [
    { name: 'Spectrum of the video pulse', color: '#eb6834', x: Array.from(spec.value.f, (v) => v * 60), y: Array.from(spec.value.p, (v) => v / mx), width: 2 },
    { name: 'Spectrum of the contact sensor', color: '#6b6a66', x: Array.from(truthSpec.value.f, (v) => v * 60), y: Array.from(truthSpec.value.p, (v) => v / tm), dash: '4 3', width: 1.3 },
  ]
})
const binBpm = computed(() => (60 * fps) / nfft.value)

const trackSeries = computed(() => [
  { name: 'Contact sensor', color: '#6b6a66', x: starts.map((v) => (v + wn / 2) / fps), y: trackRef, width: 2 },
  { name: 'From video (POS)', color: '#eb6834', x: starts.map((v) => (v + wn / 2) / fps), y: trackPos, width: 2 },
])
const errs = trackPos.map((v, i) => Math.abs(v - trackRef[i]))
const mae = errs.reduce((p, c) => p + c, 0) / errs.length
const within5 = errs.filter((e) => e <= 5).length / errs.length
</script>

<template>
  <h1>From pulse to heart rate</h1>
  <p class="lede">The pulse signal is a wavy line. Its heart rate is how fast it wobbles. We cut it into 10 second windows, ask "which frequency is present most strongly?" with a Fourier transform, and read that frequency in beats per minute.</p>

  <div class="card">
        <h3>1. One window</h3>
        <div class="controls">
          <label>Window <input v-model.number="w" type="range" min="0" :max="starts.length - 1" step="1" /> {{ t0.toFixed(0) }} to {{ (t0 + wn / fps).toFixed(0) }} s</label>
        </div>
        <LineChart :series="segSeries" :height="200" x-label="Time (s)" y-label="Pulse signal" label="Windowed pulse signal" />
        <p class="small muted">Ten seconds is about {{ Math.round(10 * truth / 60) }} heartbeats. The Fourier transform assumes the window repeats forever, so a hard cut at the ends would add fake frequencies; fading the ends to zero with a Hann taper (purple) avoids that. <span class="tag real">real data</span></p>

        <h3>2. Its spectrum</h3>
        <div class="controls">
          <label><input v-model="hann" type="checkbox" /> Hann taper</label>
          <div class="seg" role="group" aria-label="Zero padding">
            <button :class="{ on: nfft === 512 }" @click="nfft = 512">Coarse (FFT 512)</button>
            <button :class="{ on: nfft === 4096 }" @click="nfft = 4096">FFT 4096</button>
            <button :class="{ on: nfft === 65536 }" @click="nfft = 65536">Fine (FFT 65536)</button>
          </div>
          <span class="small muted">frequency grid: {{ binBpm.toFixed(2) }} bpm per step</span>
        </div>
        <LineChart :series="specSeries" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :markers="[{ x: peak, label: `video: ${peak.toFixed(1)}`, color: '#eb6834' }, { x: truth, label: `truth: ${truth.toFixed(1)}`, color: '#6b6a66', labelY: 14 }]" :height="250" x-label="Heart rate (bpm)" y-label="Relative power" label="Spectrum" />
        <div class="stats">
          <div class="stat"><b>{{ peak.toFixed(1) }}</b><span>bpm from video</span></div>
          <div class="stat"><b>{{ truth.toFixed(1) }}</b><span>bpm from contact sensor</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${err <= 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ err.toFixed(1) }}</b><span>error (bpm)</span></div>
        </div>
        <div class="callout">
          <strong>Two things limit precision.</strong> A 10 s window cannot separate rates closer than about 6 bpm (peak width), no matter how fine the grid. "Zero padding" only draws that same peak on a finer grid so we can locate its top; the coarse setting shows the grid steps. The search is limited to 42 to 180 bpm because outside that range nothing physiological lives.
        </div>
  </div>

  <div class="card">
    <h3>3. All windows: a heart-rate track</h3>
    <p class="small muted">Repeat for every window (5 s apart). This is the number every experiment in the thesis reports: the gap between the two lines. <span class="tag real">real data</span></p>
    <LineChart :series="trackSeries" :y-domain="[50, 160]" :markers="[{ x: t0 + wn / 2 / fps, label: 'window above', color: 'var(--accent)', dash: '2 3' }]" :height="240" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart-rate track" />
    <div class="stats">
      <div class="stat"><b>{{ mae.toFixed(2) }}</b><span>mean abs. error (bpm)</span></div>
      <div class="stat"><b>{{ (within5 * 100).toFixed(0) }} %</b><span>windows within 5 bpm</span></div>
    </div>
    <p class="small muted">This is uncompressed video, so the lines agree. Everything that follows asks what compression does to this picture.</p>
  </div>
</template>

<style scoped>
</style>
