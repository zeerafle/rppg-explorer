<script setup>
// "Why does the heart rate read 60?" in eight steps. Every curve is computed in the browser from the
// shipped traces (the same arrays the experiments used, or, for subject 10, the shipped streams).
import { computed, ref } from 'vue'
import CategoryBars from '../components/CategoryBars.vue'
import LineChart from '../components/LineChart.vue'
import Scatter from '../components/Scatter.vue'
import Stepper from '../components/Stepper.vue'
import SyncVideos from '../components/SyncVideos.vue'
import * as D from '../lib/dsp.js'
import { HERO, MODE_COLOR, MODE_LABEL, SUBJECTS, hrTrack, loadDamage, loadEncodeVariance, loadSubject, median, periodOf, pulse, refHr, windows } from '../lib/data.js'

const subs = Object.fromEntries(await Promise.all(SUBJECTS.map(async (id) => [id, await loadSubject(id)])))
const damage = await loadDamage()
const encVar = await loadEncodeVariance()
const rng = (m) => { const v = encVar?.[m]?.default_threads ?? []; return v.length ? `${Math.min(...v)} to ${Math.max(...v)}` : '?' }

const step = ref(0)
const sid = ref(HERO)
const mode = ref('g60')
const win = ref(5)
const SPACING = ['g30', 'g60', 'g120']

const sub = computed(() => subs[sid.value])
const fps = computed(() => sub.value.fps)
const period = computed(() => periodOf(sub.value, mode.value))
const teeth = computed(() => D.keyframeHarmonics(fps.value, period.value))
const wins = computed(() => windows(sub.value))
const nWin = computed(() => wins.value.starts.length)
const wi = computed(() => Math.min(win.value, nWin.value - 1))
const a0 = computed(() => wins.value.starts[wi.value])
const near = (b, list, tol = 1.5) => list.some((h) => Math.abs(b - h.bpm) <= tol)
const medErrOf = (s, cond) => median(hrTrack(s, cond).map((v, i) => Math.abs(v - refHr(s)[i])))
const medErr = (cond) => medErrOf(sub.value, cond)

// ---------- step 1: videos ----------
// the clips on disk are subject 10's, so this step always describes subject 10
const hero = subs[HERO]
const vids = computed(() => [
  { name: 'long', label: `${MODE_LABEL.long}: subject ${HERO}'s median heart-rate error ${medErrOf(hero, 'long').toFixed(1)} bpm` },
  { name: mode.value, label: `${MODE_LABEL[mode.value]}: subject ${HERO}'s median heart-rate error ${medErrOf(hero, mode.value).toFixed(1)} bpm` },
])
const strip = (m) => hero.conds[m].isI.filter((i) => i < 14 * hero.fps)

