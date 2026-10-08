<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import HowToRead from './components/HowToRead.vue'

const MODULES = [
  { id: 'overview', n: 0, group: 'Start', title: 'The big picture', hint: 'What rPPG is and where compression enters', c: defineAsyncComponent(() => import('./modules/Overview.vue')) },
  { id: 'waves', n: 'A', group: 'Foundations', title: 'Waves and frequency', hint: 'Hz, bpm, phase, adding waves', c: defineAsyncComponent(() => import('./modules/Waves.vue')) },
  { id: 'sampling', n: 'B', group: 'Foundations', title: 'Sampling a signal', hint: 'Frames per second, Nyquist, aliasing', c: defineAsyncComponent(() => import('./modules/Sampling.vue')) },
  { id: 'fourier', n: 'C', group: 'Foundations', title: 'Fourier and the spectrum', hint: 'Window length, leakage, noise', c: defineAsyncComponent(() => import('./modules/Fourier.vue')) },
  { id: 'filter', n: 'D', group: 'Foundations', title: 'Filters and harmonics', hint: 'Band-pass, and why repeats make a comb', c: defineAsyncComponent(() => import('./modules/Filters.vue')) },
  { id: 'skin', n: 1, group: 'The pipeline', title: 'Pulse in the colour', hint: 'Skin colour changes with every heartbeat', c: defineAsyncComponent(() => import('./modules/Skin.vue')) },
  { id: 'trace', n: 2, title: 'Video to colour trace', hint: 'Averaging pixels into three numbers per frame', c: defineAsyncComponent(() => import('./modules/Trace.vue')) },
  { id: 'pos', n: 3, title: 'Colour to pulse', hint: 'POS and CHROM, step by step', c: defineAsyncComponent(() => import('./modules/Pos.vue')) },
  { id: 'hr', n: 4, title: 'Pulse to heart rate', hint: 'The spectrum and its peak', c: defineAsyncComponent(() => import('./modules/HeartRate.vue')) },
  { id: 'codec', n: 5, group: 'Compression', title: 'What compression does', hint: 'Keyframes, quantisation, bitrate', c: defineAsyncComponent(() => import('./modules/Codec.vue')) },
  { id: 'keyframe', n: 6, title: 'The keyframe artefact', hint: 'Step by step: why the heart rate reads 60', c: defineAsyncComponent(() => import('./modules/Keyframe.vue')) },
  { id: 'results', n: 7, group: 'Wrap-up', title: 'What we found', hint: 'Results, nulls and open questions', c: defineAsyncComponent(() => import('./modules/Results.vue')) },
  { id: 'lab', n: 8, title: 'Lab', hint: 'Play with every knob at once', c: defineAsyncComponent(() => import('./modules/Lab.vue')) },
]

const safe = (fn, d) => { try { return fn() } catch { return d } }
const fromHash = () => MODULES.find((m) => m.id === location.hash.slice(1))?.id ?? 'overview'
const current = ref(fromHash())
const visited = ref(new Set(safe(() => JSON.parse(localStorage.getItem('rppg-visited') || '[]'), [])))
const menu = ref(false)
const theme = ref(safe(() => localStorage.getItem('rppg-theme'), null))

const mod = computed(() => MODULES.find((m) => m.id === current.value))
const idx = computed(() => MODULES.indexOf(mod.value))

function go(id) {
  current.value = id
  location.hash = id
  menu.value = false
  window.scrollTo({ top: 0 })
}
watch(current, (id) => {
  visited.value.add(id)
  safe(() => localStorage.setItem('rppg-visited', JSON.stringify([...visited.value])))
  document.title = `${mod.value.title} · rPPG Explorer`
}, { immediate: true })
watch(theme, (t) => {
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
  safe(() => (t ? localStorage.setItem('rppg-theme', t) : localStorage.removeItem('rppg-theme')))
}, { immediate: true })
onMounted(() => window.addEventListener('hashchange', () => (current.value = fromHash())))
const cycleTheme = () => (theme.value = theme.value === 'dark' ? 'light' : theme.value === 'light' ? null : 'dark')
</script>

