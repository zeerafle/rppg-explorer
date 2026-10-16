<script setup>
// Phase regression on the real, deterministic CBR 800k encodes (rc-control-2026-10-14).
// Steps 1 to 5 run the correction live in the browser on four showcase subjects (src/lib/dsp.js, checked against
// the Python code in tests/phase.test.js); step 6 shows the 42-subject numbers computed in Python.
import { computed, ref } from 'vue'
import CategoryBars from '../components/CategoryBars.vue'
import LineChart from '../components/LineChart.vue'
import PhaseClock from '../components/PhaseClock.vue'
import Scatter from '../components/Scatter.vue'
import Stepper from '../components/Stepper.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { MODE_COLOR, MODE_LABEL, PHASE_NOTE, PHASE_SUBJECTS, loadPhaseSubject, loadPhaseSummary, median } from '../lib/data.js'

const subs = Object.fromEntries(await Promise.all(PHASE_SUBJECTS.map(async (id) => [id, await loadPhaseSubject(id)])))
const SUM = await loadPhaseSummary()
const SPACING = ['g30', 'g60', 'g120']
const CH = [['Red', '#d9433b'], ['Green', '#1baf7a'], ['Blue', '#2a78d6']]
const FIX = '#1baf7a', ASIS = '#eb6834'

const step = ref(0)
const sid = ref(8), mode = ref('g60'), K = ref(D.K_PHASE), ch = ref(1), t1 = ref(6.2), win = ref(4)

const sub = computed(() => subs[sid.value])
const fps = computed(() => sub.value.fps)
const n = computed(() => sub.value.n)
const usable = computed(() => sub.value.usable)
const cond = computed(() => sub.value.conds[mode.value])
const rgbU = (c) => c.rgb.subarray(0, usable.value * 3)

// ---- the live correction ----
const phase = computed(() => D.gopPhase(cond.value.isI, n.value))
const period = computed(() => D.keyframePeriod(cond.value.isI))
const reg = computed(() => D.regressOut(cond.value.rgb, D.phaseBasis(phase.value, K.value), sub.value.ba))
const bvpAsIs = computed(() => D.pos(rgbU(cond.value), fps.value, sub.value.ba))
const bvpFix = computed(() => D.pos(reg.value.out.subarray(0, usable.value * 3), fps.value, sub.value.ba))
const bvpLong = computed(() => D.pos(rgbU(sub.value.conds.long), fps.value, sub.value.ba))
const wins = computed(() => D.windowStarts(usable.value, fps.value))
const refHr = computed(() => { const r = D.bandpass(sub.value.ref.subarray(0, usable.value), sub.value.ba); return wins.value.starts.map((a) => D.hrBpm(r.subarray(a, a + wins.value.wn), fps.value)) })
const track = (b) => wins.value.starts.map((a) => D.hrBpm(b.subarray(a, a + wins.value.wn), fps.value))
const hrAsIs = computed(() => track(bvpAsIs.value)), hrFix = computed(() => track(bvpFix.value)), hrLong = computed(() => track(bvpLong.value))
const medErr = (h) => median(h.map((v, i) => Math.abs(v - refHr.value[i])))
const teeth = computed(() => D.keyframeHarmonics(fps.value, period.value))

// ---- step 1 ----
const tick = computed(() => cond.value.isI.map((i) => ({ x: i / fps.value, color: MODE_COLOR[mode.value], opacity: 0.55 })))
const SPAN = 12
const s1 = computed(() => [{ name: 'Average green of the face', color: '#6b6a66', y: reg.value.yb[1].subarray(0, SPAN * fps.value).map((v) => v * 100), x0: 0, dx: 1 / fps.value, width: 1.8 }])
const s1p = computed(() => [{ name: 'Phase', color: MODE_COLOR[mode.value], y: phase.value.subarray(0, SPAN * fps.value), x0: 0, dx: 1 / fps.value, width: 2, step: true }])
const i1 = computed(() => Math.min(n.value - 1, Math.round(t1.value * fps.value)))
const sinceKey = computed(() => { let k = 0; for (const i of cond.value.isI) if (i <= i1.value) k = i; return i1.value - k })

