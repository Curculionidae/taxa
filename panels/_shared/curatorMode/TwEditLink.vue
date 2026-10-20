<!--
  Pencil link to a TaxonWorks edit page, shown only in curator mode (see
  curatorMode.js). Renders nothing for the public, and nothing while `href`
  is not known yet.
-->
<template>
  <a
    v-if="isCuratorMode && href"
    :href="href"
    target="_blank"
    rel="noopener"
    :title="title"
    :aria-label="title"
    :class="linkClassFor(icon)"
    @click.stop
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      :class="iconClass"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :d="ICON_PATHS[icon] || ICON_PATHS.pencil"
      />
    </svg>
  </a>
</template>

<script setup>
import { useCuratorMode } from './curatorMode.js'
import { ICON_PATHS, linkClassFor } from './pencilIcon.js'

const isCuratorMode = useCuratorMode()

defineProps({
  href: {
    type: String,
    default: null
  },

  title: {
    type: String,
    default: 'Edit in TaxonWorks'
  },

  iconClass: {
    type: String,
    default: 'size-5'
  },

  // 'pencil' (default), 'photo', 'open' or 'document'
  icon: {
    type: String,
    default: 'pencil'
  }
})

</script>
