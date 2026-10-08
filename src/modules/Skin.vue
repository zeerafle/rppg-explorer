<script setup>
import { computed, ref } from 'vue'
import LineChart from '../components/LineChart.vue'
import SyncVideos from '../components/SyncVideos.vue'
import * as D from '../lib/dsp.js'
import { HERO, loadHeroMeta, loadSubject, loadTiles, refBvp, tileMap } from '../lib/data.js'

const s = await loadSubject(HERO)
const view = await loadHeroMeta()
const tiles = await loadTiles()
const { corr, traces } = tileMap(tiles, s)

const fps = s.fps
const t = ref(20)
const heat = ref(true)
const sel = ref(null)
const winStart = ref(20)
const vb = [view.x0, view.y0, view.w, view.h]
const clips = [
  { name: 'crop', label: 'Original (what a camera sees)', viewBox: vb },
  { name: 'magnified', label: `Pulse magnified ×${view.mag_alpha} (same frames)`, viewBox: vb },
]

const cmax = Math.max(...corr)
const ranked = Array.from(corr, (v, i) => [v, i]).sort((a, b) => b[0] - a[0])
sel.value = ranked[0][1]
const tileXY = (i) => ({ x: (i % tiles.nx) * tiles.tile + tiles.x0, y: Math.floor(i / tiles.nx) * tiles.tile + tiles.y0 })
const colour = (v) => `rgba(235,104,52,${Math.min(0.75, (v / cmax) ** 1.5 * 0.75)})`

const ref0 = refBvp(s)
const series = computed(() => {
  const a = Math.round(winStart.value * fps), b = Math.round((winStart.value + 12) * fps)
  const tr = traces[sel.value].subarray(a, b)
  const rf = ref0.subarray(a, b)
  const k = D.std(tr) / D.std(rf)
  // flip the reference's sign when the tile is anti-correlated, so shapes can be compared by eye
  let dot = 0
  for (let i = 0; i < tr.length; i++) dot += tr[i] * rf[i]
  const sign = dot < 0 ? -1 : 1
  return [
    { name: 'This tile (green, band-passed)', color: '#1baf7a', y: tr, x0: winStart.value, dx: 1 / fps },
    { name: 'Contact pulse sensor', color: '#6b6a66', y: rf.map((v) => v * k * sign), x0: winStart.value, dx: 1 / fps, dash: '4 3', width: 1.2 },
  ]
})

const greenLevel = (() => { const r = s.conds.source.rgb; let m = 0; for (let i = 0; i < s.usable; i++) m += r[i * 3 + 1]; return m / s.usable })()
const flush = (() => { const r = s.conds.source.rgb; const g = Float64Array.from({ length: s.usable }, (_, i) => r[i * 3 + 1] / greenLevel - 1); return D.std(D.bandpass(g, s.ba)) })()
const selCorr = computed(() => corr[sel.value])
const medianCorr = D.median(corr)
</script>

<template>
  <h1>The pulse is in the colour</h1>
  <p class="lede">Each heartbeat pushes a little more blood into the skin. Blood absorbs green light, so the skin gets very slightly darker in green at every beat. This module makes that change visible, then shows which parts of the face carry it.</p>

  <div class="card">
    <h3>1. Amplify it</h3>
    <p class="small muted">Left: the real recording, cropped to the face. Right: the same frames after the colour wobble between {{ view.mag_band[0] * 60 }} and {{ view.mag_band[1] * 60 }} bpm (this subject's heart-rate range) is amplified {{ view.mag_alpha }}× and added back. Watch the skin flush and fade in time with the beat; hair edges ghost a little because head motion in the same band is amplified too. <span class="tag real">real video</span></p>
    <SyncVideos :clips="clips" :fps="fps" :duration="s.usable / fps" :start="20" :cols="2" @time="(v) => (t = v)">
      <template #overlay="{ clip }">
        <g v-if="heat && clip.name === 'crop'">
          <rect v-for="(v, i) in corr" :key="i" :x="tileXY(i).x" :y="tileXY(i).y" :width="tiles.tile" :height="tiles.tile" :fill="colour(v)" />
        </g>
        <rect v-if="sel != null && clip.name === 'crop'" :x="tileXY(sel).x" :y="tileXY(sel).y" :width="tiles.tile" :height="tiles.tile" fill="none" stroke="#fff" stroke-width="3" />
      </template>
    </SyncVideos>
    <div class="callout">
      <strong>How small is it?</strong>
      The average green level of the face is {{ greenLevel.toFixed(0) }} out of 255. The pulse moves it by only about {{ (flush * 100).toFixed(2) }} %, which is {{ (flush * greenLevel).toFixed(2) }} grey levels. A single pixel cannot show that, because camera noise is larger. Averaging many pixels can.
    </div>
  </div>

  <div class="card">
    <h3>2. Where on the face is the pulse?</h3>
    <p class="small muted">The face is cut into {{ tiles.nx }}×{{ tiles.ny }} tiles of {{ tiles.tile }} px. For each tile, its green brightness over time is compared with the contact sensor (strongest match within ±0.3 s). Orange on the video = a good match. Click a tile in the grid to inspect it. <span class="tag real">real data</span></p>
    <div class="row">
      <div>
        <div class="controls"><label><input v-model="heat" type="checkbox" /> Show heat map on the video</label></div>
        <svg class="grid" :viewBox="`0 0 ${tiles.nx} ${tiles.ny}`" role="img" aria-label="Tile map; click to select a tile">
          <g v-for="(v, i) in corr" :key="i" class="cell" tabindex="0" @click="sel = i" @keydown.enter="sel = i">
            <rect :x="i % tiles.nx" :y="Math.floor(i / tiles.nx)" width="0.96" height="0.96" rx="0.08" :fill="colour(v)" :stroke="i === sel ? 'var(--ink)' : 'var(--line)'" :stroke-width="i === sel ? 0.09 : 0.03" />
            <text :x="(i % tiles.nx) + 0.48" :y="Math.floor(i / tiles.nx) + 0.58" text-anchor="middle" font-size="0.32" fill="var(--ink)">{{ v.toFixed(2) }}</text>
          </g>
        </svg>
        <p class="small muted">Number = |correlation| with the contact sensor. Median tile {{ medianCorr.toFixed(2) }}, best tile {{ cmax.toFixed(2) }}.</p>
      </div>
      <div>
        <div class="stats"><div class="stat"><b>{{ selCorr.toFixed(2) }}</b><span>selected tile |r|</span></div></div>
        <LineChart :series="series" :x-domain="[winStart, winStart + 12]" :playhead="t" :height="230" y-label="Relative brightness" x-label="Time (s)" label="Selected tile against reference" />
        <div class="controls"><label>Window start <input v-model.number="winStart" type="range" min="0" :max="Math.floor(s.usable / fps - 12)" step="1" /> {{ winStart }} s</label></div>
      </div>
    </div>
    <div class="callout warn">
      <strong>Reading the map.</strong> The best tiles sit at the centre of the face (|r| up to {{ cmax.toFixed(2) }}); background, hair and clothing stay near the noise floor ({{ medianCorr.toFixed(2) }} is the median tile). Even the best tile is far from a perfect match, because this person moves a little and every movement disturbs every tile. That is why we average a whole face region, and why a talking mouth or a turning head is hard: the good tiles move.
    </div>
  </div>
</template>

<style scoped>
.grid { width: 100%; max-width: 420px; display: block; }
.cell { cursor: pointer; outline: none; }
.cell:focus-visible rect { stroke: var(--accent); stroke-width: 0.1; }
</style>
