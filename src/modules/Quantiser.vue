<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CategoryBars from '../components/CategoryBars.vue'
import LineChart from '../components/LineChart.vue'
import SyncVideos from '../components/SyncVideos.vue'
import { HERO, loadQp, loadSubject, refBvp, refHr } from '../lib/data.js'
import { codeBlock, qstep } from '../lib/quant.js'

const q = await loadQp()
const s = await loadSubject(HERO)
const fps = q.fps
const base = import.meta.env.BASE_URL + 'data/qp/'
const W = q.w, H = q.h

// ---------- images (decoded frames, lossless PNG) ----------
async function loadImg(url) {
  const im = new Image(); im.src = url; await im.decode()
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0)
  return x.getImageData(0, 0, im.width, im.height)
}
const imgs = Object.fromEntries(await Promise.all([['src', 'still_src.png'], ...q.qps.map((p) => [p, `still_qp${p}.png`])].map(async ([k, f]) => [k, await loadImg(base + f)])))

const qp = ref(34)
const row = computed(() => q.rows.find((r) => r.qp === qp.value))
const gain = ref(8)
const sel = ref({ bx: 20, by: 24 })        // selected 8x8 block (block coordinates)
const lum = (d, x, y) => { const i = (y * d.width + x) * 4; return 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2] }
const blockOf = (d, bx, by) => { const b = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b.push(lum(d, bx * 8 + x, by * 8 + y)); return b }

const cvOrig = ref(null), cvEnc = ref(null), cvDiff = ref(null), zOrig = ref(null), zEnc = ref(null), zDiff = ref(null)
const tmp = document.createElement('canvas')
function blit(cv, d, sx, sy, sw, sh, scale, mapper) {
  if (!cv) return
  tmp.width = d.width; tmp.height = d.height
  const t = tmp.getContext('2d')
  let img = d
  if (mapper) { img = new ImageData(d.width, d.height); mapper(img.data) }
  t.putImageData(img, 0, 0)
  cv.width = sw * scale; cv.height = sh * scale
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false
  c.drawImage(tmp, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale)
  return c
}
function diffMap(a, b, g) {
  return (out) => {
    for (let i = 0; i < out.length; i += 4) {
      const la = 0.299 * a.data[i] + 0.587 * a.data[i + 1] + 0.114 * a.data[i + 2]
      const lb = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2]
      const v = Math.max(0, Math.min(255, 128 + g * (lb - la)))
      out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255
    }
  }
}
const ZW = 40, ZS = 5                                   // zoom window (px) and its magnification
const zoomOrigin = computed(() => ({
  x: Math.max(0, Math.min(W - ZW, sel.value.bx * 8 + 4 - ZW / 2)),
  y: Math.max(0, Math.min(H - ZW, sel.value.by * 8 + 4 - ZW / 2)),
}))
function paint() {
  const a = imgs.src, b = imgs[qp.value]
  const full = (cv, d, mapper) => {
    const c = blit(cv, d, 0, 0, W, H, 1, mapper)
    if (c) { c.strokeStyle = '#ff2d7a'; c.lineWidth = 1.5; c.strokeRect(sel.value.bx * 8 + 0.5, sel.value.by * 8 + 0.5, 8, 8) }
  }
  full(cvOrig.value, a); full(cvEnc.value, b); full(cvDiff.value, a, diffMap(a, b, gain.value))
  const { x, y } = zoomOrigin.value
  blit(zOrig.value, a, x, y, ZW, ZW, ZS); blit(zEnc.value, b, x, y, ZW, ZW, ZS); blit(zDiff.value, a, x, y, ZW, ZW, ZS, diffMap(a, b, gain.value))
}
onMounted(paint)
watch([qp, gain, sel], () => nextTick(paint), { deep: true })

function pick(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H
  sel.value = { bx: Math.max(0, Math.min(W / 8 - 1, Math.floor(x / 8))), by: Math.max(0, Math.min(H / 8 - 1, Math.floor(y / 8))) }
}
// automatic picks: the flattest and the busiest 8x8 block in the picture
const spans = (() => {
  let flat = { v: Infinity }, busy = { v: -1 }
  for (let by = 4; by < H / 8 - 2; by++) for (let bx = 2; bx < W / 8 - 2; bx++) {
    const b = blockOf(imgs.src, bx, by), m = b.reduce((u, v) => u + v, 0) / 64, v = b.reduce((u, x) => u + (x - m) ** 2, 0) / 64
    if (v < flat.v) flat = { v, bx, by }
    if (v > busy.v) busy = { v, bx, by }
  }
  return { flat, busy }
})()
const setBlock = (p) => { sel.value = { bx: p.bx, by: p.by } }
setBlock(spans.flat)

