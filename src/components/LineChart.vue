<script setup>
// Responsive SVG line chart. Series are plain arrays; x comes from `x` (array) or from `dx`/`x0`.
// Min/max decimation keeps 2000-sample traces light. Optional playhead, vertical markers,
// shaded bands, horizontal lines and drag-to-scrub.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'

const props = defineProps({
  series: { type: Array, default: () => [] },     // {name,color,y,x?,dx?,x0?,width?,dash?,opacity?,step?}
  xDomain: { type: Array, default: null },
  yDomain: { type: Array, default: null },
  markers: { type: Array, default: () => [] },    // {x,label?,color?,dash?,labelY?}
  bands: { type: Array, default: () => [] },      // {x0,x1,color?,label?}
  hlines: { type: Array, default: () => [] },     // {y,label?,color?,dash?}
  playhead: { type: Number, default: null },
  height: { type: Number, default: 220 },
  xLabel: { type: String, default: '' },
  yLabel: { type: String, default: '' },
  yZero: { type: Boolean, default: false },       // force 0 into the y domain
  scrub: { type: Boolean, default: false },
  legend: { type: Boolean, default: true },
  label: { type: String, default: 'chart' },
  xFormat: { type: Function, default: (v) => v },
  margin: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['scrub'])

const el = ref(null)
const width = ref(600)
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => { width.value = Math.max(240, Math.floor(e.contentRect.width)) })
  ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())

const m = computed(() => ({ top: 10, right: 12, bottom: props.xLabel ? 38 : 24, left: props.yLabel ? 52 : 40, ...props.margin }))
const iw = computed(() => width.value - m.value.left - m.value.right)
const ih = computed(() => props.height - m.value.top - m.value.bottom)

const xOf = (s, i) => (s.x ? s.x[i] : (s.x0 ?? 0) + i * (s.dx ?? 1))

const xd = computed(() => {
  if (props.xDomain) return props.xDomain
  let lo = Infinity, hi = -Infinity
  for (const s of props.series) {
    const n = s.y.length
    if (!n) continue
    lo = Math.min(lo, xOf(s, 0)); hi = Math.max(hi, xOf(s, n - 1))
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1]
})

