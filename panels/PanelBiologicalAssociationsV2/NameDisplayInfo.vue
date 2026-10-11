<template>
  <span data-copy-ignore>
    <button ref="trigger" type="button" class="cursor-pointer rounded text-xs font-normal text-base-soft"
      :aria-label="`About ${side} names`" :aria-expanded="open" :aria-controls="helpId"
      @click="open = !open" @keydown.escape.stop="close">ⓘ</button>
    <Teleport to="body">
      <div v-if="open" ref="overlay" :id="helpId" role="region" :aria-label="`About ${side} names`" :style="position"
        class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-xs font-normal normal-case leading-snug shadow-lg">
        Show original names displays the name recorded in each association, followed by “now” and its current accepted name when different. Only the accepted name links to an OTU page.
      </div>
    </Teleport>
  </span>
</template>

<script setup>
import { ref, useId } from 'vue'
import { useAnchoredPopover } from './useAnchoredPopover.js'
defineProps({ side: { type: String, required: true } })
const open = ref(false)
const helpId = `name-display-help-${useId()}`
function close() { open.value = false }
const { trigger, overlay, position } = useAnchoredPopover(open, close)
</script>