// ---------- the transform-coder toy ----------
const blk = computed(() => blockOf(imgs.src, sel.value.bx, sel.value.by))
const coded = computed(() => codeBlock(blk.value, qp.value))
const shade = (v) => { const g = Math.round(Math.max(0, Math.min(255, v))); return `rgb(${g},${g},${g})` }
const lo = computed(() => Math.min(...blk.value, ...coded.value.out)), hi = computed(() => Math.max(...blk.value, ...coded.value.out))
const stretch = (v) => shade(((v - lo.value) / Math.max(1, hi.value - lo.value)) * 255)
const sizeMB = computed(() => (row.value.kbps * 60) / 8 / 1000)

// ---------- does the pulse survive? ----------
const ref0 = refBvp(s), truth = refHr(s)
const w = ref(8)
const a0 = computed(() => q.starts[w.value]), t0 = computed(() => a0.value / fps)
const nz = (x) => { const m = x.reduce((u, v) => u + v, 0) / x.length, sd = Math.sqrt(x.reduce((u, v) => u + (v - m) ** 2, 0) / x.length) || 1; return x.map((v) => (v - m) / sd) }
const seg = computed(() => {
  const a = a0.value, n = q.wn
  return [
    { name: 'Contact sensor (truth)', color: '#6b6a66', y: nz(Array.from(ref0.subarray(a, a + n))), x0: t0.value, dx: 1 / fps, width: 2 },
    { name: `Video pulse, QP ${qp.value}`, color: '#eb6834', y: nz(row.value.bvp.slice(a, a + n)), x0: t0.value, dx: 1 / fps, width: 2 },
  ]
})
const xs = q.starts.map((a) => (a + q.wn / 2) / fps)
const track = computed(() => [
  { name: 'Truth', color: '#6b6a66', x: xs, y: q.truth, width: 2 },
  { name: `QP ${qp.value}`, color: '#eb6834', x: xs, y: row.value.est, width: 2.2 },
])
const bars = computed(() => q.rows.map((r) => ({
  label: `QP ${r.qp}`, value: r.err_med, color: r.qp === qp.value ? 'var(--accent)' : 'var(--ink-3)',
  note: `${r.kbps.toFixed(0)} kbps · ${(r.err_bad * 100).toFixed(0)} % of windows off by >5`,
})))
const cliff = q.rows.find((r) => r.err_med > 5)
const prev = cliff ? q.rows[q.rows.indexOf(cliff) - 1] : null
const clipSel = ref(q.clips[1])
const clips = computed(() => [
  { name: 'crop', label: 'Original' },
  { name: `qp${clipSel.value}`, label: `Encoded at QP ${clipSel.value}` },
])
</script>

