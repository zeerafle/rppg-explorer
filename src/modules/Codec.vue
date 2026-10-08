<script setup>
import { computed, ref } from 'vue'
import CategoryBars from '../components/CategoryBars.vue'
import LineChart from '../components/LineChart.vue'
import SyncVideos from '../components/SyncVideos.vue'
import * as D from '../lib/dsp.js'
import { HERO, MODE_COLOR, MODE_LABEL, loadDamage, loadHeroMeta, loadSubject } from '../lib/data.js'

const s = await loadSubject(HERO)
const damage = await loadDamage()
const view = await loadHeroMeta()
const fps = s.fps
const vb = [view.x0, view.y0, view.w, view.h]

// ---- 1. frame types, from the real bitstreams ----
const SECS = 12
const nShow = Math.round(SECS * fps)
const GOP_MODES = ['g30', 'g60', 'g120', 'long']
const strips = GOP_MODES.map((m) => ({ mode: m, idx: s.conds[m].isI.filter((i) => i < nShow), total: s.conds[m].isI.length }))

// ---- 2. quantiser per frame ----
const qMode = ref('g60')
const qSeries = computed(() => [
  { name: 'Mean quantiser (QP) of each frame', color: MODE_COLOR[qMode.value], y: s.conds[qMode.value].qmean, x0: 0, dx: 1 / fps, width: 1.4 },
])
const qMarkers = computed(() => s.conds[qMode.value].isI.map((i) => ({ x: i / fps, color: MODE_COLOR[qMode.value], opacity: 0.45, dash: '2 3' })))
const qStats = computed(() => {
  const c = s.conds[qMode.value], isI = new Set(c.isI)
  let a = 0, na = 0, b = 0, nb = 0
  c.qmean.forEach((q, i) => { if (isI.has(i)) { a += q; na++ } else { b += q; nb++ } })
  return { I: na ? a / na : NaN, P: b / nb, n: na }
})

// ---- 3. decoded vs source ----
const dm = ref('g60')
const clips = computed(() => [
  { name: dm.value, label: `Decoded: ${MODE_LABEL[dm.value]} (800 kbps)` },
  { name: `diff_${dm.value}`, label: `Decoded minus original, ×${view.diff_gain} (grey = identical)`, viewBox: vb },
])

// ---- 4. 42-subject damage by bitrate ----
const CONDS = [['source', 'Uncompressed'], ['1600k-aq1-long', '1600 kbps'], ['800k-aq1-long', '800 kbps'], ['400k-aq1-long', '400 kbps'], ['200k-aq1-long', '200 kbps'], ['100k-aq1-long', '100 kbps']]
const q = (a, p) => { const x = [...a].sort((u, v) => u - v); return x[Math.min(x.length - 1, Math.floor(p * (x.length - 1)))] }
const dmg = CONDS.map(([c, label]) => {
  const e = damage.rows.filter((r) => r.cond === c).map((r) => r.err)
  return { label, value: D.median(e), lo: q(e, 0.25), hi: q(e, 0.75), bad: e.filter((v) => v > 5).length / e.length, n: e.length }
})
const bars = dmg.map((d, i) => ({ label: d.label, value: d.value, lo: d.lo, hi: d.hi, color: `color-mix(in srgb, var(--blue) ${100 - i * 14}%, var(--red))`, note: `${(d.bad * 100).toFixed(0)} % of windows off by >5` }))
const rawMbps = (640 * 480 * 3 * 8 * fps) / 1e6
</script>