const yd = computed(() => {
  if (props.yDomain) return props.yDomain
  let lo = Infinity, hi = -Infinity
  const [a, b] = xd.value
  for (const s of props.series) {
    for (let i = 0; i < s.y.length; i++) {
      const x = xOf(s, i)
      if (x < a || x > b) continue
      const v = s.y[i]
      if (v == null || Number.isNaN(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo)) return [0, 1]
  if (props.yZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  const pad = (hi - lo || 1) * 0.08
  return [props.yZero && lo === 0 ? 0 : lo - pad, hi + pad]
})

const sx = computed(() => scaleLinear().domain(xd.value).range([0, iw.value]))
const sy = computed(() => scaleLinear().domain(yd.value).range([ih.value, 0]))
const xt = computed(() => sx.value.ticks(Math.max(3, Math.floor(iw.value / 90))))
const yt = computed(() => sy.value.ticks(5))

const paths = computed(() => {
  const gen = line().defined((d) => d[1] != null && !Number.isNaN(d[1]))
  const [a, b] = xd.value
  return props.series.map((s) => {
    // collect visible points, then min/max-decimate to ~2 points per pixel column
    const pts = []
    const n = s.y.length
    const first = s.x ? 0 : Math.max(0, Math.floor((a - (s.x0 ?? 0)) / (s.dx ?? 1)) - 1)
    const last = s.x ? n - 1 : Math.min(n - 1, Math.ceil((b - (s.x0 ?? 0)) / (s.dx ?? 1)) + 1)
    for (let i = first; i <= last; i++) {
      const x = xOf(s, i)
      if (x < a - 1e-9 || x > b + 1e-9) continue
      pts.push([sx.value(x), s.y[i] == null ? null : sy.value(s.y[i])])
    }
    let out = pts
    if (pts.length > iw.value * 2) {
      out = []
      const buckets = new Map()
      for (const p of pts) {
        const k = Math.floor(p[0])
        const bk = buckets.get(k)
        if (!bk) buckets.set(k, { lo: p, hi: p })
        else { if (p[1] < bk.lo[1]) bk.lo = p; if (p[1] > bk.hi[1]) bk.hi = p }
      }
      for (const bk of [...buckets.values()]) {
        if (bk.lo[0] <= bk.hi[0]) out.push(bk.lo, bk.hi); else out.push(bk.hi, bk.lo)
      }
    }
    const g = s.step ? gen.curve(stepCurve) : gen
    return { s, d: g(out), pts: s.dots ? pts : null }
  })
})

function stepCurve(ctx) {   // d3 curve factory: horizontal-then-vertical steps
  let x0, y0, started = false
  return {
    areaStart() {}, areaEnd() {}, lineStart() { started = false }, lineEnd() {},
    point(x, y) { if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y0); ctx.lineTo(x, y) } x0 = x; y0 = y },
  }
}

function pointerX(e) {
  const r = el.value.querySelector('svg').getBoundingClientRect()
  const x = e.clientX - r.left - m.value.left
  return sx.value.invert(Math.min(Math.max(x, 0), iw.value))
}
let dragging = false
function down(e) { if (!props.scrub) return; dragging = true; e.currentTarget.setPointerCapture(e.pointerId); emit('scrub', pointerX(e)) }
function move(e) { if (dragging) emit('scrub', pointerX(e)) }
function up() { dragging = false }
const inDomain = (x) => x >= xd.value[0] && x <= xd.value[1]
</script>

<template>
  <div ref="el" class="lc">
    <div v-if="legend && series.some((s) => s.name)" class="lc-legend">
      <span v-for="s in series.filter((s) => s.name)" :key="s.name"><i :style="{ background: s.color, opacity: s.opacity ?? 1 }" />{{ s.name }}</span>
    </div>
    <svg :width="width" :height="height" role="img" :aria-label="label"
         :style="{ touchAction: scrub ? 'none' : 'auto', cursor: scrub ? 'ew-resize' : 'default' }"
         @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <g :transform="`translate(${m.left},${m.top})`">
        <rect v-for="(b, i) in bands" :key="'b' + i" :x="sx(Math.max(b.x0, xd[0]))" :y="0"
              :width="Math.max(0, sx(Math.min(b.x1, xd[1])) - sx(Math.max(b.x0, xd[0])))" :height="ih"
              :fill="b.color || 'var(--accent)'" opacity="0.14" />
        <g class="grid">
          <line v-for="t in yt" :key="'y' + t" :x1="0" :x2="iw" :y1="sy(t)" :y2="sy(t)" />
        </g>
        <g class="axis">
          <text v-for="t in yt" :key="'yt' + t" :x="-6" :y="sy(t)" dy="0.32em" text-anchor="end">{{ +t.toPrecision(4) }}</text>
          <text v-for="t in xt" :key="'xt' + t" :x="sx(t)" :y="ih + 15" text-anchor="middle">{{ xFormat(t) }}</text>
          <line :x1="0" :x2="iw" :y1="ih" :y2="ih" />
          <text v-if="xLabel" :x="iw / 2" :y="ih + 32" text-anchor="middle" class="ax-title">{{ xLabel }}</text>
          <text v-if="yLabel" :transform="`translate(${-m.left + 12},${ih / 2}) rotate(-90)`" text-anchor="middle" class="ax-title">{{ yLabel }}</text>
        </g>
        <g v-for="(h, i) in hlines" :key="'h' + i">
          <line :x1="0" :x2="iw" :y1="sy(h.y)" :y2="sy(h.y)" :stroke="h.color || 'var(--ink-2)'" :stroke-dasharray="h.dash ?? '4 3'" stroke-width="1.2" />
          <text v-if="h.label" :x="iw - 4" :y="sy(h.y) - 4" text-anchor="end" class="mk" :fill="h.color || 'var(--ink-2)'">{{ h.label }}</text>
        </g>
        <g v-for="(p, i) in paths" :key="'p' + i">
          <path :d="p.d" fill="none" :stroke="p.s.color" :stroke-width="p.s.width ?? 1.5" :stroke-dasharray="p.s.dash"
                :opacity="p.s.opacity ?? 1" stroke-linejoin="round" />
          <circle v-for="(q, k) in p.pts ?? []" :key="k" :cx="q[0]" :cy="q[1]" r="4" :fill="p.s.color" stroke="var(--bg)" stroke-width="1.2" />
        </g>
        <g v-for="(k, i) in markers" :key="'m' + i">
          <template v-if="inDomain(k.x)">
            <line :x1="sx(k.x)" :x2="sx(k.x)" :y1="0" :y2="ih" :stroke="k.color || 'var(--ink-2)'"
                  :stroke-dasharray="k.dash ?? '3 3'" stroke-width="1.1" :opacity="k.opacity ?? 0.9" />
            <text v-if="k.label" :x="sx(k.x) + 3" :y="12 + (k.labelY ?? 0)" class="mk" :fill="k.color || 'var(--ink-2)'">{{ k.label }}</text>
          </template>
        </g>
        <g v-if="playhead != null && inDomain(playhead)">
          <line :x1="sx(playhead)" :x2="sx(playhead)" :y1="0" :y2="ih" stroke="var(--ink)" stroke-width="1.5" />
          <circle :cx="sx(playhead)" cy="0" r="3.5" fill="var(--ink)" />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.lc { width: 100%; }
.lc-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8rem; color: var(--ink-2); margin-bottom: 2px; }
.lc-legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
svg { display: block; overflow: visible; user-select: none; }
.grid line { stroke: var(--line); stroke-width: 1; }
.axis text { fill: var(--ink-2); font-size: 11px; font-variant-numeric: tabular-nums; }
.axis line { stroke: var(--ink-3); }
.axis .ax-title { font-size: 11.5px; fill: var(--ink-2); }
.mk { font-size: 10.5px; font-weight: 600; }
</style>