// ---- step 2 ----
const ys2 = computed(() => { const v = Array.from(reg.value.yb[ch.value]).map((x) => x * 100).sort((a, b) => a - b); const lo = v[Math.floor(v.length * 0.01)], hi = v[Math.floor(v.length * 0.99)]; const m = Math.max(Math.abs(lo), Math.abs(hi)); return [-Math.ceil(m * 10) / 10, Math.ceil(m * 10) / 10] })
const pts2 = computed(() => {
  const ph = phase.value, yb = reg.value.yb[ch.value], f = reg.value.fit[ch.value], out = []
  for (let i = 0; i < usable.value; i++) if (!Number.isNaN(ph[i])) out.push({ x: ph[i], y: yb[i] * 100, color: '#9a9892' })
  for (let i = 0; i < usable.value; i++) if (!Number.isNaN(ph[i])) out.push({ x: ph[i], y: f[i] * 100, color: CH[ch.value][1], title: `fit at phase ${ph[i].toFixed(2)}` })
  return out
})
const p2p = (c) => { const f = reg.value.fit[c]; let lo = Infinity, hi = -Infinity; for (let i = 0; i < usable.value; i++) { lo = Math.min(lo, f[i]); hi = Math.max(hi, f[i]) } return (hi - lo) * 100 }

// ---- step 3 ----
const explained = (c) => { const y = reg.value.yb[c], f = reg.value.fit[c]; let v = 0, r = 0; for (let i = 0; i < usable.value; i++) { v += y[i] ** 2; r += (y[i] - f[i]) ** 2 } return 1 - r / v }
const weights = computed(() => Array.from({ length: K.value }, (_, j) => ({ label: `${j + 1}× (${((j + 1) * 60 * fps.value / period.value).toFixed(0)} bpm)`, value: Math.hypot(reg.value.beta[ch.value][2 * j], reg.value.beta[ch.value][2 * j + 1]), color: CH[ch.value][1] })))

// ---- step 4 ----
const a0 = computed(() => wins.value.starts[Math.min(win.value, wins.value.starts.length - 1)])
const specOf = (b) => D.spectrum(b.subarray(a0.value, a0.value + wins.value.wn), fps.value)
const sA = computed(() => specOf(bvpAsIs.value)), sF = computed(() => specOf(bvpFix.value)), sL = computed(() => specOf(bvpLong.value))
const spec4 = computed(() => {
  const mx = Math.max(...sA.value.p, ...sF.value.p, ...sL.value.p)
  const mk = (sp, name, color, extra = {}) => ({ name, color, x: Array.from(sp.f, (v) => v * 60), y: Array.from(sp.p, (v) => v / mx), width: 2, ...extra })
  return [mk(sL.value, 'No keyframes (one keyframe)', '#6b6a66', { dash: '4 3', width: 1.4 }), mk(sA.value, 'Decoded as-is', ASIS, { opacity: 0.6 }), mk(sF.value, 'After phase regression', FIX, { width: 2.6 })]
})
const wi = computed(() => Math.min(win.value, wins.value.starts.length - 1))
const truth4 = computed(() => refHr.value[wi.value])
const pk = computed(() => ({ a: D.peakBpm(sA.value), f: D.peakBpm(sF.value), l: D.peakBpm(sL.value) }))
const marks4 = computed(() => [...teeth.value.map((t) => ({ x: t.bpm, color: MODE_COLOR[mode.value], dash: '2 3', opacity: 0.5 })), { x: truth4.value, label: `truth ${truth4.value.toFixed(0)}`, color: '#0b0b0b', dash: '5 2' }])
const good = (v) => (Math.abs(v - truth4.value) < 5 ? 'var(--green)' : 'var(--red)')

// ---- step 5 ----
const xs5 = computed(() => wins.value.starts.map((s) => (s + wins.value.wn / 2) / fps.value))
const track5 = computed(() => [
  { name: 'Truth (contact sensor)', color: '#6b6a66', x: xs5.value, y: refHr.value, width: 2.2 },
  { name: 'Decoded as-is', color: ASIS, x: xs5.value, y: hrAsIs.value, width: 1.8, opacity: 0.7 },
  { name: 'After phase regression', color: FIX, x: xs5.value, y: hrFix.value, width: 2.6 },
])
const hl5 = computed(() => teeth.value.map((h) => ({ y: h.bpm, label: `${h.bpm.toFixed(0)}`, color: MODE_COLOR[mode.value] })))
const med = computed(() => ({ a: medErr(hrAsIs.value), f: medErr(hrFix.value), l: medErr(hrLong.value) }))

