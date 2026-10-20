<!--
  The package's references panel (the taxon page's Bibliography tab,
  `panel:references-cited`), unchanged, plus a curator-mode pencil after each
  reference (edit the source in TaxonWorks). See readme.md.
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
import packagePanel from '@/modules/otus/components/Panel/PanelReferences/main.js'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'
import { twEditUrl, twSourcePageUrl } from '../_shared/curatorMode/curatorMode.js'
import { hasPdf } from '../_shared/curatorMode/sourcePdfs.js'
import { useOverlayPencils, addRowLinks, hasRowPencil } from '../_shared/curatorMode/overlayPencils.js'
import { indexSources, plainKey } from '../_shared/curatorMode/sourceIds.js'

defineOptions({ inheritAttrs: false })

const PackagePanel = packagePanel.component
const attrs = useAttrs()
const rootRef = ref(null)
const requestStore = useOtuPageRequestStore()

let sourcesFor = { otuId: null, promise: null }
const busy = new WeakSet()

// The source ids the rendered rows do not carry, from the panel's own
// response: the package keeps it in its page request store (key
// 'panel:citations', the one behind the panel's "API request" menu). Only if
// it is not there for this OTU is the request made again.
function loadCitations(otuId) {
  const path = `/otus/${otuId}/inventory/citations`
  const stored = requestStore.getRequest('panel:citations')

  if (stored?.data && String(stored.url ?? '').includes(path)) {
    return Promise.resolve(stored.data)
  }

  return makeAPIRequest.get(path).then(({ data }) => data)
}

function getSources(otuId) {
  if (sourcesFor.otuId !== otuId) {
    sourcesFor = {
      otuId,
      promise: loadCitations(otuId)
        .then((data) =>
          indexSources(
            data
              .flatMap((item) => item.citations || [])
              .map((citation) => citation.source)
              .filter(Boolean)
          )
        )
        .catch(() => new Map())
    }
  }

  return sourcesFor.promise
}

// Package markup: each reference is `<li><span v-html="source.cached">`
// followed by badges. The pencil goes at the right end of the row,
// vertically centred.
function decorate(root) {
  const otuId = Number(attrs.otuId ?? attrs['otu-id'])
  const spans = [...root.querySelectorAll('li > span:first-child')].filter(
    (span) => !hasRowPencil(span.parentElement) && !busy.has(span)
  )

  if (!otuId || !spans.length) return

  spans.forEach((span) => busy.add(span))

  getSources(otuId).then((index) => {
    for (const span of spans) {
      const id = index.get(plainKey(span.innerHTML))

      if (!id) {
        busy.delete(span)
        continue
      }
      hasPdf(id)
        .then((withPdf) => addRowLinks(span.parentElement, [
          { href: twEditUrl.source(id), title: 'Edit in TaxonWorks' },
          withPdf && { href: twSourcePageUrl(id), icon: 'document', title: 'PDF: open the source in TaxonWorks, which lists its documents' }
        ]))
        .finally(() => busy.delete(span))
    }
  })
}

useOverlayPencils(rootRef, decorate)
</script>
