<script setup>
import { computed } from 'vue'
import LineChart from '../components/LineChart.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadDamage, loadSubject, median, pulse, refBvp, rgbOf } from '../lib/data.js'

defineEmits(['go'])
const s = await loadSubject(HERO)
const damage = await loadDamage()

const fps = s.fps
const w0 = Math.round(20 * fps), nW = Math.round(8 * fps)      // an 8 s excerpt starting at 20 s
const rgb = rgbOf(s, 'source')
const rel = (c) => {
  let m = 0
  for (let i = 0; i < s.usable; i++) m += rgb[i * 3 + c]
  m /= s.usable
  return D.bandpass(Float64Array.from({ length: s.usable }, (_, i) => rgb[i * 3 + c] / m - 1), s.ba)
}
const rgbSeries = [['R', '#d64545'], ['G', '#1baf7a'], ['B', '#2a78d6']].map(([name, color], c) => ({
  name, color, y: rel(c).subarray(w0, w0 + nW), x0: 20, dx: 1 / fps, width: 1.3,
}))
const posSeries = [
  { name: 'POS from video', color: '#eb6834', y: pulse(s, 'source').subarray(w0, w0 + nW), x0: 20, dx: 1 / fps },
  { name: 'Contact sensor (truth)', color: '#6b6a66', y: (() => { const r = refBvp(s).subarray(w0, w0 + nW); const k = D.std(pulse(s, 'source').subarray(w0, w0 + nW)) / D.std(r); return r.map((v) => v * k) })(), x0: 20, dx: 1 / fps, dash: '4 3', width: 1.2 },
]
const spec = D.spectrum(pulse(s, 'source').subarray(w0 - Math.round(2 * fps), w0 - Math.round(2 * fps) + Math.round(10 * fps)), fps)
const pk = D.peakBpm(spec)
const specSeries = [{ color: '#eb6834', y: Array.from(spec.p, (v) => v / Math.max(...spec.p)), x: Array.from(spec.f, (v) => v * 60) }]

const stat = (cond) => median(damage.rows.filter((r) => r.cond === cond).map((r) => r.err))
const stats = computed(() => [
  { v: stat('source'), t: 'Uncompressed video', c: 'var(--green)' },
  { v: stat('800k-aq1-long'), t: '800 kbps, one keyframe', c: 'var(--blue)' },
  { v: stat('800k-aq1-g60'), t: '800 kbps, keyframe every 2 s', c: 'var(--accent)' },
  { v: stat('100k-aq1-long'), t: '100 kbps, one keyframe', c: 'var(--red)' },
])

const GLOSS = [
  ['rPPG', 'Remote photoplethysmography: reading the pulse from a camera. "Photo" (light) + "plethysmo" (volume change) + "graph".'],
  ['bpm', 'Beats per minute. 1 Hz = 60 bpm, so the band we search, 0.7 to 3 Hz, is 42 to 180 bpm.'],
  ['ROI', 'Region of interest: the box on the face whose pixels we average.'],
  ['POS / CHROM', 'Two classic recipes that turn the red, green and blue traces into one pulse signal. No training, just algebra.'],
  ['Spectrum', 'How much of each frequency a signal contains. The pulse is the strongest frequency in the allowed band.'],
  ['Codec / H.264', 'The compression scheme that makes video small enough to stream. Lossy: it throws information away.'],
  ['Bitrate', 'How many bits per second the compressed stream is allowed to use. 800k = 800 kbit/s.'],
  ['Keyframe (I-frame)', 'A frame stored as a complete picture. Every other frame is stored as "what changed since the last one".'],
  ['GOP', 'Group of pictures: the stretch from one keyframe to the next. "GOP 60" means a keyframe every 60 frames, about every 2 s.'],
  ['QP', 'Quantisation parameter: how coarsely the encoder rounds the picture. Higher QP = smaller file, blurrier picture.'],
  ['CBR', 'Constant bitrate: the encoder must hit a fixed bits-per-second, so quality varies to fit the budget.'],
  ['MAE / median error', 'How far the measured heart rate is from the contact sensor, in bpm, averaged or median over 10 s windows.'],
]
</script>

