<script setup>
import { computed } from 'vue'
import katex from 'katex'
const props = defineProps({ tex: { type: String, required: true }, block: { type: Boolean, default: false } })
const html = computed(() => katex.renderToString(props.tex, { displayMode: props.block, throwOnError: false }))
</script>
<template><span :class="{ eq: block }" v-html="html" /></template>