// ---------- step 2: the jump ----------
const level = computed(() => { const r = sub.value.conds.source.rgb; let t = 0; for (let i = 0; i < sub.value.usable; i++) t += r[i * 3 + 1]; return t / sub.value.usable })
const errG = (cond) => {
  const a = sub.value.conds[cond].rgb, b = sub.value.conds.source.rgb
  return Float64Array.from({ length: sub.value.usable }, (_, i) => a[i * 3 + 1] - b[i * 3 + 1])
}
const errMode = computed(() => errG(mode.value)), errLong = computed(() => errG('long'))
const t2 = ref(14)
const jumpSeries = computed(() => {
  const hp = (x) => D.highpassMA(x, Math.round(4 * fps.value))
  const a = Math.round(t2.value * fps.value), n = Math.round(10 * fps.value)
  return [
    { name: 'Single keyframe', color: MODE_COLOR.long, y: hp(errLong.value).subarray(a, a + n), x0: t2.value, dx: 1 / fps.value, width: 1.5 },
    { name: MODE_LABEL[mode.value], color: MODE_COLOR[mode.value], y: hp(errMode.value).subarray(a, a + n), x0: t2.value, dx: 1 / fps.value, width: 1.7 },
  ]
})
const kfMarkers = computed(() => sub.value.conds[mode.value].isI.map((i) => ({ x: i / fps.value, color: MODE_COLOR[mode.value], opacity: 0.5 })))
const fold = computed(() => {
  const isI = sub.value.conds[mode.value].isI
  return period.value ? D.foldCycles(errMode.value, isI, Math.round(period.value)) : null
})
const foldSeries = computed(() => {
  if (!fold.value) return []
  const x0 = 0, dx = 1 / fps.value
  return [
    { name: 'Average over all cycles', color: MODE_COLOR[mode.value], y: fold.value.mean, x0, dx, width: 2.4 },
    { name: '± 1 s.d.', color: MODE_COLOR[mode.value], y: fold.value.mean.map((v, i) => v + fold.value.sd[i]), x0, dx, width: 1, opacity: 0.35 },
    { color: MODE_COLOR[mode.value], y: fold.value.mean.map((v, i) => v - fold.value.sd[i]), x0, dx, width: 1, opacity: 0.35 },
  ]
})
const saw = computed(() => (fold.value ? Math.max(...fold.value.mean) - Math.min(...fold.value.mean) : 0))
const pulseGrey = computed(() => 2.83 * D.std(D.bandpass(Float64Array.from({ length: sub.value.usable }, (_, i) => sub.value.conds.source.rgb[i * 3 + 1] / level.value - 1), sub.value.ba)) * level.value)

// ---------- step 3: the comb ----------
const K = ref(1)
const toy = computed(() => {
  const n = 240, xs = Array.from({ length: n }, (_, i) => i / (n - 1) * 2)
  const target = (p) => Math.PI * (0.5 - (p % 1))
  return [
    { name: 'Repeating ramp (what a keyframe cycle looks like)', color: '#6b6a66', x: xs, y: xs.map(target), dash: '4 3', width: 1.4 },
    { name: `Sum of the first ${K.value} sine wave${K.value > 1 ? 's' : ''}`, color: '#eb6834', x: xs, y: xs.map((p) => { let v = 0; for (let k = 1; k <= K.value; k++) v += Math.sin(2 * Math.PI * k * p) / k; return v }), width: 2.2 },
  ]
})
const combSpec = computed(() => {
  const x = D.highpassMA(errMode.value, Math.round(4 * fps.value))
  const sp = D.spectrum(x, fps.value, { range: [0.2, 3.4], nfft: 1 << 16 })
  const mx = Math.max(...sp.p)
  return { s: [{ name: `Colour error of ${MODE_LABEL[mode.value]}`, color: MODE_COLOR[mode.value], x: Array.from(sp.f, (v) => v * 60), y: Array.from(sp.p, (v) => v / mx), width: 1.8 }] }
})
const combMarks = computed(() => {
  if (!period.value) return []
  const out = []
  for (let k = 1; (60 * k * fps.value) / period.value < 205; k++) out.push({ x: (60 * k * fps.value) / period.value, label: `${k}×`, color: 'var(--ink-2)', dash: '2 3' })
  return out
})
const fundamental = computed(() => (period.value ? (60 * fps.value) / period.value : 0))

