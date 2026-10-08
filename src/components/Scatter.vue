<script setup>
// Plain SVG scatter with horizontal guide lines and an optional y = x diagonal.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { scaleLinear } from 'd3-scale'

const props = defineProps({
  points: { type: Array, default: () => [] },   // {x,y,color?,title?}
  xDomain: { type: Array, default: () => [40, 180] },
  yDomain: { type: Array, default: () => [40, 180] },
  hlines: { type: Array, default: () => [] },   // {y,label?,color?}
  diagonal: { type: Boolean, default: true },
  height: { type: Number, default: 300 },
  xLabel: String, yLabel: String, label: { type: String, default: 'scatter' },
})
const el = ref(null), width = ref(500)
let ro
onMounted(() => { ro = new ResizeObserver(([e]) => (width.value = Math.max(260, Math.floor(e.contentRect.width)))); ro.observe(el.value) })
onBeforeUnmount(() => ro?.disconnect())
const m = { top: 10, right: 12, bottom: 38, left: 52 }
const iw = computed(() => width.value - m.left - m.right), ih = computed(() => props.height - m.top - m.bottom)
const sx = computed(() => scaleLinear().domain(props.xDomain).range([0, iw.value]))
const sy = computed(() => scaleLinear().domain(props.yDomain).range([ih.value, 0]))
</script>
<template>
  <div ref="el">
    <svg :width="width" :height="height" role="img" :aria-label="label">
      <g :transform="`translate(${m.left},${m.top})`">
        <g class="ax">
          <line v-for="t in sy.ticks(6)" :key="'gy' + t" :x1="0" :x2="iw" :y1="sy(t)" :y2="sy(t)" class="g" />
          <text v-for="t in sy.ticks(6)" :key="'ty' + t" :x="-6" :y="sy(t)" dy="0.32em" text-anchor="end">{{ t }}</text>
          <text v-for="t in sx.ticks(7)" :key="'tx' + t" :x="sx(t)" :y="ih + 15" text-anchor="middle">{{ t }}</text>
          <text v-if="xLabel" :x="iw / 2" :y="ih + 32" text-anchor="middle">{{ xLabel }}</text>
          <text v-if="yLabel" :transform="`translate(${-m.left + 12},${ih / 2}) rotate(-90)`" text-anchor="middle">{{ yLabel }}</text>
        </g>
        <line v-if="diagonal" :x1="sx(Math.max(xDomain[0], yDomain[0]))" :y1="sy(Math.max(xDomain[0], yDomain[0]))" :x2="sx(Math.min(xDomain[1], yDomain[1]))" :y2="sy(Math.min(xDomain[1], yDomain[1]))" stroke="var(--ink-3)" stroke-dasharray="4 3" />
        <g v-for="(h, i) in hlines" :key="'h' + i">
          <line :x1="0" :x2="iw" :y1="sy(h.y)" :y2="sy(h.y)" :stroke="h.color || 'var(--accent)'" stroke-width="1" stroke-dasharray="2 3" opacity="0.8" />
          <text v-if="h.label" :x="iw - 3" :y="sy(h.y) - 3" text-anchor="end" class="hl" :fill="h.color || 'var(--accent)'">{{ h.label }}</text>
        </g>
        <circle v-for="(p, i) in points" :key="i" :cx="sx(p.x)" :cy="sy(Math.min(Math.max(p.y, yDomain[0]), yDomain[1]))" r="3.6" :fill="p.color || 'var(--accent)'" fill-opacity="0.7" stroke="var(--bg)" stroke-width="0.8"><title v-if="p.title">{{ p.title }}</title></circle>
        <line :x1="0" :x2="iw" :y1="ih" :y2="ih" stroke="var(--ink-3)" />
      </g>
    </svg>
  </div>
</template>
<style scoped>
svg { display: block; overflow: visible; }
.ax text { fill: var(--ink-2); font-size: 11px; font-variant-numeric: tabular-nums; }
.g { stroke: var(--line); }
.hl { font-size: 10px; font-weight: 600; }
</style>
