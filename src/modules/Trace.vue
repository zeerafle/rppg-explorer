<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import SyncVideos from '../components/SyncVideos.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadSubject, loadTiles, refBvp } from '../lib/data.js'

const s = await loadSubject(HERO)
const tiles = await loadTiles()
const fps = s.fps
const dur = s.usable / fps

const t = ref(10)
const video = ref(null)
const filtered = ref(true)
const showRef = ref(true)
const span = ref(12)
const x0 = computed(() => Math.min(Math.max(0, t.value - span.value / 2), dur - span.value))

const rgb = s.conds.source.rgb
const meanOf = [0, 1, 2].map((c) => { let m = 0; for (let i = 0; i < s.usable; i++) m += rgb[i * 3 + c]; return m / s.usable })
const rel = (c) => Float64Array.from({ length: s.usable }, (_, i) => rgb[i * 3 + c] / meanOf[c] - 1)
const relRaw = [0, 1, 2].map(rel)
const relBp = relRaw.map((x) => D.bandpass(x, s.ba))
const ref0 = refBvp(s)
const COL = [['Red', '#d64545'], ['Green', '#1baf7a'], ['Blue', '#2a78d6']]

const series = computed(() => {
  const src = filtered.value ? relBp : relRaw
  const out = COL.map(([name, color], c) => ({ name, color, y: src[c], x0: 0, dx: 1 / fps, width: 1.4 }))
  if (showRef.value) {
    const k = D.std(relBp[1]) / D.std(ref0)
    out.push({ name: 'Contact sensor (scaled)', color: '#6b6a66', y: ref0.map((v) => v * k), x0: 0, dx: 1 / fps, dash: '4 3', width: 1.2 })
  }
  return out
})
const ptp = computed(() => COL.map(([n], c) => ({ n, v: D.std(relBp[c]) * 100 })))
const driftStd = D.std(relRaw[1]) * 100

// ---- spatial averaging experiment: average k random skin tiles ----
const { n: nFr, ny, nx } = tiles
const skin = []
{
  const [bx0, by0, bx1, by1] = s.inner
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const cx = tiles.x0 + tx * tiles.tile + tiles.tile / 2, cy = tiles.y0 + ty * tiles.tile + tiles.tile / 2
    if (cx > bx0 && cx < bx1 && cy > by0 && cy < by1) skin.push(ty * nx + tx)
  }
}
// seeded shuffle, so "k tiles" is reproducible between page loads
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const order = [...skin].sort(() => rnd() - 0.5)
const tileGreen = (i) => { const g = new Float64Array(nFr); let m = 0; for (let f = 0; f < nFr; f++) { g[f] = tiles.data[(f * ny * nx + i) * 3 + 1]; m += g[f] } m /= nFr; for (let f = 0; f < nFr; f++) g[f] = g[f] / m - 1; return g }
const tg = order.map(tileGreen)
const k = ref(1)
const avg = computed(() => {
  const a = new Float64Array(nFr)
  for (let j = 0; j < k.value; j++) for (let f = 0; f < nFr; f++) a[f] += tg[j][f] / k.value
  return D.bandpass(a, s.ba)
})
const agreement = computed(() => {
  const m = Math.min(nFr, ref0.length), lag = Math.round(0.3 * fps)
  const a = avg.value, sa = D.std(a), sr = D.std(ref0.subarray(0, m))
  let best = 0
  for (let l = -lag; l <= lag; l++) {
    let sum = 0, cnt = 0
    for (let i = Math.max(0, -l); i < Math.min(m, m - l); i++) { sum += a[i + l] * ref0[i]; cnt++ }
    best = Math.max(best, Math.abs(sum / cnt / (sa * sr)))
  }
  return best
})
const avgSeries = computed(() => {
  const a = avg.value, k1 = D.std(a)
  const r = ref0.map((v) => v * k1 / D.std(ref0))
  return [
    { name: `Average of ${k.value} tile${k.value > 1 ? 's' : ''}`, color: '#1baf7a', y: a.subarray(0, Math.round(15 * fps)), dx: 1 / fps, x0: 0 },
    { name: 'Contact sensor', color: '#6b6a66', y: r.subarray(0, Math.round(15 * fps)), dx: 1 / fps, x0: 0, dash: '4 3', width: 1.2 },
  ]
})