// ---------- step 4: comb beats pulse ----------
const posSrc = computed(() => pulse(sub.value, 'source'))
const posMode = computed(() => pulse(sub.value, mode.value))
const seg = (arr) => arr.subarray(a0.value, a0.value + wins.value.wn)
const specSrc = computed(() => D.spectrum(seg(posSrc.value), fps.value))
const specMode = computed(() => D.spectrum(seg(posMode.value), fps.value))
const truthBpm = computed(() => refHr(sub.value)[wi.value])
const win4 = computed(() => {
  const mx = Math.max(...specSrc.value.p, ...specMode.value.p)
  const toS = (sp, name, color, extra = {}) => ({ name, color, x: Array.from(sp.f, (v) => v * 60), y: Array.from(sp.p, (v) => v / mx), width: 1.8, ...extra })
  return [toS(specSrc.value, 'Uncompressed video', '#6b6a66', { dash: '4 3', width: 1.4 }), toS(specMode.value, MODE_LABEL[mode.value], MODE_COLOR[mode.value], { width: 2.2 })]
})
const peakMode = computed(() => D.peakBpm(specMode.value)), peakSrc = computed(() => D.peakBpm(specSrc.value))
const onTooth = computed(() => near(peakMode.value, teeth.value))
const ratio = computed(() => {
  const u = pulse(sub.value, 'source'), d = pulse(sub.value, mode.value)
  const diff = d.map((v, i) => v - u[i])
  return { pulse: D.std(u), art: D.std(diff) }
})

// ---------- step 5: whole minute ----------
const track = computed(() => {
  const xs = wins.value.starts.map((s) => (s + wins.value.wn / 2) / fps.value)
  return [
    { name: 'Truth (contact sensor)', color: '#6b6a66', x: xs, y: refHr(sub.value), width: 2.2 },
    { name: `POS on ${MODE_LABEL[mode.value]}`, color: MODE_COLOR[mode.value], x: xs, y: hrTrack(sub.value, mode.value), width: 2.2 },
    { name: 'POS on one keyframe', color: MODE_COLOR.long, x: xs, y: hrTrack(sub.value, 'long'), width: 1.4, opacity: 0.8 },
  ]
})
const shareOne = (id, m) => {
  const s = subs[id], p = periodOf(s, m)
  if (!p) return null
  const tt = D.keyframeHarmonics(s.fps, p)
  const hr = hrTrack(s, m), rf = refHr(s)
  return { pos: hr.filter((v) => near(v, tt)).length / hr.length, chance: rf.filter((v) => near(v, tt)).length / rf.length, n: hr.length }
}
const share = computed(() => shareOne(sid.value, mode.value))
const hlines = computed(() => teeth.value.map((h) => ({ y: h.bpm, label: `${h.bpm.toFixed(0)}`, color: MODE_COLOR[mode.value] })))

// ---------- step 6: all subjects, all spacings ----------
const pooled = SPACING.map((m) => {
  let pos = 0, ch = 0, n = 0
  const errs = []
  for (const id of SUBJECTS) {
    const sh = shareOne(id, m)
    pos += sh.pos * sh.n; ch += sh.chance * sh.n; n += sh.n
    const hr = hrTrack(subs[id], m), rf = refHr(subs[id])
    hr.forEach((v, i) => errs.push(Math.abs(v - rf[i])))
  }
  return { m, pos: pos / n, chance: ch / n, n, med: median(errs) }
})
const longMed = median(SUBJECTS.flatMap((id) => { const hr = hrTrack(subs[id], 'long'), rf = refHr(subs[id]); return hr.map((v, i) => Math.abs(v - rf[i])) }))
const points = computed(() => SUBJECTS.flatMap((id) => {
  const hr = hrTrack(subs[id], mode.value), rf = refHr(subs[id])
  return hr.map((v, i) => ({ x: rf[i], y: v, color: near(v, teeth.value) ? MODE_COLOR[mode.value] : '#9a9892', title: `subject ${id}: truth ${rf[i].toFixed(0)}, video ${v.toFixed(0)} bpm` }))
}))