<template>
  <div class="shell">
    <header class="top">
      <button class="burger btn" :aria-expanded="menu" aria-label="Modules" @click="menu = !menu">Modules</button>
      <div class="brand"><span class="logo" aria-hidden="true">♥</span> rPPG Explorer</div>
      <button class="btn small" :title="'Theme: ' + (theme ?? 'system')" @click="cycleTheme">Theme: {{ theme ?? 'system' }}</button>
    </header>

    <nav class="nav" :class="{ open: menu }" aria-label="Modules">
      <ol>
        <li v-for="(m, i) in MODULES" :key="m.id">
          <h4 v-if="m.group && m.group !== MODULES[i - 1]?.group" class="grp">{{ m.group }}<span v-if="m.group === 'Foundations'"> · optional background</span></h4>
          <button :class="{ on: m.id === current, seen: visited.has(m.id) && m.id !== current }" :aria-current="m.id === current ? 'page' : undefined" @click="go(m.id)">
            <span class="num">{{ m.n }}</span>
            <span class="txt"><b>{{ m.title }}</b><small>{{ m.hint }}</small></span>
          </button>
        </li>
      </ol>
      <p class="foot small muted">Real data: UBFC-rPPG recordings, encoded with x264 on this machine. Every curve is computed from video, not drawn by hand.</p>
    </nav>

    <main>
      <div class="page">
        <HowToRead :id="mod.id" class="howto" />
        <div class="body">
          <Suspense>
            <component :is="mod.c" :key="mod.id" v-bind="mod.id === 'overview' ? { onGo: go } : {}" />
            <template #fallback><p class="muted">Loading module…</p></template>
          </Suspense>
        </div>
      </div>
      <div class="pager">
        <button v-if="idx > 0" class="btn" @click="go(MODULES[idx - 1].id)">← {{ MODULES[idx - 1].title }}</button><span v-else />
        <button v-if="idx < MODULES.length - 1" class="btn primary" @click="go(MODULES[idx + 1].id)">{{ MODULES[idx + 1].title }} →</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 300px minmax(0, 1fr); grid-template-rows: auto 1fr; min-height: 100vh; }
.top { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--surface); position: sticky; top: 0; z-index: 5; }
.brand { font-weight: 700; letter-spacing: -0.01em; }
.logo { color: var(--accent); margin-right: 4px; }
.burger { display: none; }
.nav { border-right: 1px solid var(--line); padding: 16px 12px; position: sticky; top: 49px; align-self: start; max-height: calc(100vh - 49px); overflow-y: auto; }
.nav ol { list-style: none; margin: 0; padding: 0; }
.nav li button { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; padding: 9px 10px; border: 0; background: transparent; border-radius: 9px; margin-bottom: 2px; }
.nav li button:hover { background: var(--surface-2); }
.nav li button.on { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--accent); }
.num { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 0.78rem; font-weight: 700; background: var(--surface-2); color: var(--ink-2); margin-top: 1px; }
.on .num { background: var(--accent); color: #fff; }
.seen .num { background: var(--green); color: #fff; }
.txt { display: flex; flex-direction: column; min-width: 0; }
.txt b { font-size: 0.92rem; }
.txt small { color: var(--ink-2); font-size: 0.78rem; line-height: 1.3; }
.grp { margin: 12px 10px 4px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
.grp span { text-transform: none; letter-spacing: 0; }
.foot { padding: 10px; }
main { padding: 26px clamp(16px, 4vw, 48px) 60px; max-width: 1060px; width: 100%; }
.page { display: flex; flex-direction: column; gap: 16px; }
.body { min-width: 0; }
@media (min-width: 1320px) {
  main { max-width: 1440px; }
  .page { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; gap: 28px; }
  .howto { order: 2; }
}
.pager { display: flex; justify-content: space-between; gap: 10px; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); }
@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; }
  .burger { display: inline-block; }
  .nav { display: none; position: fixed; inset: 49px 0 0 0; background: var(--bg); z-index: 4; max-height: none; border-right: 0; }
  .nav.open { display: block; }
}
</style>
