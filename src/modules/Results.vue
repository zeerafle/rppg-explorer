<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import { loadDamage, median } from '../lib/data.js'

const damage = await loadDamage()

// ---- risk-coverage: can QP tell us which windows to distrust? ----
const rows = damage.rows.filter((r) => r.cond.endsWith('-long') && r.q != null)
const within = ref(false)
const condMean = {}
for (const c of new Set(rows.map((r) => r.cond))) {
  const v = rows.filter((r) => r.cond === c).map((r) => r.q)
  condMean[c] = v.reduce((a, b) => a + b, 0) / v.length
}
const POINTS = Array.from({ length: 20 }, (_, i) => (i + 1) / 20)
function curve(order) {
  const e = order.map((r) => r.err)
  const cs = new Float64Array(e.length + 1)
  e.forEach((v, i) => (cs[i + 1] = cs[i] + v))
  return POINTS.map((c) => cs[Math.round(c * e.length)] / Math.round(c * e.length))
}
const meanErr = rows.reduce((a, r) => a + r.err, 0) / rows.length
const oracle = curve([...rows].sort((a, b) => a.err - b.err))
const qpKey = computed(() => (within.value ? (r) => r.q - condMean[r.cond] : (r) => r.q))
const qpCurve = computed(() => curve([...rows].sort((a, b) => qpKey.value(a) - qpKey.value(b))))
const aurc = (c) => c.reduce((a, b) => a + b, 0) / c.length
// what the receiver already knows without any QP: the nominal bitrate (ties broken by a fixed shuffle)
let seed = 11
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const shuffled = [...rows].map((r) => [rnd(), r]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
const bitrateCurve = curve(shuffled.sort((a, b) => parseInt(b.cond) - parseInt(a.cond)))
const series = computed(() => [
  { name: 'Perfect gate (knows the error)', color: '#1baf7a', x: POINTS.map((p) => p * 100), y: oracle, width: 1.8 },
  { name: within.value ? 'QP, compared only within one bitrate' : 'QP (lower QP = more trusted)', color: '#eb6834', x: POINTS.map((p) => p * 100), y: qpCurve.value, width: 2.4 },
  { name: 'Known bitrate only (no QP)', color: '#2a78d6', x: POINTS.map((p) => p * 100), y: bitrateCurve, width: 1.8, dash: '6 3' },
  { name: 'Random', color: '#6b6a66', x: POINTS.map((p) => p * 100), y: POINTS.map(() => meanErr), dash: '4 3', width: 1.4 },
])

const dmg = [['source', 'Uncompressed'], ['1600k-aq1-long', '1600k'], ['800k-aq1-long', '800k'], ['400k-aq1-long', '400k'], ['200k-aq1-long', '200k'], ['100k-aq1-long', '100k']].map(([c, l]) => ({
  l, v: median(damage.rows.filter((r) => r.cond === c).map((r) => r.err)),
}))
</script>

<template>
  <h1>What we found, and what we did not</h1>
  <p class="lede">Several questions were tested with decision rules written down before any model was fitted. One gave a clear positive, two came back empty, the rest are partial or still open. Empty results are useful here: they close dead ends and say what remains open.</p>

  <div class="card">
    <h3>Where each question stands</h3>
    <table class="t left">
      <thead><tr><th>Question</th><th style="text-align:left">Outcome</th><th style="text-align:left">Evidence</th></tr></thead>
      <tbody>
        <tr><td>How much does compression hurt rPPG?</td><td style="text-align:left"><b>Answered</b></td><td style="text-align:left">Median error {{ dmg[0].v.toFixed(1) }} → {{ dmg[1].v.toFixed(1) }} → {{ dmg[3].v.toFixed(1) }} → {{ dmg[5].v.toFixed(1) }} bpm at uncompressed, 1600k, 400k, 100k (42 subjects)</td></tr>
        <tr><td>Does the hidden keyframe cycle break it?</td><td style="text-align:left"><b>Yes, strongly</b></td><td style="text-align:left">2 s keyframes: 27 bpm vs 3 bpm for one keyframe, same bitrate (42 subjects); mechanism confirmed on 5</td></tr>
        <tr><td>Are deep networks fooled too?</td><td style="text-align:left"><b>Mostly no</b></td><td style="text-align:left">At 800k with 2 s keyframes: TS-CAN 2.0 bpm vs 1.3 with one keyframe; POS 21.3 vs 2.6, CHROM 17.4 vs 1.8. TS-CAN does break at 400k with 1 s keyframes (16.7 vs 2.8). PhysNet fails even without keyframes. 42 subjects, PURE-trained networks</td></tr>
        <tr><td>Can the decoder undo it?</td><td style="text-align:left"><b>Partly</b></td><td style="text-align:left">Roughly halves the error; misses the pre-set bar</td></tr>
        <tr><td>Does the spatial QP map hold information the pixels lost?</td><td style="text-align:left"><b>No (null)</b></td><td style="text-align:left">Adds R² ≤ 0.005 over decoded pixels (5 subjects)</td></tr>
        <tr><td>Does the codec's quantiser give a free reliability signal?</td><td style="text-align:left"><b>No (null)</b>, on still subjects</td><td style="text-align:left">+1.6 % area-under-risk, interval −0.18 to +0.63 includes 0 (42 subjects)</td></tr>
        <tr><td>Does speech make it worse, and can compression-aware methods cope?</td><td style="text-align:left"><b>Untested</b></td><td style="text-align:left">UBFC-rPPG subjects sit still</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h3>Why the "free reliability signal" came back empty</h3>
    <p class="small muted">Idea: the codec's own quantiser (QP) tells you how hard it had to round each frame, so a receiver could ignore heart rates measured when QP is high. Test: rank every window by QP, keep the most trusted fraction, and measure the average error of what is kept. A good gate drops steeply below the grey line as you keep less. <span class="tag real">42 subjects, long-GOP encodes</span></p>
    <div class="controls">
      <div class="seg" role="group" aria-label="Gate ranking">
        <button :class="{ on: !within }" @click="within = false">Rank all windows together</button>
        <button :class="{ on: within }" @click="within = true">Rank only within one bitrate</button>
      </div>
    </div>
    <LineChart :series="series" :height="280" x-label="Share of windows kept (%)" y-label="Mean error of kept windows (bpm)" label="Risk-coverage curves" />
    <div class="stats">
      <div class="stat"><b>{{ aurc(qpCurve).toFixed(1) }}</b><span>QP gate, mean error averaged over coverage (bpm)</span></div>
      <div class="stat"><b>{{ aurc(bitrateCurve).toFixed(1) }}</b><span>knowing only the bitrate</span></div>
      <div class="stat"><b>{{ meanErr.toFixed(1) }}</b><span>random</span></div>
      <div class="stat"><b>{{ aurc(oracle).toFixed(1) }}</b><span>perfect gate</span></div>
    </div>
    <div class="callout">
      <strong>Look at the settings.</strong> Ranked all together, QP is a decent gate, because a low QP means a high bitrate and a high bitrate means good video. But a receiver already knows the bitrate it was sent, and that alone (blue) gets almost as far. Rank only within one bitrate and QP's advantage mostly disappears: it is then barely better than random. In this dataset the QP scalar is almost a copy of the bitrate (correlation −0.92, and within one stream it varies by only 0.6 QP), so it can add little. The formal test, with signal-quality and motion features already in the model, found no significant gain.
    </div>
    <div class="callout warn">
      <strong>Not refuted for talking or moving faces.</strong> When content changes inside a fixed-bitrate stream, the encoder has to move QP to stay on budget, so QP could carry news the bitrate does not. UBFC-rPPG subjects sit still, so this was never exercised.
    </div>
  </div>

  <div class="card">
    <h3>What would settle the open questions</h3>
    <table class="t left">
      <tbody>
        <tr><td>Speech and head motion under compression</td><td style="text-align:left">A talking-face dataset with a contact sensor; rerun the same gate test and the same sweep</td></tr>
        <tr><td>Why is TS-CAN resistant, and do other deep models (e.g. direct-regression) resist too?</td><td style="text-align:left">Test the "frame differences average the jump away" idea; add a model trained on compressed video</td></tr>
        <tr><td>How common is the bad keyframe spacing in real calls?</td><td style="text-align:left">Measure the keyframe interval of real conferencing streams; the paper's relevance depends on it</td></tr>
        <tr><td>Is it only a CBR effect?</td><td style="text-align:left">Repeat with CRF and other rate control; our result is for constant bitrate</td></tr>
        <tr><td>Was 5 subjects enough for the mechanism?</td><td style="text-align:left">Run the harmonic test on all 42 (about an hour on Kaggle CPU)</td></tr>
      </tbody>
    </table>
  </div>
</template>