// ---------- step 7: undoing it ----------
const fixOn = ref(true)
const hrPhase = (s, m) => {
  const { wn, starts } = windows(s)
  const b = s.conds[m].bvpPhase
  return starts.map((a) => D.hrBpm(b.subarray(a, a + wn), s.fps))
}
const fixed = SPACING.map((m) => {
  const before = [], after = []
  for (const id of SUBJECTS) {
    const rf = refHr(subs[id])
    hrTrack(subs[id], m).forEach((v, i) => before.push(Math.abs(v - rf[i])))
    hrPhase(subs[id], m).forEach((v, i) => after.push(Math.abs(v - rf[i])))
  }
  return { m, before: median(before), after: median(after) }
})
const specFix = computed(() => {
  const b = sub.value.conds[mode.value].bvpPhase
  return D.spectrum(b.subarray(a0.value, a0.value + wins.value.wn), fps.value)
})
const win7 = computed(() => {
  const mx = Math.max(...specMode.value.p, ...specFix.value.p)
  const mk = (sp, name, color, extra = {}) => ({ name, color, x: Array.from(sp.f, (v) => v * 60), y: Array.from(sp.p, (v) => v / mx), width: 2, ...extra })
  return [mk(specMode.value, 'Decoded as-is', MODE_COLOR[mode.value], { opacity: fixOn.value ? 0.4 : 1 }), ...(fixOn.value ? [mk(specFix.value, 'After removing the keyframe pattern', '#1baf7a', { width: 2.4 })] : [])]
})
const fixBars = fixed.flatMap((f) => [
  { label: `${MODE_LABEL[f.m]}: as-is`, value: f.before, color: MODE_COLOR[f.m] },
  { label: `${MODE_LABEL[f.m]}: corrected`, value: f.after, color: '#1baf7a' },
])

// ---------- step 8: 42 subjects ----------
const k800 = [['source', 'Uncompressed', MODE_COLOR.source], ['800k-aq1-long', 'One keyframe', MODE_COLOR.long], ['800k-aq1-intra-refresh', 'Intra-refresh', MODE_COLOR['intra-refresh']], ['800k-aq1-g60', 'Keyframe every 2 s', MODE_COLOR.g60]].map(([c, label, color]) => {
  const e = damage.rows.filter((r) => r.cond === c).map((r) => r.err)
  return { label, value: median(e), color, bad: e.filter((v) => v > 5).length / e.length }
})

const STEPS = ['Same video', 'Colour jumps', 'A comb', 'Comb wins', 'Whole minute', 'Moves with spacing', 'Undo it?', '42 subjects']
</script>

