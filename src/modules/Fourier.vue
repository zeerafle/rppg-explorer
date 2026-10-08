<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import Tex from '../components/Tex.vue'
import * as D from '../lib/dsp.js'
import { add, db, gauss, sine, times } from '../lib/synth.js'

const FS = 30
const bands = [{ x0: 42, x1: 180, color: 'var(--green)' }]
const bpmAxis = (sp) => Array.from(sp.f, (v) => v * 60)
const norm = (sp) => { const m = Math.max(...sp.p); return Array.from(sp.p, (v) => v / m) }

// ---- 1. spectrum of a sum ----
const A = ref(72), Bb = ref(140), ampB = ref(0.4), noise = ref(0.5), hann = ref(true)
const N = 10 * FS
const t = times(N, FS), nz = gauss(N, 5)
const sig = computed(() => add(sine(t, A.value / 60, 1), sine(t, Bb.value / 60, ampB.value), nz.map((v) => v * noise.value)))
const spec = computed(() => D.spectrum(sig.value, FS, { range: [0.2, 4], hann: hann.value }))
const peak = computed(() => D.peakBpm({ f: spec.value.f.filter((v) => v * 60 >= 42 && v * 60 <= 180), p: spec.value.p.filter((_, i) => spec.value.f[i] * 60 >= 42 && spec.value.f[i] * 60 <= 180) }))
const s1 = computed(() => [{ name: 'Signal (10 s)', color: '#0b0b0b', y: sig.value, x0: 0, dx: 1 / FS, width: 1.6 }])
const s1f = computed(() => [{ name: 'Spectrum', color: '#eb6834', x: bpmAxis(spec.value), y: norm(spec.value), width: 2 }])

// ---- 2. window length vs resolution ----
const gap = ref(8), Tw = ref(10)
const sig2 = computed(() => { const tt = times(Math.round(Tw.value * FS), FS); return add(sine(tt, 72 / 60, 1), sine(tt, (72 + gap.value) / 60, 1)) })
const spec2 = computed(() => D.spectrum(sig2.value, FS, { range: [0.5, 2.5] }))
const found = computed(() => D.topPeaks(spec2.value, 3, Math.max(gap.value * 0.6, 1)).filter((p) => p.rel > 0.45))
const s2 = computed(() => [{ name: `${Tw.value} s window`, color: '#2a78d6', x: bpmAxis(spec2.value), y: norm(spec2.value), width: 2.2 }])

// ---- 3. leakage ----
const tone = ref(93.7)
const sig3 = computed(() => sine(times(10 * FS, FS), tone.value / 60, 1))
const lk = computed(() => {
  const r = D.spectrum(sig3.value, FS, { range: [0.2, 6], hann: false }), h = D.spectrum(sig3.value, FS, { range: [0.2, 6], hann: true })
  const m = Math.max(...r.p, ...h.p)
  const at = (sp, bpm) => { let b = 0; for (let i = 1; i < sp.f.length; i++) if (Math.abs(sp.f[i] * 60 - bpm) < Math.abs(sp.f[b] * 60 - bpm)) b = i; return db(sp.p[b], m) }
  return {
    s: [
      { name: 'No taper (rectangular)', color: '#6b6a66', x: bpmAxis(r), y: Array.from(r.p, (v) => db(v, m)), width: 1.6 },
      { name: 'Hann taper', color: '#eb6834', x: bpmAxis(h), y: Array.from(h.p, (v) => db(v, m)), width: 2.2 },
    ],
    far: [at(r, tone.value + 60), at(h, tone.value + 60)],
  }
})
const cycles = computed(() => (tone.value / 60) * 10)
</script>