// ---- step 6: 42 subjects (Python) ----
const T = computed(() => SUM.table[mode.value])
const METHODS = [['none', 'No correction', '#eb6834'], ['detrend', 'B1 detrend between keyframes', '#9a9892'], ['step', 'B2 step at each keyframe', '#9a9892'], ['notch', 'B3 notch on keyframe harmonics', '#9a9892'], ['phase', 'Phase regression', FIX], ['nlms', 'NLMS', '#9a9892']]
const bars6 = computed(() => [...METHODS.map(([k, label, color]) => ({ label, value: T.value[k].med, color })), { label: 'No keyframes (reference)', value: SUM.table.long.med, color: MODE_COLOR.long }])
const nearFar = computed(() => ['notch', 'phase'].flatMap((k) => [
  { label: `${k === 'notch' ? 'Notch' : 'Phase regression'}: far from a tooth`, value: T.value[k].far, color: k === 'phase' ? FIX : '#9a9892' },
  { label: `${k === 'notch' ? 'Notch' : 'Phase regression'}: near a tooth`, value: T.value[k].near, color: k === 'phase' ? '#c13b7a' : '#6b6a66' },
]))
const HARD = new Set([11, 15, 20, 34, 41])
const pts6 = computed(() => Object.entries(SUM.per).map(([id, r]) => ({ x: r[mode.value][0], y: r[mode.value][1], color: HARD.has(+id) ? '#c13b7a' : r[mode.value][1] <= r.long + 2 ? FIX : '#9a9892', title: `subject ${id}: ${r[mode.value][0].toFixed(1)} → ${r[mode.value][1].toFixed(1)} bpm (no keyframes: ${r.long.toFixed(1)})` })))
const recovered = computed(() => Object.values(SUM.per).filter((r) => r[mode.value][1] <= r.long + 2).length)
const gap = computed(() => (T.value.none.mae - T.value.phase.mae) / (T.value.none.mae - SUM.table.long.mae))

const STEPS = ['The phase', 'Fold and fit', 'How many waves', 'Subtract', 'Whole minute', '42 subjects']
</script>

