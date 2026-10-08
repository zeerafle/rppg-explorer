<script setup>
import { computed } from 'vue'
const props = defineProps({ steps: { type: Array, required: true }, modelValue: { type: Number, default: 0 } })
const emit = defineEmits(['update:modelValue'])
const i = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
</script>
<template>
  <div class="stepper">
    <ol role="tablist" aria-label="Steps">
      <li v-for="(s, k) in steps" :key="k">
        <button role="tab" :aria-selected="k === i" :class="{ on: k === i, done: k < i }" :title="s" @click="i = k">
          <span class="n">{{ k + 1 }}</span><span class="t">{{ s }}</span>
        </button>
      </li>
    </ol>
    <div class="body"><slot :index="i" /></div>
    <div class="nav">
      <button class="btn" :disabled="i === 0" @click="i--">Back</button>
      <span class="muted small">Step {{ i + 1 }} of {{ steps.length }}</span>
      <button class="btn primary" :disabled="i === steps.length - 1" @click="i++">Next</button>
    </div>
  </div>
</template>
<style scoped>
ol { list-style: none; display: flex; gap: 6px; padding: 0; margin: 0 0 14px; overflow-x: auto; }
li { flex: 1 0 auto; }
button[role='tab'] { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; text-align: left; font-size: 0.8rem; color: var(--ink-2); }
button[role='tab'] .n { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); font-weight: 700; font-size: 0.78rem; }
button[role='tab'].done .n { background: var(--green); color: #fff; }
button[role='tab'].on { border-color: var(--accent); color: var(--ink); font-weight: 600; }
button[role='tab'].on .n { background: var(--accent); color: #fff; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.t { white-space: nowrap; }
@media (max-width: 900px) { .t { display: none; } button[role='tab'].on .t { display: inline; } }
.nav { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
</style>
