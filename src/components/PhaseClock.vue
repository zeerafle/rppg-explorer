<script setup>
// A clock face for the position inside a keyframe cycle: the keyframe is at 12 o'clock (phase 0),
// one full turn is one cycle (phase 1, just before the next keyframe).
import { computed } from 'vue'
const props = defineProps({ phase: { type: Number, default: 0 }, size: { type: Number, default: 120 }, color: { type: String, default: 'var(--accent)' } })
const a = computed(() => 2 * Math.PI * (Number.isFinite(props.phase) ? props.phase : 0) - Math.PI / 2)
const R = 44
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 100 100" role="img" :aria-label="`phase ${Number.isFinite(phase) ? phase.toFixed(2) : 'undefined'}`">
    <circle cx="50" cy="50" r="44" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1.5" />
    <path :d="`M50 50 L50 6 A44 44 0 ${phase > 0.5 ? 1 : 0} 1 ${50 + R * Math.cos(a)} ${50 + R * Math.sin(a)} Z`" :fill="color" opacity="0.18" />
    <line x1="50" y1="2" x2="50" y2="12" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
    <line x1="50" y1="50" :x2="50 + R * Math.cos(a)" :y2="50 + R * Math.sin(a)" :stroke="color" stroke-width="2" />
    <circle :cx="50 + R * Math.cos(a)" :cy="50 + R * Math.sin(a)" r="5" :fill="color" />
    <text x="50" y="62" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">{{ Number.isFinite(phase) ? phase.toFixed(2) : '–' }}</text>
    <text x="50" y="76" text-anchor="middle" font-size="8" fill="var(--ink-2)">phase</text>
    <text x="50" y="26" text-anchor="middle" font-size="7" fill="var(--ink-2)">keyframe</text>
  </svg>
</template>