<template>
  <h1>Undoing it: phase regression</h1>
  <p class="lede">The decoder knows which frames are keyframes, so it knows every frame's position in the cycle. Learn the average artefact at each position, subtract it, and run POS as usual. No training, no labels, milliseconds. Here it is on real recordings: CBR 800 kbps, deterministic single-thread encodes. Steps 1 to 5 run live in your browser on four subjects; step 6 is all 42. <span class="tag real">real data</span></p>

  <div class="card sticky">
    <div class="controls">
      <label>Subject <span class="seg"><button v-for="id in PHASE_SUBJECTS" :key="id" :class="{ on: sid === id }" :title="PHASE_NOTE[id]" @click="sid = id">{{ id }}</button></span></label>
      <label>Keyframe every <span class="seg"><button v-for="m in SPACING" :key="m" :class="{ on: mode === m }" @click="mode = m">{{ { g30: '1 s', g60: '2 s', g120: '4 s' }[m] }}</button></span></label>
      <span class="small muted">Subject {{ sid }}: {{ PHASE_NOTE[sid] }}. Median error, {{ MODE_LABEL[mode].toLowerCase() }}: <b>{{ SUM.per[sid][mode][0].toFixed(1) }} → {{ SUM.per[sid][mode][1].toFixed(1) }} bpm</b> (none → phase; no keyframes {{ SUM.per[sid].long.toFixed(1) }}).</span>
    </div>
  </div>

  <Stepper v-model="step" :steps="STEPS">
    <template #default="{ index }">
      <div v-if="index === 0" class="card">
        <h3>1. The file tells us where every frame is in its cycle</h3>
        <p class="small muted">The stream marks each frame as a keyframe (I) or not (P/B). Between two keyframes the phase climbs from 0 to 1. This is the <i>only</i> thing the correction reads from the file: no pixels, no bitrate. Drag along the time axis.</p>
        <LineChart :series="s1" :markers="tick" :playhead="t1" scrub :x-domain="[0, SPAN]" :height="180" x-label="Time (s)" y-label="Green, % of average (band-passed)" label="Green trace with keyframes" @scrub="(x) => (t1 = Math.max(0, Math.min(SPAN, x)))" />
        <LineChart :series="s1p" :markers="tick" :playhead="t1" scrub :x-domain="[0, SPAN]" :y-domain="[0, 1.05]" :height="120" x-label="Time (s)" y-label="Phase" label="Phase of each frame" @scrub="(x) => (t1 = Math.max(0, Math.min(SPAN, x)))" />
        <div class="row">
          <PhaseClock :phase="phase[i1]" :size="130" :color="MODE_COLOR[mode]" />
          <div class="small">At {{ t1.toFixed(1) }} s (frame {{ i1 }}): {{ sinceKey }} frames since the last keyframe, cycle of {{ period }} frames, phase {{ sinceKey }} / {{ period }} = <b>{{ phase[i1].toFixed(2) }}</b>. The cycle lengths are measured from the real stream, so an occasional extra keyframe (a scene cut) is handled too.</div>
        </div>
      </div>

      <div v-else-if="index === 1" class="card">
        <h3>2. Fold the whole clip by phase and fit the shape</h3>
        <p class="small muted">Grey dots: every frame of the recording, placed by its phase, with its colour change on the up-down axis (band-passed, as % of the average colour). Seen one cycle at a time, the keyframe pattern hides under pulse and noise. Stacked, a repeating shape appears. Coloured dots: what the fit says each frame's pattern is. It is a smooth curve through the cloud.</p>
        <div class="controls"><label>Colour channel <span class="seg"><button v-for="([name], c) in CH" :key="name" :class="{ on: ch === c }" @click="ch = c">{{ name }}</button></span></label></div>
        <Scatter :points="pts2" :diagonal="false" :x-domain="[0, 1]" :y-domain="ys2" :height="320" x-label="Phase (0 = keyframe, 1 = next keyframe)" y-label="Colour change (%)" label="Frames folded by phase, with the fit" />
        <div class="stats">
          <div v-for="([name, color], c) in CH" :key="name" class="stat" :style="{ borderLeft: `4px solid ${color}` }"><b>{{ p2p(c).toFixed(2) }} %</b><span>{{ name }}: height of the fitted pattern</span></div>
        </div>
        <div class="callout">
          <strong>One fit per channel.</strong> Switch the channel: the pattern is a similar size in all three here, but its shape need not match. POS keeps the kind of change that differs between channels, which is why it can mistake this artefact for a pulse. So each channel gets its own fit, subtracted <i>before</i> POS.
        </div>
      </div>

      <div v-else-if="index === 2" class="card">
        <h3>3. How many waves? (K = 6 in the thesis)</h3>
        <p class="small muted">The fitted shape is a sum of K pairs of sine and cosine waves of the phase, with weights chosen by least squares, as in the previous module. <Tex tex="y_t \approx \sum_{k=1}^{K} a_k\sin(2\pi k\varphi_t)+b_k\cos(2\pi k\varphi_t)" />. The setting below applies to every other step too.</p>
        <div class="controls"><label>Pairs of waves, K <input v-model.number="K" type="range" min="1" max="12" step="1" /> <b>{{ K }}</b></label>
          <label>Channel <span class="seg"><button v-for="([name], c) in CH" :key="name" :class="{ on: ch === c }" @click="ch = c">{{ name }}</button></span></label></div>
        <h4>Weights of each wave ({{ CH[ch][0] }})</h4>
        <CategoryBars :items="weights" :decimals="4" />
        <table class="t">
          <thead><tr><th>Channel</th><th>Share of the band-passed colour variance the fit explains</th></tr></thead>
          <tbody><tr v-for="([name], c) in CH" :key="name"><td>{{ name }}</td><td>{{ (explained(c) * 100).toFixed(1) }} %</td></tr></tbody>
        </table>
        <div class="callout warn">
          <strong>Two ways to be wrong.</strong> Too few waves leave a sharp part of the pattern behind. Too many and the fit starts to follow noise and, worse, whatever part of the pulse lines up with the cycle. The share of variance rises with K by construction, so a higher share is <i>not</i> the same as a better heart rate; look at steps 4 and 5 for that. Try K = 1 and K = 12 on subject 33.
        </div>
      </div>

      <div v-else-if="index === 3" class="card">
        <h3>4. Subtract, run POS, read the spectrum</h3>
        <p class="small muted">One 10 s window. Grey dashed: the same video encoded with a single keyframe, where there is nothing to remove. Orange: decoded as-is. Green: after subtracting the fit. Dotted lines are the keyframe teeth.</p>
        <div class="controls"><label>Window <input v-model.number="win" type="range" min="0" :max="wins.starts.length - 1" step="1" /> {{ (a0 / fps).toFixed(0) }} to {{ ((a0 + wins.wn) / fps).toFixed(0) }} s</label></div>
        <LineChart :series="spec4" :markers="marks4" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :height="260" x-label="Heart rate (bpm)" y-label="Power (shared scale)" label="Spectra with and without the correction" />
        <div class="stats">
          <div class="stat"><b>{{ truth4.toFixed(0) }}</b><span>truth (bpm)</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${good(pk.l)}` }"><b>{{ pk.l.toFixed(0) }}</b><span>no keyframes</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${good(pk.a)}` }"><b>{{ pk.a.toFixed(0) }}</b><span>as-is</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${good(pk.f)}` }"><b>{{ pk.f.toFixed(0) }}</b><span>corrected</span></div>
        </div>
        <div class="callout">
          <strong>Why the pulse survives.</strong> The heartbeat is not in step with the keyframes, so across ~30 cycles it averages out of the fit and is left alone (previous module, step 2). When the heart rate sits on a tooth, it <i>is</i> nearly in step; slide the window to a moment when the truth is near a dotted line to look for it. That is our reading, not yet tested window by window.
        </div>
      </div>

      <div v-else-if="index === 4" class="card">
        <h3>5. Over the whole minute</h3>
        <p class="small muted">Heart rate in every 10 s window. Orange wanders onto the teeth (horizontal lines). Green is the same video after the correction.</p>
        <LineChart :series="track5" :hlines="hl5" :y-domain="[40, 185]" :height="300" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart-rate track before and after" />
        <div class="stats">
          <div class="stat"><b>{{ med.l.toFixed(1) }} bpm</b><span>no keyframes</span></div>
          <div class="stat" style="border-left: 4px solid var(--red)"><b>{{ med.a.toFixed(1) }} bpm</b><span>as-is</span></div>
          <div class="stat" style="border-left: 4px solid var(--green)"><b>{{ med.f.toFixed(1) }} bpm</b><span>corrected (K = {{ K }})</span></div>
        </div>
        <div class="callout warn">
          <strong>One subject is not the result.</strong> Switch between subjects 8, 38, 33 and 11 and between spacings. Subject 8 and 38 are fixed at every spacing; 33 is fixed at 2 s but not at 1 s; 11 is not fixed anywhere, though it is fine with no keyframes at all. The next step shows how common each case is.
        </div>
      </div>

      <div v-else class="card">
        <h3>6. All 42 subjects, and where it fails</h3>
        <p class="small muted">CBR 800 kbps, {{ MODE_LABEL[mode].toLowerCase() }}, POS, median error over {{ SUM.table[mode].none.n }} windows. Computed in Python by the experiment, not in the browser. <span class="tag real">42 subjects</span></p>
        <CategoryBars :items="bars6" unit=" bpm" :ref-line="{ value: SUM.table.long.med, label: 'no keyframes' }" />
        <div class="callout">
          <strong>Phase regression is the best simple fix at every spacing.</strong> At 2 s it takes the error from {{ SUM.table.g60.none.med.toFixed(1) }} to {{ SUM.table.g60.phase.med.toFixed(1) }} bpm ({{ SUM.table.long.med.toFixed(1) }} with no keyframes), beating the detrend, step and notch baselines. Median error is what this table reports; on <i>mean</i> error it is less rosy: {{ T.none.mae.toFixed(1) }} → {{ T.phase.mae.toFixed(1) }} bpm against {{ SUM.table.long.mae.toFixed(1) }} with no keyframes, which closes {{ (gap * 100).toFixed(0) }} % of the gap.
        </div>

        <h4>Failure 1: the pulse is on a tooth</h4>
        <p class="small muted">Windows where the true heart rate is within 1.5 bpm of a keyframe harmonic ({{ (T.phase.near_share * 100).toFixed(0) }} % of windows at this spacing). The notch filter fails there, as predicted. Phase regression holds at 2 s, but not at 1 s.</p>
        <CategoryBars :items="nearFar" unit=" bpm" />

        <h4>Failure 2: some subjects stay broken</h4>
        <p class="small muted">Each dot is a subject. Left to right: error as-is; bottom to top: error after correction. Below the dashed diagonal means better. Green dots are within 2 bpm of that subject's own no-keyframe error ({{ recovered }} of {{ SUM.subjects }}); the magenta ones are the five hard subjects 11, 15, 20, 34 and 41.</p>
        <Scatter :points="pts6" :x-domain="[0, 65]" :y-domain="[0, 65]" :height="340" x-label="Median error as-is (bpm)" y-label="Median error after correction (bpm)" label="Per-subject error before and after" />

        <h4>Failure 3: nothing to fit</h4>
        <p class="small muted">Intra-refresh, the common real-time setting, never sends a whole keyframe, so there is no cycle and no phase. The correction is simply undefined.</p>
        <div class="callout warn">
          <strong>Where this leaves the thesis.</strong> A one-line, training-free fix removes most of the problem for periodic keyframes at 800 kbps. What is left (1 s keyframes near a tooth, low bitrates, hard subjects, intra-refresh) is where a learned correction has to prove itself against this baseline (H4).
        </div>
      </div>
    </template>
  </Stepper>
</template>

<style scoped>
.sticky { position: sticky; top: 49px; z-index: 3; margin-bottom: 14px; }
@media (max-height: 820px) { .sticky { position: static; } }
.row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.row > .small { flex: 1; min-width: 220px; }
</style>
