<!--
  Red "Leave curator mode" button in the top bar, shown only in curator mode
  (panels/_shared/curatorMode/curatorMode.js).

  Placed on every page by the project's layout.js in the `header:after`
  slot. The top bar itself has no slot, so the button is moved into it with
  a Teleport, once the page is mounted (the bar must be in the document).
-->
<template>
  <Teleport
    v-if="isMounted && isCuratorMode"
    to=".tp-header .container"
  >
    <button
      type="button"
      class="curator-mode-button max-md:ml-auto md:ml-4 px-2.5 py-1 rounded-md text-xs font-medium bg-danger hover:bg-danger/85 text-white cursor-pointer whitespace-nowrap"
      title="Hide the Edit in TaxonWorks links again"
      @click="leave"
    >
      Leave curator mode
    </button>
  </Teleport>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { leaveCuratorMode, useCuratorMode } from './curatorMode.js'

const isCuratorMode = useCuratorMode()

const route = useRoute()
const router = useRouter()
const isMounted = ref(false)

onMounted(() => {
  isMounted.value = true
})

function leave() {
  leaveCuratorMode()

  // A `?curator=1` still in the address would turn it on again on reload.
  if ('curator' in route.query) {
    const { curator, ...query } = route.query

    router.replace({ query })
  }
}
</script>

<style>
/* Phones: the bar shows only the logo and the menu button. Keep the menu
   button last, so this button sits between the two, not in the middle. */
.tp-header .tp-mobile-navbar-button {
  order: 1;
}
</style>
