<!--
  The package's own descendants panel, unchanged, plus curator-mode
  "Edit in TaxonWorks" pencils on every taxon name and synonym, added to its
  rendered HTML (lib/decorateTree.js). See readme.md.
-->
<template>
  <div
    ref="rootRef"
    class="contents"
  >
    <PackagePanel v-bind="$attrs" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import packagePanel from '@/modules/otus/components/Panel/PanelDescendants/main.js'
import { twEditUrl } from '../_shared/curatorMode/curatorMode.js'
import { useOverlayPencils } from '../_shared/curatorMode/overlayPencils.js'
import { nameIdLoader } from './lib/nameIdLoader.js'
import { decorateTree } from './lib/decorateTree.js'

defineOptions({ inheritAttrs: false })

const PackagePanel = packagePanel.component
const rootRef = ref(null)
const busy = new WeakSet()

useOverlayPencils(rootRef, (root) =>
  decorateTree(root, nameIdLoader, twEditUrl.taxonName, busy)
)
</script>