<template>
  <h1>The quantiser (QP), on real pictures</h1>
  <p class="lede">QP is the one dial that decides how much of the picture an encoder is willing to throw away. Here it is turned on a real frame from the recording, so you can see what it removes, what it keeps, and when the pulse goes with it.</p>

  <div class="card">
    <h3>1. Same frame, different QP settings</h3>
    <div class="callout">
      <strong>In plain words.</strong> QP stands for <b>quantiser parameter</b>, a number from 0 to 51. Low QP: the encoder stores the picture finely (big file, almost identical). High QP: it stores it roughly (small file, blurry or blocky). Every +6 doubles how coarsely it stores things. <b>What to do:</b> click a QP and compare the three pictures. The right picture shows only the <i>difference</i> from the original, multiplied up so you can see it (grey = no change). Click any picture to choose the tiny square to inspect.
    </div>
    <div class="controls"><div class="seg" role="group" aria-label="QP">
      <button v-for="p in q.qps" :key="p" :class="{ on: qp === p }" @click="qp = p">QP {{ p }}</button>
    </div>
      <label>Difference gain <input v-model.number="gain" type="range" min="1" max="30" step="1" /> <b>×{{ gain }}</b></label></div>
    <div class="trip">
      <figure><canvas ref="cvOrig" class="px" @click="pick" /><figcaption>Original</figcaption></figure>
      <figure><canvas ref="cvEnc" class="px" @click="pick" /><figcaption>Encoded, QP {{ qp }}</figcaption></figure>
      <figure><canvas ref="cvDiff" class="px" @click="pick" /><figcaption>Difference ×{{ gain }}</figcaption></figure>
    </div>
    <p class="small muted">Pink square = the 8×8 block chosen. Magnified below (5×, each pixel visible). <span class="tag real">real frame</span></p>
    <div class="trip z">
      <figure><canvas ref="zOrig" class="px" /><figcaption>Original</figcaption></figure>
      <figure><canvas ref="zEnc" class="px" /><figcaption>QP {{ qp }}</figcaption></figure>
      <figure><canvas ref="zDiff" class="px" /><figcaption>Difference ×{{ gain }}</figcaption></figure>
    </div>
    <div class="stats">
      <div class="stat"><b>{{ row.kbps.toFixed(0) }} kbps</b><span>bitrate this QP produced (a minute = {{ sizeMB.toFixed(1) }} MB)</span></div>
      <div class="stat"><b>{{ row.psnr.toFixed(1) }} dB</b><span>PSNR: picture fidelity, higher is closer to the original</span></div>
      <div class="stat"><b>{{ qstep(qp).toFixed(1) }}</b><span>rounding step size at QP {{ qp }}</span></div>
    </div>
    <div class="callout">
      <strong>What you should see.</strong> At low QP the difference is faint noise. As QP rises, fine texture (skin grain, hair strands) is smoothed away and blocky edges appear in the difference picture. Watch the bitrate number fall by a huge factor while the encoded picture still looks acceptable to the eye. That is why encoders are allowed to do this, and why the pulse, which the eye never sees, goes first.
    </div>
  </div>

  <div class="card">
    <h3>2. What "round more coarsely" means: one block of pixels</h3>
    <div class="callout">
      <strong>In plain words.</strong> An encoder does not store pixels directly. It first rewrites each small block as a recipe: <i>"this much flat brightness, plus this much left-to-right gradient, plus this much fine texture…"</i> (64 ingredients for an 8×8 block; that rewrite is called a <b>DCT</b>). Then it <b>rounds each ingredient to a multiple of the step size</b>. Ingredients smaller than half a step round to zero and cost nothing to store. Then it rebuilds the block from the rounded recipe. <b>What to do:</b> drag the QP, or jump to the flattest or busiest block, and watch how many ingredients survive.
    </div>
    <div class="controls">
      <button class="btn" @click="setBlock(spans.flat)">Flattest block (plain wall)</button>
      <button class="btn" @click="setBlock(spans.busy)">Busiest block (edge)</button>
      <div class="seg" role="group" aria-label="QP"><button v-for="p in q.qps" :key="p" :class="{ on: qp === p }" @click="qp = p">QP {{ p }}</button></div>
    </div>
    <div class="blocks">
      <figure>
        <div class="b8"><i v-for="(v, i) in blk" :key="i" :style="{ background: stretch(v) }" /></div>
        <figcaption>Original block<br><span class="muted">stretched to full contrast</span></figcaption>
      </figure>
      <figure>
        <div class="b8 co"><i v-for="(v, i) in coded.lev" :key="i" :class="{ zero: v === 0 }">{{ v === 0 ? '·' : v }}</i></div>
        <figcaption>Rounded recipe<br><span class="muted">whole numbers of steps; · = rounded to zero</span></figcaption>
      </figure>
      <figure>
        <div class="b8"><i v-for="(v, i) in coded.out" :key="i" :style="{ background: stretch(v) }" /></div>
        <figcaption>Rebuilt block<br><span class="muted">same contrast stretch</span></figcaption>
      </figure>
    </div>
    <div class="stats">
      <div class="stat"><b>{{ coded.nz }} of 64</b><span>ingredients kept (fewer = smaller file)</span></div>
      <div class="stat"><b>{{ coded.rms.toFixed(2) }}</b><span>average pixel error in this block (grey levels, 0–255)</span></div>
      <div class="stat"><b>{{ qstep(qp).toFixed(1) }}</b><span>step the ingredients were rounded to</span></div>
    </div>
    <p class="small muted">Simplified on purpose: this is an 8×8 DCT with plain rounding. H.264 uses 4×4 blocks, smarter rounding and prediction from neighbouring frames, but the step size rule (doubling every +6 QP) is the same. <span class="tag illus">teaching coder</span> run on <span class="tag real">real pixels</span></p>
    <div class="callout">
      <strong>Why this hurts a pulse.</strong> A heartbeat changes skin brightness by a few tenths of a grey level, about {{ q.pulse_std.toFixed(2) }} grey levels (standard deviation) in the face average. That is smaller than the step at every QP in this module (the smallest step here is {{ qstep(q.qps[0]).toFixed(1) }}), so on a single block it is simply rounded away. rPPG survives only because we average thousands of pixels, where the leftover rounding error is partly random and cancels. Next: how well does that rescue work?
    </div>
  </div>

  <div class="card">
    <h3>3. Does the pulse survive? Heart-rate error at each QP</h3>
    <div class="callout">
      <strong>In plain words.</strong> Same video, same face region, same algorithm (POS); only the QP changes. <b>What to do:</b> click a QP above (or here), then compare the orange wave with the grey truth and watch the heart-rate track on the right. Error is measured in beats per minute (bpm) per 10 s window; the median is the typical window.
    </div>
    <div class="controls"><div class="seg" role="group" aria-label="QP"><button v-for="p in q.qps" :key="p" :class="{ on: qp === p }" @click="qp = p">QP {{ p }}</button></div>
      <label>Window <input v-model.number="w" type="range" min="0" :max="q.starts.length - 1" step="1" /> {{ t0.toFixed(0) }} to {{ (t0 + q.wn / fps).toFixed(0) }} s</label></div>
    <div class="row">
      <div><LineChart :series="seg" :height="210" x-label="Time (s)" y-label="Pulse (normalised)" label="Pulse at this QP" /></div>
      <div><LineChart :series="track" :y-domain="[40, 185]" :height="210" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart-rate track at this QP" /></div>
    </div>
    <CategoryBars :items="bars" unit=" bpm" :ref-line="{ value: 5, label: '5 bpm' }" />
    <div class="stats">
      <div class="stat"><b>{{ row.err_med.toFixed(1) }} bpm</b><span>median error at QP {{ qp }}</span></div>
      <div class="stat"><b>{{ row.err_std.toFixed(3) }}</b><span>size of the face-average brightness error (grey levels, in the pulse band)</span></div>
      <div class="stat"><b>{{ q.pulse_std.toFixed(3) }}</b><span>size of the pulse itself (same units)</span></div>
    </div>
    <div v-if="cliff && prev" class="callout">
      <strong>What you should see.</strong> The heart rate is still right at QP {{ prev.qp }} ({{ prev.kbps.toFixed(0) }} kbps, median error {{ prev.err_med.toFixed(1) }} bpm) and wrong at QP {{ cliff.qp }} ({{ cliff.kbps.toFixed(0) }} kbps, median error {{ cliff.err_med.toFixed(1) }} bpm). It is a cliff, not a slope. Note the third number above: at QP {{ cliff.qp }} the face-average error ({{ cliff.err_std.toFixed(3) }}) is still smaller than the pulse ({{ q.pulse_std.toFixed(3) }}), yet the estimate already fails, so "error smaller than signal" is not a safe test. Bitrate depends on the video: this clip is a still, well-lit face, so it needs very few bits; QP is the dial that is comparable between videos.
    </div>
    <p class="small muted">One subject, one clip, one keyframe, single-threaded encodes (so these numbers repeat exactly). It shows the mechanism; the 42-subject version is in module 5. <span class="tag real">real encodes</span></p>
  </div>

  <div class="card">
    <h3>4. Watch it move</h3>
    <p class="small muted">The original and one encode, side by side, from the same transport. Pause on a frame and compare skin texture. <span class="tag real">real video</span></p>
    <div class="controls"><div class="seg" role="group" aria-label="Clip"><button v-for="p in q.clips" :key="p" :class="{ on: clipSel === p }" @click="clipSel = p">QP {{ p }}</button></div></div>
    <SyncVideos :clips="clips" :fps="fps" :duration="s.usable / fps" :start="20" :cols="2" />
  </div>
</template>

<style scoped>
.trip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 10px 0; }
.trip figure { margin: 0; }
.trip figcaption { font-size: 0.8rem; color: var(--ink-2); text-align: center; margin-top: 4px; }
canvas.px { width: 100%; height: auto; image-rendering: pixelated; border-radius: 6px; background: #888; cursor: crosshair; display: block; }
.trip.z canvas.px { cursor: default; }
.blocks { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; margin: 12px 0; }
.blocks figure { margin: 0; text-align: center; font-size: 0.8rem; color: var(--ink-2); }
.b8 { display: grid; grid-template-columns: repeat(8, 30px); grid-auto-rows: 30px; gap: 1px; margin-bottom: 6px; }
.b8 i { font-style: normal; display: grid; place-items: center; font-size: 0.7rem; }
.b8.co i { background: var(--surface-2); color: var(--ink); font-weight: 600; }
.b8.co i.zero { color: var(--ink-3); font-weight: 400; }
@media (max-width: 600px) { .trip { grid-template-columns: 1fr; } .b8 { grid-template-columns: repeat(8, 24px); grid-auto-rows: 24px; } }
</style>