<template>
  <h1>What compression does to the video</h1>
  <p class="lede">A minute of this video is {{ (rawMbps * 60 / 8 / 1000).toFixed(1) }} GB uncompressed: {{ rawMbps.toFixed(0) }} megabits every second. Video calls squeeze that to about one megabit, roughly {{ Math.round(rawMbps / 0.8) }}× smaller. Codecs get there by throwing away what a human eye is unlikely to miss. A 0.1 % colour flush is exactly that kind of detail.</p>

  <div class="card">
    <h3>1. Two kinds of frames</h3>
    <p class="small muted">A <b>keyframe</b> (I-frame) is stored as a whole picture. Every other frame (a P-frame) stores only what changed since the previous one, which is far cheaper. The encoder decides how often to insert a keyframe; the setting is called GOP size. Below: the first {{ SECS }} s of four real encodes of the same video, a tick = a keyframe. <span class="tag real">real streams</span></p>
    <div v-for="r in strips" :key="r.mode" class="strip">
      <span class="sl">{{ MODE_LABEL[r.mode] }}</span>
      <svg :viewBox="`0 0 ${nShow} 14`" preserveAspectRatio="none" role="img" :aria-label="`Keyframes of ${MODE_LABEL[r.mode]}`">
        <rect x="0" y="6" :width="nShow" height="2" fill="var(--line)" />
        <rect v-for="i in r.idx" :key="i" :x="i - 0.6" y="0" width="1.4" height="14" :fill="MODE_COLOR[r.mode]" />
      </svg>
      <span class="sc mono">{{ r.total }} in {{ (s.usable / fps).toFixed(0) }} s</span>
    </div>
    <p class="small muted">Why not always use few keyframes? A lost packet in a video call corrupts every frame after it until the next keyframe, so real-time systems insert them regularly (every 1 to 4 s is common) so a glitch heals itself. That is the engineering reason the artefact in module 6 exists in the wild.</p>
  </div>

  <div class="card">
    <h3>2. The quantiser: how coarsely each frame is rounded</h3>
    <p class="small muted">QP is the dial. A higher QP rounds more coarsely, producing a smaller file and a blurrier, blockier picture. In constant-bitrate mode the encoder must stay on budget, so it moves QP every frame. <span class="tag real">real streams</span></p>
    <div class="controls"><div class="seg" role="group" aria-label="Encode">
      <button v-for="m in ['g30', 'g60', 'g120', 'long']" :key="m" :class="{ on: qMode === m }" @click="qMode = m">{{ MODE_LABEL[m] }}</button>
    </div></div>
    <LineChart :series="qSeries" :markers="qMarkers" :x-domain="[0, 20]" :height="220" x-label="Time (s)" y-label="Mean QP" label="Quantiser per frame" />
    <div class="stats">
      <div v-if="qStats.n" class="stat"><b>{{ qStats.I.toFixed(1) }}</b><span>mean QP on keyframes</span></div>
      <div class="stat"><b>{{ qStats.P.toFixed(1) }}</b><span>mean QP on other frames</span></div>
    </div>
    <p class="small muted">Dotted lines mark keyframes. A keyframe is coded finer (lower QP) and costs many bits. When the budget runs short, the frames right after it can get a sharp QP spike instead (look for peaks beside the dotted lines). Either way picture quality is not constant: it moves with the keyframe cycle. The first frame of every encode is expensive and starts at a high QP while the rate control settles.</p>
  </div>

  <div class="card">
    <h3>3. What the decoder hands back</h3>
    <p class="small muted">Left: the decoded stream. Right: its brightness difference from the original, amplified ×{{ view.diff_gain }}. Mid-grey means no error; lighter or darker means the encoder changed that pixel. <span class="tag real">real video</span></p>
    <div class="controls"><div class="seg" role="group" aria-label="Encode">
      <button v-for="m in ['long', 'g30', 'g60', 'g120', 'intra-refresh']" :key="m" :class="{ on: dm === m }" @click="dm = m">{{ MODE_LABEL[m] }}</button>
    </div></div>
    <SyncVideos :clips="clips" :fps="fps" :duration="s.usable / fps" :start="20" :cols="2" />
    <div class="callout">
      <strong>What you cannot see.</strong> The error is mostly spatial noise: a few grey levels per pixel, strongest on edges (hair, collar). Each pixel is wrong by far more than the pulse is large. But rPPG averages thousands of pixels, and random errors cancel in an average. What does not cancel is a shift that is the same across the whole face. The keyframe cycle produces exactly that, a few tenths of a grey level in the face's average brightness (module 6), invisible in this picture at any gain, but as large as the pulse.
    </div>
  </div>

  <div class="card">
    <h3>4. How much does it hurt the heart rate?</h3>
    <p class="small muted">Median error over {{ damage.subjects }} subjects at five bitrates, each with a single keyframe (so no keyframe artefact), POS. Whiskers span the middle half of windows. <span class="tag real">42 subjects</span></p>
    <CategoryBars :items="bars" unit=" bpm" :ref-line="{ value: 5, label: '5 bpm' }" />
    <div class="callout">
      <strong>Reading it.</strong> At 800 to 1600 kbps the pulse largely survives. Below 400 kbps the encoder rounds the faint colour change away and the error explodes; at 100 kbps the median window is wrong by about a third of the heart rate. This is the "how much does compression degrade rPPG" curve.
    </div>
  </div>
</template>

<style scoped>
.strip { display: grid; grid-template-columns: 150px 1fr 92px; align-items: center; gap: 10px; margin: 6px 0; font-size: 0.82rem; }
.strip svg { width: 100%; height: 22px; background: var(--surface-2); border-radius: 4px; }
.sl { color: var(--ink-2); }
.sc { text-align: right; font-size: 0.74rem; color: var(--ink-2); }
@media (max-width: 600px) { .strip { grid-template-columns: 1fr; } .sc { text-align: left; } }
</style>
