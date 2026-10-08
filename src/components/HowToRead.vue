<script setup>
// Side panel "How to read this", one entry per module from lib/howto.json.
// Wide screens: sticky column right of the module. Narrow: collapsible block above it.
import { computed, ref, watch } from 'vue'
import HOWTO from '../lib/howto.json'

const props = defineProps({ id: { type: String, required: true } })
const doc = computed(() => HOWTO[props.id] ?? null)
const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 1320px)').matches
const open = ref(wide)   // always open as a side column; collapsed block on narrow screens
watch(() => props.id, () => { open.value = wide })
</script>

<template>
  <aside v-if="doc" class="htr" aria-label="How to read this module">
    <details :open="open" @toggle="open = $event.target.open">
      <summary>How to read this</summary>
      <p v-if="doc.intro" class="intro">{{ doc.intro }}</p>
      <section v-for="s in doc.sections" :key="s.for">
        <h4>{{ s.for }}</h4>
        <ul><li v-for="(r, i) in s.read" :key="i">{{ r }}</li></ul>
      </section>
      <p v-if="doc.takeaway" class="take"><b>Takeaway.</b> {{ doc.takeaway }}</p>
    </details>
  </aside>
</template>

<style scoped>
.htr { font-size: 0.86rem; line-height: 1.5; color: var(--ink-2); }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
summary { cursor: pointer; font-weight: 700; color: var(--ink); }
.intro { margin: 10px 0 4px; }
h4 { margin: 12px 0 4px; font-size: 0.84rem; color: var(--ink); }
ul { margin: 0; padding-left: 18px; }
li { margin: 3px 0; }
.take { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--line); color: var(--ink); }
@media (min-width: 1320px) {
  .htr { position: sticky; top: 74px; max-height: calc(100vh - 90px); overflow-y: auto; }
  summary { pointer-events: none; list-style: none; }
  summary::-webkit-details-marker { display: none; }
}
</style>