<template>
  <h1>Fourier and the spectrum</h1>
  <p class="lede">The Fourier transform answers one question: <em>which frequencies are in this signal, and how strongly?</em> The plot of that answer is the spectrum. Module 4 uses it to read a heart rate; here you can see why it works and where it fails.</p>

  <div class="card">
    <h3>1. From a messy trace to its ingredients</h3>
    <div class="callout">
      <strong>In plain words.</strong> Think of a chord on a piano. Your ear hears one blended sound, yet it is really several pure notes played together. The <b>spectrum</b> does for any signal what a trained ear does for a chord: it lists which pure waves (sines) are mixed in, and how loud each one is. Horizontal axis = how fast the wave repeats (here in beats per minute); height = how strong it is. A tall peak at 72 bpm means "there is a strong 72-per-minute wave in here". The computation that produces it is the <b>Fourier transform</b>.
    </div>
    <p class="small muted"><b>What to do:</b> the black signal below is two sine waves plus random noise, which looks like a mess. Move the sliders for tone A and B and watch the peaks move in the spectrum underneath. Then raise the noise. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <label>Tone A <input v-model.number="A" type="range" min="45" max="170" step="1" /> <b>{{ A }} bpm</b> <span class="muted">(amplitude 1)</span></label>
      <label>Tone B <input v-model.number="Bb" type="range" min="45" max="260" step="1" /> <b>{{ Bb }} bpm</b></label>
      <label>B strength <input v-model.number="ampB" type="range" min="0" max="1" step="0.05" /> <b>{{ ampB.toFixed(2) }}</b></label>
      <label>Noise <input v-model.number="noise" type="range" min="0" max="3" step="0.1" /> <b>{{ noise.toFixed(1) }}</b></label>
    </div>
    <LineChart :series="s1" :height="170" x-label="Time (s)" label="Signal" />
    <LineChart :series="s1f" :bands="bands" :markers="[{ x: A, label: 'A', color: '#0b0b0b' }, ...(ampB > 0 ? [{ x: Bb, label: 'B', color: '#0b0b0b' }] : [])]" :x-domain="[12, 240]" :y-domain="[0, 1.1]" :height="220" x-label="Frequency (bpm)" y-label="Relative power" label="Spectrum" />
    <div class="stats">
      <div class="stat"><b>{{ peak.toFixed(1) }} bpm</b><span>tallest peak in the heart-rate band (green)</span></div>
    </div>
    <div class="controls"><label><input v-model="hann" type="checkbox" /> Hann taper (see 3)</label></div>
    <div class="callout">
      <strong>What to notice.</strong> Noise is spread across <em>all</em> frequencies, so it raises a flat floor but does not create a peak; a steady tone concentrates its energy in one spot. That is why a periodic pulse stands out of noise that looks overwhelming in time. Push the noise to 3 and the peaks still hold. Then make B stronger than A in the band: the "heart rate" the algorithm reports is now B. That is the keyframe artefact in one picture: whichever ingredient is loudest in the allowed band wins.
    </div>
    <Tex block tex="X(f) = \sum_{n} x[n]\, e^{-i 2\pi f n / f_s}, \qquad \text{power}(f) = |X(f)|^2" />
  </div>

  <div class="card">
    <h3>2. Longer windows separate close rates</h3>
    <p class="small"><b>In plain words.</b> To tell two similar speeds apart you must watch long enough for one to pull ahead of the other. Two clocks that differ by a few seconds per day look identical after a minute, but not after a week. The <b>window</b> is how many seconds of signal we analyse at once. A short window gives <b>coarse resolution</b> (it cannot separate close frequencies); a long one gives fine resolution. <b>What to do:</b> keep the gap at about 6 bpm and drag the window from 2 s up to 40 s; the two merged humps split into two peaks.</p>
    <p class="small muted">Two equal tones, {{ gap }} bpm apart, observed for {{ Tw }} s. A short observation cannot tell them apart; they merge into one peak. <span class="tag illus">illustration</span></p>
    <div class="controls">
      <label>Gap between tones <input v-model.number="gap" type="range" min="2" max="24" step="1" /> <b>{{ gap }} bpm</b></label>
      <label>Window length <input v-model.number="Tw" type="range" min="2" max="40" step="1" /> <b>{{ Tw }} s</b></label>
    </div>
    <LineChart :series="s2" :markers="[{ x: 72, color: '#0b0b0b' }, { x: 72 + gap, color: '#0b0b0b' }]" :x-domain="[50, 100]" :y-domain="[0, 1.1]" :height="220" x-label="Frequency (bpm)" y-label="Relative power" label="Two close tones" />
    <div class="stats">
      <div class="stat"><b>≈ {{ (60 / Tw).toFixed(1) }} bpm</b><span>resolution ≈ 60 ÷ window</span></div>
      <div class="stat" :style="{ borderLeft: `4px solid ${found.length >= 2 ? 'var(--green)' : 'var(--red)'}` }"><b>{{ found.length >= 2 ? 'Two peaks' : 'One peak' }}</b><span>seen in the spectrum</span></div>
    </div>
    <p class="small muted">Dashed black lines mark the true tones. Resolution is about 60 ÷ window length in bpm (Hann taper roughly doubles it). A 10 s window therefore resolves roughly 6 to 12 bpm: no better, however clever the maths. The price of a longer window is that the heart rate must stay put for that long; a rate that changes smears the peak.</p>
  </div>

  <div class="card">
    <h3>3. Why the window is faded at its edges</h3>
    <p class="small"><b>In plain words.</b> We only ever analyse a slice of the signal, and cutting a slice creates sudden edges at the start and end. The maths treats those edges as sharp jumps, and sharp jumps contain many frequencies. So a clean wave seems to grow a "skirt" of fake frequencies around its peak. That is <b>leakage</b>. The fix is the <b>Hann taper</b>: fade the slice in and out smoothly, like turning a volume knob up and down at the ends, so there is no sudden edge. <b>What to look for:</b> how far the grey line (no taper) sits above the orange line (Hann taper) away from the peak. <b>Decibels (dB)</b> is a scale where each −10 dB means ten times weaker; −45 dB is a very small leak, −95 dB is a far smaller one. <b>Takeaway:</b> a loud false peak could hide a weak real pulse, so the pipeline always tapers the window.</p>
    <p class="small muted">A pure {{ tone.toFixed(1) }} bpm tone, observed for 10 s ({{ cycles.toFixed(2) }} cycles). Cut it off abruptly and the missing "end" looks like a jump, which the transform describes with frequencies that were never there: leakage. Power is in decibels (every −10 dB is ten times smaller). <span class="tag illus">illustration</span></p>
    <div class="controls"><label>Tone <input v-model.number="tone" type="range" min="60" max="150" step="0.1" /> <b>{{ tone.toFixed(1) }} bpm</b></label>
      <button class="btn" @click="tone = 90">Whole cycles (90.0)</button><button class="btn" @click="tone = 93.7">Not whole (93.7)</button></div>
    <LineChart :series="lk.s" :x-domain="[12, 360]" :y-domain="[-100, 3]" :height="250" x-label="Frequency (bpm)" y-label="Power (dB)" label="Leakage with and without taper" />
    <div class="stats">
      <div class="stat"><b>{{ lk.far[0].toFixed(0) }} dB</b><span>no taper, 60 bpm away</span></div>
      <div class="stat"><b>{{ lk.far[1].toFixed(0) }} dB</b><span>Hann taper, 60 bpm away</span></div>
    </div>
    <p class="small muted">Without a taper the skirt of the peak decays slowly and can bury a weaker real component. The Hann taper (module 4) fades the ends to zero and the skirt drops far faster, at the cost of a wider main peak. Try the "whole cycles" button: when the window holds an exact number of cycles the leakage nearly vanishes, but real heart rates never cooperate.</p>
  </div>
</template>
