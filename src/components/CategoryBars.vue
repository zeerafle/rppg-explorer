<script setup>
// Horizontal bars with value labels, an optional reference line and optional [lo,hi] whiskers.
import { computed } from 'vue'
const props = defineProps({
  items: { type: Array, required: true },   // {label, value, color?, lo?, hi?, note?}
  max: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  refLine: { type: Object, default: null }, // {value,label}
  decimals: { type: Number, default: 1 },
})
const top = computed(() => props.max || Math.max(...props.items.map((i) => i.hi ?? i.value), props.refLine?.value ?? 0) * 1.15 || 1)
const pct = (v) => `${Math.max(0, Math.min(100, (v / top.value) * 100))}%`
</script>
<template>
  <div class="cb">
    <div v-for="(it, n) in items" :key="it.label" class="r">
      <div class="lab">{{ it.label }}</div>
      <div class="track">
        <div class="bar" :style="{ width: pct(it.value), background: it.color || 'var(--accent)' }" />
        <div v-if="it.lo != null" class="wh" :style="{ left: pct(it.lo), width: `calc(${pct(it.hi)} - ${pct(it.lo)})` }" />
        <div v-if="refLine" class="ref" :style="{ left: pct(refLine.value) }"><span v-if="n === 0">{{ refLine.label }}</span></div>
      </div>
      <div class="val">{{ it.value.toFixed(decimals) }}{{ unit }}<small v-if="it.note">{{ it.note }}</small></div>
    </div>
  </div>
</template>
<style scoped>
.r { display: grid; grid-template-columns: minmax(110px, 170px) 1fr minmax(96px, 150px); gap: 10px; align-items: center; margin: 7px 0; font-size: 0.88rem; }
.lab { color: var(--ink-2); }
.track { position: relative; height: 20px; background: var(--surface-2); border-radius: 4px; }
.bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
.wh { position: absolute; top: 8px; height: 4px; background: var(--ink); opacity: 0.55; border-radius: 2px; }
.ref { position: absolute; top: -3px; bottom: -3px; border-left: 2px dashed var(--ink); }
.ref span { position: absolute; top: -16px; left: 3px; font-size: 0.7rem; white-space: nowrap; color: var(--ink-2); }
.val { font-variant-numeric: tabular-nums; font-weight: 600; }
.val small { display: block; font-weight: 400; font-size: 0.74rem; color: var(--ink-2); line-height: 1.2; }
</style>
