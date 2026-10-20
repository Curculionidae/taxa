<!--
  The package's nomenclature references panel, unchanged, plus a curator-mode
  pencil after each reference (edit the source in TaxonWorks). See readme.md.
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
import { ref, useAttrs } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import packagePanel from '@/modules/otus/components/Panel/PanelNomenclatureReferences/main.js'
import { twEditUrl, twSourcePageUrl } from '../_shared/curatorMode/curatorMode.js'
import { hasPdf } from '../_shared/curatorMode/sourcePdfs.js'
import { useOverlayPencils, addRowLinks, hasRowPencil } from '../_shared/curatorMode/overlayPencils.js'
import { plainKey, searchSourceId } from '../_shared/curatorMode/sourceIds.js'
import { fetchAllPages } from '../_shared/fetchAllPages.js'
import { loadNomenclatureSources } from './lib/nomenclatureSources.js'

defineOptions({ inheritAttrs: false })

const PackagePanel = packagePanel.component
const attrs = useAttrs()
const rootRef = ref(null)

let sourcesFor = { taxonId: null, promise: null }
const searched = new Map() // reference text -> promise of a source id
const busy = new WeakSet()

function getSources(taxonId) {
  if (sourcesFor.taxonId !== taxonId) {
    sourcesFor = {
      taxonId,
      promise: loadNomenclatureSources(taxonId, fetchAllPages).catch(() => new Map())
    }
  }

  return sourcesFor.promise
}

// A reference the cited names do not explain (cited on a relationship, for
// example) is looked up by its text, once.
function searchOnce(key) {
  if (!searched.has(key)) {
    searched.set(key, searchSourceId(makeAPIRequest, key).catch(() => null))
  }

  return searched.get(key)
}

// Package markup: each reference is `<li><span title="…" v-html>`. The
// pencil goes at the right end of the row, vertically centred.
function decorate(root) {
  const taxonId = Number(attrs.taxonId ?? attrs['taxon-id'])
  const spans = [...root.querySelectorAll('li > span[title]')].filter(
    (span) => !hasRowPencil(span.parentElement) && !busy.has(span)
  )

  if (!taxonId || !spans.length) return

  spans.forEach((span) => busy.add(span))

  getSources(taxonId).then((index) => {
    for (const span of spans) {
      const key = plainKey(span.innerHTML)
      const known = index.get(key)

      ;(known !== undefined ? Promise.resolve(known) : searchOnce(key))
        .then((id) => id && hasPdf(id).then((withPdf) => addRowLinks(span.parentElement, sourceLinks(id, withPdf))))
        .finally(() => busy.delete(span))
    }
  })
}

// Edit the source; and, when it has a PDF, its TaxonWorks page listing it.
function sourceLinks(id, withPdf) {
  return [
    { href: twEditUrl.source(id), title: 'Edit in TaxonWorks' },
    withPdf && { href: twSourcePageUrl(id), icon: 'document', title: 'PDF: open the source in TaxonWorks, which lists its documents' }
  ]
}

useOverlayPencils(rootRef, decorate)
</script>