function seek(v) { video.value?.seek(v) }
</script>

<template>
  <h1>From video to a colour trace</h1>
  <p class="lede">An algorithm cannot use a picture. We collapse each frame to three numbers: the average red, green and blue inside a box on the skin. Played in time, those numbers are the signal everything else is built on.</p>

  <div class="card">
    <h3>1. The box and the trace</h3>
    <p class="small muted">Play the video. The orange box is the face detector's region; the smaller white box (60 % of its side) is the area actually averaged, so edges and hair stay out. The chart shows the relative change of each channel; the playhead follows the video, and you can drag on the chart to jump. <span class="tag real">real data</span></p>
    <div class="row">
      <div>
        <SyncVideos ref="video" :clips="[{ name: 'source', label: 'Original recording' }]" :fps="fps" :duration="dur" :start="10" :cols="1" @time="(v) => (t = v)">
          <template #overlay>
            <rect :x="s.box[0]" :y="s.box[1]" :width="s.box[2] - s.box[0]" :height="s.box[3] - s.box[1]" fill="none" stroke="#eb6834" stroke-width="3" />
            <rect :x="s.inner[0]" :y="s.inner[1]" :width="s.inner[2] - s.inner[0]" :height="s.inner[3] - s.inner[1]" fill="rgba(255,255,255,0.12)" stroke="#fff" stroke-width="2.5" />
          </template>
        </SyncVideos>
      </div>
      <div>
        <div class="controls">
          <div class="seg" role="group" aria-label="Trace type">
            <button :class="{ on: !filtered }" @click="filtered = false">Raw drift</button>
            <button :class="{ on: filtered }" @click="filtered = true">Pulse band only</button>
          </div>
          <label><input v-model="showRef" type="checkbox" /> Contact sensor</label>
        </div>
        <LineChart :series="series" :x-domain="[x0, x0 + span]" :playhead="t" scrub :height="270" y-label="Change vs average" x-label="Time (s)" label="Colour traces" @scrub="seek" />
        <div class="controls"><label>Zoom <input v-model.number="span" type="range" min="4" max="30" step="1" /> {{ span }} s</label></div>
      </div>
    </div>
    <div class="stats">
      <div v-for="p in ptp" :key="p.n" class="stat"><b>{{ p.v.toFixed(3) }} %</b><span>{{ p.n }} pulse amplitude (std)</span></div>
    </div>
    <div class="callout">
      <strong>Why "pulse band only"?</strong> The raw green trace wanders by {{ driftStd.toFixed(2) }} % over the minute (light, auto-exposure, posture), {{ (driftStd / ptp[1].v).toFixed(0) }}× the pulse's {{ ptp[1].v.toFixed(2) }} %. The wandering is slow, below 0.7 Hz (42 bpm), so a band-pass filter that keeps only 0.7 to 3 Hz removes it and the heartbeat appears. Green is the largest here because haemoglobin absorbs green light most strongly.
    </div>
  </div>

  <div class="card">
    <h3>2. Why average at all?</h3>
    <p class="small muted">Each {{ tiles.tile }}-px tile on the skin has its own sensor noise. Average more of them and the noise cancels while the shared pulse stays. Choose how many random skin tiles to average (out of {{ skin.length }}). <span class="tag real">real data</span></p>
    <div class="controls"><label>Tiles averaged <input v-model.number="k" type="range" min="1" :max="skin.length" step="1" /> <b>{{ k }}</b></label>
      <span class="stat"><b>{{ agreement.toFixed(2) }}</b><span>match with contact sensor (|r|)</span></span></div>
    <LineChart :series="avgSeries" :height="230" y-label="Relative brightness" x-label="Time (s)" label="Averaged tiles against reference" />
    <p class="small muted">One {{ tiles.tile }}-px tile is noisier than the average of all {{ skin.length }}. The real pipeline averages the whole inner box, about {{ ((s.inner[2] - s.inner[0]) * (s.inner[3] - s.inner[1]) / 1000).toFixed(0) }} thousand pixels.</p>
  </div>
</template>
