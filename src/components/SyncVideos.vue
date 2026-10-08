<script setup>
// N clips of the same recording played from one transport. The first clip is the clock; the
// others are nudged back whenever they drift by more than ~1.5 frames. Each clip gets an SVG
// overlay slot whose coordinate system is the ORIGINAL 640x480 frame (viewBox crops it for the
// zoomed clips), so one overlay definition works for every clip.
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  clips: { type: Array, required: true },       // [{name, label, viewBox?}]  name -> /data/hero/<name>.mp4|webm
  fps: { type: Number, required: true },
  duration: { type: Number, default: 0 },       // seconds (from the trace length)
  start: { type: Number, default: 0 },
  loop: { type: Boolean, default: true },
  cols: { type: Number, default: 0 },
  showTransport: { type: Boolean, default: true },
})
const emit = defineEmits(['time'])

const base = import.meta.env.BASE_URL + 'data/hero/'
const vids = ref([])
const playing = ref(false)
const t = ref(props.start)
const ready = ref(false)
const failed = ref(false)
let rvfcHandle = 0

const frame = computed(() => Math.max(0, Math.round(t.value * props.fps)))
const total = computed(() => props.duration || vids.value[0]?.duration || 0)

function setT(v, fromClock = false) {
  t.value = v
  emit('time', v)
  if (!fromClock) for (const el of vids.value) if (el) el.currentTime = v
}

function tick(_now, meta) {
  const master = vids.value[0]
  if (!master) return
  const mt = meta?.mediaTime ?? master.currentTime
  setT(mt, true)
  for (let i = 1; i < vids.value.length; i++) {
    const el = vids.value[i]
    if (el && Math.abs(el.currentTime - mt) > 1.5 / props.fps) el.currentTime = mt
  }
  schedule()
}
function schedule() {
  const master = vids.value[0]
  if (!master || !playing.value) return
  if (master.requestVideoFrameCallback) rvfcHandle = master.requestVideoFrameCallback(tick)
  else rvfcHandle = requestAnimationFrame(() => tick(0, null))
}

async function play() {
  try {
    playing.value = true
    await Promise.all(vids.value.map((v) => v?.play()))
    schedule()
  } catch (e) { playing.value = false }
}
function pause() {
  playing.value = false
  for (const v of vids.value) v?.pause()
  if (vids.value[0]?.cancelVideoFrameCallback && rvfcHandle) vids.value[0].cancelVideoFrameCallback(rvfcHandle)
  else cancelAnimationFrame(rvfcHandle)
}
const toggle = () => (playing.value ? pause() : play())
function seek(v) { setT(Math.min(Math.max(v, 0), Math.max(0, total.value - 1 / props.fps))) }
function ended() { if (props.loop) { seek(0); play() } else pause() }
function onLoaded(e) {
  // a clip (re)loaded: put it at the shared time and join playback if the transport is running
  e.target.currentTime = t.value
  if (playing.value) e.target.play().catch(() => {})
  ready.value = vids.value.every((v) => v && v.readyState >= 1)
}

onBeforeUnmount(pause)

defineExpose({ seek, play, pause, t, frame })
const gridCols = computed(() => props.cols || Math.min(props.clips.length, 3))
</script>

<template>
  <div class="sv">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }">
      <figure v-for="(c, i) in clips" :key="c.name" class="clip">
        <div class="frame" :style="{ aspectRatio: c.viewBox ? `${c.viewBox[2]} / ${c.viewBox[3]}` : '4 / 3' }">
          <video :ref="(el) => (vids[i] = el)" muted playsinline preload="auto" :loop="false"
                 @loadedmetadata="onLoaded" @ended="i === 0 && ended()" @error="failed = true">
            <source :src="`${base}${c.name}.mp4`" type="video/mp4" />
            <source :src="`${base}${c.name}.webm`" type="video/webm" />
          </video>
          <svg class="ov" :viewBox="(c.viewBox || [0, 0, 640, 480]).join(' ')" preserveAspectRatio="none">
            <slot name="overlay" :clip="c" :frame="frame" :t="t" />
          </svg>
        </div>
        <figcaption>{{ c.label }}</figcaption>
      </figure>
    </div>
    <div v-if="showTransport" class="tr">
      <button class="btn primary" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">{{ playing ? 'Pause' : 'Play' }}</button>
      <input type="range" min="0" :max="Math.max(total, 0.1)" step="0.01" :value="t" aria-label="Seek" @input="(e) => seek(+e.target.value)" />
      <span class="mono">{{ t.toFixed(1) }} s · frame {{ frame }}</span>
    </div>
    <p v-if="failed" class="callout warn small">This browser could not decode the clip. Try Chrome, Firefox or Safari.</p>
  </div>
</template>

<style scoped>
.grid { display: grid; gap: 10px; }
.clip { margin: 0; }
.frame { position: relative; width: 100%; background: #000; border-radius: 8px; overflow: hidden; }
video { width: 100%; height: 100%; display: block; object-fit: fill; }
.ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
figcaption { font-size: 0.82rem; color: var(--ink-2); margin-top: 4px; }
.tr { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
.tr input { flex: 1; accent-color: var(--accent); }
.tr .mono { white-space: nowrap; min-width: 128px; text-align: right; }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr !important; } }
</style>