<template>
  <h1>The keyframe artefact, step by step</h1>
  <p class="lede">Same video, same bitrate, same algorithm. Change one encoder setting, how often it stores a full keyframe, and the measured heart rate can collapse to about 60 bpm whatever the real value. These eight steps show why.</p>

  <div class="card sticky">
    <div class="controls">
      <label>Subject <span class="seg"><button v-for="id in SUBJECTS" :key="id" :class="{ on: sid === id }" @click="sid = id">{{ id }}</button></span></label>
      <label>Keyframe every <span class="seg"><button v-for="m in SPACING" :key="m" :class="{ on: mode === m }" @click="mode = m">{{ { g30: '1 s', g60: '2 s', g120: '4 s' }[m] }}</button></span></label>
      <span class="small muted">Applies to all steps. 800 kbps, POS, subject's own recording.</span>
    </div>
  </div>

  <Stepper v-model="step" :steps="STEPS">
    <template #default="{ index }">
      <!-- 1 ------------------------------------------------------------------------------>
      <div v-if="index === 0" class="card">
        <h3>1. Two encodes of one video. Can you see a difference?</h3>
        <p class="small muted">Both were compressed to exactly 800 kbps by the same encoder with the same settings, except how often it inserts a keyframe. Play them side by side. <span class="tag real">real video, subject 10</span></p>
        <SyncVideos :clips="vids.map((v) => ({ ...v, name: v.name }))" :fps="hero.fps" :duration="hero.usable / hero.fps" :start="10" :cols="2" />
        <div v-for="m in ['long', mode]" :key="m" class="strip">
          <span class="sl">{{ MODE_LABEL[m] }}</span>
          <svg :viewBox="`0 0 ${Math.round(14 * hero.fps)} 14`" preserveAspectRatio="none"><rect x="0" y="6" :width="Math.round(14 * hero.fps)" height="2" fill="var(--line)" /><rect v-for="i in strip(m)" :key="i" :x="i - 0.6" y="0" width="1.4" height="14" :fill="MODE_COLOR[m]" /></svg>
        </div>
        <div class="callout">
          <strong>To the eye: near-identical.</strong> To the heart-rate algorithm, not even close: with frequent keyframes POS often reports a number near 60 bpm whatever the person's pulse is. The clips are always subject 10's; the buttons above change the charts and numbers in the other steps.
        </div>
      </div>

      <!-- 2 ------------------------------------------------------------------------------>
      <div v-else-if="index === 1" class="card">
        <h3>2. At every keyframe the face colour jumps, then drifts</h3>
        <p class="small muted">We subtract the original from each decoded video and look at the average green of the face. Vertical lines = keyframes. A slow trend is removed so the beat is visible. <span class="tag real">real data</span></p>
        <LineChart :series="jumpSeries" :markers="kfMarkers" :x-domain="[t2, t2 + 10]" :height="240" x-label="Time (s)" y-label="Decoded − original (grey levels)" label="Colour error over time" />
        <div class="controls"><label>Start <input v-model.number="t2" type="range" min="1" :max="Math.floor(sub.usable / fps - 11)" step="1" /> {{ t2 }} s</label></div>
        <h3>Fold all cycles on top of each other</h3>
        <p class="small muted">Cut the error at every keyframe, line the pieces up and average them. Whatever repeats survives; noise washes out.</p>
        <LineChart v-if="fold" :series="foldSeries" :height="220" x-label="Time since keyframe (s)" y-label="Grey levels" :legend="true" label="Folded error" />
        <div v-if="fold" class="stats">
          <div class="stat"><b>{{ saw.toFixed(2) }}</b><span>grey levels, sawtooth height</span></div>
          <div class="stat"><b>{{ pulseGrey.toFixed(2) }}</b><span>grey levels, pulse height (approx.)</span></div>
          <div class="stat"><b>{{ fold.cycles }}</b><span>cycles averaged</span></div>
        </div>
        <div class="callout">
          <strong>What the data show.</strong> Right at each keyframe the face's average brightness jumps (here by roughly {{ saw.toFixed(1) }} grey levels, peak to trough), then relaxes over the following frames, until the next keyframe jumps it again. A keyframe is coded on its own with its own rounding; the P-frames after it inherit that and gradually pull the picture back toward the source. We measure the effect, not the encoder's inner workings. The sawtooth is about as tall as the pulse itself, which is why it matters.
        </div>
      </div>

      <!-- 3 ------------------------------------------------------------------------------>
      <div v-else-if="index === 2" class="card">
        <h3>3. A repeating jump contains a whole family of frequencies</h3>
        <p class="small muted">Fourier's rule: any pattern that repeats every {{ period ? (period / fps).toFixed(1) : '…' }} s can be built from sine waves at exactly {{ fundamental.toFixed(1) }} bpm and its whole multiples. Try it with a ramp. <span class="tag illus">illustration</span></p>
        <div class="controls"><label>Sine waves added <input v-model.number="K" type="range" min="1" max="12" step="1" /> <b>{{ K }}</b></label></div>
        <LineChart :series="toy" :x-domain="[0, 2]" :y-domain="[-2, 2]" :height="200" x-label="Number of cycles" label="Ramp built from sine waves" />
        <p class="small muted">One sine wave is a rough ramp. Each extra multiple (2×, 3×, …) sharpens the edge. Real sawtooth jumps need many; they are all there at once.</p>

        <h3>The real error signal has exactly that comb</h3>
        <LineChart :series="combSpec.s" :x-domain="[12, 205]" :y-domain="[0, 1.1]" :markers="combMarks" :bands="[{ x0: 42, x1: 180, color: 'var(--green)' }]" :height="250" x-label="Frequency (bpm)" y-label="Relative power" label="Spectrum of the colour error" />
        <p class="small muted">Green band = the heart-rate range the algorithm searches (42 to 180 bpm). The dotted lines sit at multiples of {{ fundamental.toFixed(1) }} bpm ({{ fps.toFixed(2) }} frames per s ÷ {{ period }} frames per keyframe × 60). The real spectrum peaks on them. Spacing keyframes more closely spreads the teeth further apart; spacing them out squeezes them together. Try the buttons above.</p>
        <div class="callout"><strong>The problem:</strong> {{ teeth.length }} of these teeth ({{ teeth.map((t) => t.bpm.toFixed(0)).join(', ') }} bpm) fall inside the range where a real heart rate could be.</div>
      </div>

      <!-- 4 ------------------------------------------------------------------------------>
      <div v-else-if="index === 3" class="card">
        <h3>4. The algorithm picks the loudest tooth</h3>
        <p class="small muted">One 10 s window. Grey dashed = POS spectrum of the uncompressed video: one clean peak at the true heart rate. Colour = same window after compression. <span class="tag real">real data</span></p>
        <div class="controls"><label>Window <input v-model.number="win" type="range" min="0" :max="nWin - 1" step="1" /> {{ (a0 / fps).toFixed(0) }} to {{ ((a0 + wins.wn) / fps).toFixed(0) }} s</label></div>
        <LineChart :series="win4" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :markers="[...teeth.map((t) => ({ x: t.bpm, color: MODE_COLOR[mode], dash: '2 3', opacity: 0.55 })), { x: truthBpm, label: `truth ${truthBpm.toFixed(0)}`, color: '#0b0b0b', dash: '5 2' }]" :height="260" x-label="Heart rate (bpm)" y-label="Power (shared scale)" label="Spectra with and without keyframes" />
        <div class="stats">
          <div class="stat"><b>{{ truthBpm.toFixed(0) }}</b><span>truth (bpm)</span></div>
          <div class="stat" style="border-left: 4px solid var(--green)"><b>{{ peakSrc.toFixed(0) }}</b><span>uncompressed video says</span></div>
          <div class="stat" :style="{ borderLeft: `4px solid ${Math.abs(peakMode - truthBpm) < 5 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ peakMode.toFixed(0) }}</b><span>compressed video says{{ onTooth ? ' (a tooth)' : '' }}</span></div>
        </div>
        <div class="callout">
          <strong>Size of the problem.</strong> Inside the POS output, the pulse has spread {{ ratio.pulse.toFixed(3) }}; what compression adds on top has spread {{ ratio.art.toFixed(3) }}, {{ (ratio.art / ratio.pulse).toFixed(1) }}× larger. In raw colour the jumps are only about as big as the pulse, but they are not the same in red, green and blue, and POS is built to keep exactly that kind of "coloured" change. A perfectly repeating signal also puts all its energy into a few narrow lines, whereas a heartbeat that speeds up and slows down spreads its energy over a wider peak; that is probably part of why the comb wins (we have not isolated it).
        </div>
      </div>

      <!-- 5 ------------------------------------------------------------------------------>
      <div v-else-if="index === 4" class="card">
        <h3>5. Over the whole minute, the answer snaps to a tooth</h3>
        <p class="small muted">Heart rate in every window. The coloured horizontal lines are the teeth. Watch the coloured curve ignore the grey truth and hop between them. <span class="tag real">real data</span></p>
        <LineChart :series="track" :hlines="hlines" :y-domain="[40, 185]" :height="300" x-label="Time (s)" y-label="Heart rate (bpm)" label="Heart-rate track" />
        <div v-if="share" class="stats">
          <div class="stat"><b>{{ (share.pos * 100).toFixed(0) }} %</b><span>of windows land on a tooth (within 1.5 bpm)</span></div>
          <div class="stat"><b>{{ (share.chance * 100).toFixed(0) }} %</b><span>would, if the video had found the true rate</span></div>
          <div class="stat"><b>{{ medErr(mode).toFixed(1) }} bpm</b><span>median error (one keyframe: {{ medErr('long').toFixed(1) }})</span></div>
        </div>
        <div class="callout warn"><strong>The "by chance" number matters.</strong> Teeth cover a lot of the range, so some windows would land on one anyway. The evidence is the gap between the two percentages.</div>
      </div>

      <!-- 6 ------------------------------------------------------------------------------>
      <div v-else-if="index === 5" class="card">
        <h3>6. Move the keyframes and the false peak moves with them</h3>
        <p class="small muted">Each dot is a 10 s window; all five subjects together. x = true heart rate, y = what the compressed video says. Coloured dots sit on a tooth. If compression merely added noise, dots would scatter around the diagonal. <span class="tag real">5 subjects</span></p>
        <Scatter :points="points" :hlines="hlines" :x-domain="[55, 150]" :y-domain="[40, 185]" x-label="True heart rate (bpm)" y-label="Heart rate from compressed video (bpm)" :height="340" label="Estimated against true heart rate" />
        <table class="t">
          <thead><tr><th>Keyframe every</th><th>Median error</th><th>On a tooth</th><th>Expected by chance</th></tr></thead>
          <tbody>
            <tr v-for="p in pooled" :key="p.m" :style="{ fontWeight: p.m === mode ? 700 : 400 }"><td>{{ MODE_LABEL[p.m] }}</td><td>{{ p.med.toFixed(1) }} bpm</td><td>{{ (p.pos * 100).toFixed(0) }} %</td><td>{{ (p.chance * 100).toFixed(0) }} %</td></tr>
            <tr><td>{{ MODE_LABEL.long }}</td><td>{{ longMed.toFixed(1) }} bpm</td><td>–</td><td>–</td></tr>
          </tbody>
        </table>
        <p class="small muted">{{ pooled[0].n }} windows per row. The closer the keyframes, the further the error and the stronger the lock. At 4 s the teeth are only {{ (60 * subs[10].fps / 120).toFixed(0) }} bpm apart, so landing near one is likelier by luck and the evidence weakens: {{ (pooled[2].pos * 100).toFixed(0) }} % against {{ (pooled[2].chance * 100).toFixed(0) }} %.</p>
        <div class="callout warn">
          <strong>Heads-up: re-encoding changes the numbers.</strong> x264's multi-threaded rate control is not bit-reproducible: encoding the same video twice gives two different files. Subject 10 here is a fresh encode (the original run's file was not kept), so some medians differ from the first report (4 s: {{ pooled[2].med.toFixed(1) }} here vs 32.6 originally; single keyframe: {{ longMed.toFixed(1) }} vs 4.4). The five-subject median of the single-keyframe baseline sits between subjects who work (about 2 to 8 bpm) and two who fail even with one keyframe (23 and 58 bpm), so a small change in one subject moves it a lot.
          <template v-if="encVar">
            <table class="t" style="margin-top: 8px">
              <thead><tr><th>Subject 10, median error (bpm)</th><th>Re-encodes (default threads)</th><th>threads=1 (reproducible)</th></tr></thead>
              <tbody><tr v-for="(r, m) in encVar" :key="m"><td>{{ MODE_LABEL[m] }}</td><td>{{ r.default_threads.join(', ') }}</td><td>{{ r.threads1[0] }}</td></tr></tbody>
            </table>
            <span class="small">Four re-encodes of the 2 s setting span {{ rng('g60') }} bpm: the artefact is robust. At 4 s they span {{ rng('g120') }} bpm, for intra-refresh {{ rng('intra-refresh') }} bpm and for one keyframe {{ rng('long') }} bpm, so single-subject numbers there are one draw from a wide spread. The 42-subject averages are far steadier than any single subject.</span>
          </template>
        </div>
      </div>

      <!-- 7 ------------------------------------------------------------------------------>
      <div v-else-if="index === 6" class="card">
        <h3>7. The decoder knows where the keyframes are. Can it undo the pattern?</h3>
        <p class="small muted">Yes, partly. The stream announces every frame's type, so the receiver knows each frame's position inside the keyframe cycle. It fits the sawtooth from step 2 as a function of that position, subtracts it from each colour channel, and runs POS again. <span class="tag real">real data</span></p>
        <div class="controls">
          <label><input v-model="fixOn" type="checkbox" /> Show corrected</label>
          <label>Window <input v-model.number="win" type="range" min="0" :max="nWin - 1" step="1" /> {{ (a0 / fps).toFixed(0) }} s</label>
        </div>
        <LineChart :series="win7" :x-domain="[42, 180]" :y-domain="[0, 1.12]" :markers="[{ x: truthBpm, label: `truth ${truthBpm.toFixed(0)}`, color: '#0b0b0b', dash: '5 2' }]" :height="240" x-label="Heart rate (bpm)" y-label="Power" label="Spectrum before and after correction" />
        <h3>Across all five subjects</h3>
        <CategoryBars :items="fixBars" unit=" bpm" :ref-line="{ value: longMed + 2, label: 'pre-set bar: one keyframe + 2 bpm' }" />
        <div class="callout warn">
          <strong>It helps but does not fix it.</strong> The correction cuts the error roughly in half, yet stays far from the one-keyframe level. We had decided in advance that "it works" means landing within 2 bpm of one-keyframe error, and it never does. The error that remains is partly ordinary compression damage (some subjects fail even with one keyframe) and partly structure the simple fit cannot remove. Intra-refresh, the common real-time setting, has no keyframe cycle to fit, and the one bitstream-based attempt we tried on it (using QP) did nothing.
        </div>
      </div>

      <!-- 8 ------------------------------------------------------------------------------>
      <div v-else class="card">
        <h3>8. Zoom out: forty-two people</h3>
        <p class="small muted">The earlier compression sweep, 800 kbps, POS, median error over {{ damage.subjects }} subjects. <span class="tag real">42 subjects</span></p>
        <CategoryBars :items="k800.map((k) => ({ label: k.label, value: k.value, color: k.color, note: `${(k.bad * 100).toFixed(0)} % of windows off by >5` }))" unit=" bpm" :ref-line="{ value: 5, label: '5 bpm' }" />
        <div class="callout">
          <strong>Take-away.</strong> Same bitrate, same video, same algorithm: a keyframe every 2 s costs about {{ (k800[3].value / k800[1].value).toFixed(0) }} times the error of a single keyframe. The common low-latency "intra-refresh" setting lands in between.
        </div>
        <h3>What is solid and what is not</h3>
        <table class="t left">
          <tbody>
            <tr><td>Error grows as keyframes get closer</td><td>42 subjects (2 s vs single keyframe) + 5 subjects (1, 2, 4 s)</td></tr>
            <tr><td>The wrong answers sit on multiples of the keyframe rate</td><td>5 subjects only</td></tr>
            <tr><td>A decoder-side correction halves the error</td><td>5 subjects; did not meet the bar we set</td></tr>
            <tr><td>Other algorithms (CHROM, deep networks), other codecs, other datasets</td><td>Not tested yet</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </Stepper>
</template>

<style scoped>
.sticky { position: sticky; top: 49px; z-index: 3; margin-bottom: 14px; }
@media (max-height: 820px) { .sticky { position: static; } }
.strip { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 10px; margin: 6px 0; font-size: 0.82rem; }
.strip svg { width: 100%; height: 22px; background: var(--surface-2); border-radius: 4px; }
.sl { color: var(--ink-2); }
@media (max-width: 600px) { .strip { grid-template-columns: 1fr; } }
</style>