<template>
  <h1>The big picture</h1>
  <p class="lede">A camera can read your pulse because your skin changes colour, very slightly, with every heartbeat. This explorer walks the whole chain from pixels to beats per minute, then shows what happens when video compression sits in the middle.</p>

  <h2>Five steps, one video</h2>
  <p class="muted">Each card is computed from the same recording (UBFC-rPPG subject {{ HERO }}). Click a card to open its module.</p>
  <div class="pipe">
    <button class="card" @click="$emit('go', 'skin')">
      <span class="tag real">Step 1</span><h3>The skin flushes</h3>
      <p class="small muted">Blood volume changes the colour by about 0.1 %. Invisible, but real.</p>
    </button>
    <button class="card" @click="$emit('go', 'trace')">
      <span class="tag real">Step 2</span><h3>Average into a trace</h3>
      <LineChart :series="rgbSeries" :height="110" :legend="false" label="Red, green and blue traces" :x-format="(v) => v + ' s'" />
      <p class="small muted">Three numbers per frame. Green carries most of the pulse.</p>
    </button>
    <button class="card" @click="$emit('go', 'pos')">
      <span class="tag real">Step 3</span><h3>Cancel the junk</h3>
      <LineChart :series="posSeries" :height="110" :legend="false" label="POS pulse against contact sensor" :x-format="(v) => v + ' s'" />
      <p class="small muted">POS combines the channels so brightness changes cancel.</p>
    </button>
    <button class="card" @click="$emit('go', 'hr')">
      <span class="tag real">Step 4</span><h3>Find the rhythm</h3>
      <LineChart :series="specSeries" :x-domain="[42, 180]" :y-domain="[0, 1.1]" :markers="[{ x: pk, label: pk.toFixed(0) + ' bpm', color: 'var(--ink)' }]" :height="110" :legend="false" label="Spectrum" />
      <p class="small muted">The tallest peak in 42 to 180 bpm is the heart rate.</p>
    </button>
    <button class="card twist" @click="$emit('go', 'codec')">
      <span class="tag illus">The twist</span><h3>Compression sits in front</h3>
      <p class="small muted">Real calls are compressed before any algorithm sees them. The codec was built for human eyes, which do not care about a 0.1 % flush. It may also invent patterns of its own.</p>
    </button>
  </div>

  <div class="callout">
    <strong>New to signals?</strong> Four short optional modules (<a href="#waves">A to D</a>) cover waves and frequency, sampling, the Fourier spectrum and filters, with the same interactive style. Everything in the pipeline modules 1 to 6 uses only those four ideas.
  </div>

  <h2>How much does it matter?</h2>
  <p class="muted">Median heart-rate error over {{ damage.subjects }} subjects (10 s windows, POS). Same algorithm, same people.</p>
  <div class="stats">
    <div v-for="x in stats" :key="x.t" class="stat" :style="{ borderLeft: `4px solid ${x.c}` }"><b>{{ x.v.toFixed(1) }} bpm</b><span>{{ x.t }}</span></div>
  </div>
  <p>The two middle numbers are the surprise: the <em>same bitrate</em> gives a 3 bpm error or a {{ stat('800k-aq1-g60').toFixed(0) }} bpm error depending on one encoder setting, how often it stores a full keyframe. Module 6 takes that apart.</p>

  <h2>Where the data comes from</h2>
  <div class="card">
    <table class="t left">
      <tbody>
        <tr><td>Recordings</td><td>UBFC-rPPG: seated people, 640×480, about 30 frames per second, roughly one minute each, contact pulse sensor as truth</td></tr>
        <tr><td>Deep-dive subjects</td><td>5 (ids 1, 10, 20, 30, 40): every trace, stream and video in this explorer</td></tr>
        <tr><td>Wide study</td><td>42 subjects: the compression sweep and the keyframe settings (summary numbers only)</td></tr>
        <tr><td>Encoder</td><td>x264 (H.264) in constant-bitrate low-latency mode, run locally with ffmpeg</td></tr>
        <tr><td>Code</td><td>The JavaScript here is a port of the Python used in the experiments and is tested against it</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Words you will meet</h2>
  <div class="gl">
    <details v-for="[k, v] in GLOSS" :key="k"><summary>{{ k }}</summary><p class="small muted">{{ v }}</p></details>
  </div>
</template>

<style scoped>
.pipe { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; margin-top: 12px; }
.pipe .card { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; text-align: left; margin: 0; cursor: pointer; transition: border-color 0.15s, transform 0.15s; color: inherit; font: inherit; }
.pipe .card:hover { border-color: var(--accent); transform: translateY(-2px); }
.pipe .card h3 { margin: 8px 0 6px; }
.pipe .twist { border-style: dashed; }
.gl { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 18px; }
details { border-bottom: 1px solid var(--line); padding: 6px 0; }
summary { cursor: pointer; font-weight: 600; font-size: 0.92rem; }
details p { margin: 6px 0 2px; }
</style>
