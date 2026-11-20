<!--
  Lookup box and result of the curator page (CuratorPage.vue).

  Props
    initial  the text to show in the box (the page's ?lookup= value)
    busy     a lookup is running: the button is disabled and says so
    result   null before the first lookup, else
             { error }  a plain message (invalid input, TaxonWorks has no such
                        record, used by no record), with optional `details` lines
             or { text, links, status, notes }
               text    the explanation (placement/format.js formatExplanation),
                       shown as is in a <pre>, the same text as the build's --explain
               links   [{ label, href }] into TaxonWorks (record, area, OTU)
               status  { listed, text }: what the cache says about the record
               notes   further plain lines (outlines not cached, ...)
  Emits
    find(text)  the curator pressed Find (or Enter); the page parses the text
-->
<template>
  <section class="flex flex-col gap-4">
    <form
      class="flex flex-wrap items-end gap-3"
      @submit.prevent="emit('find', text)"
    >
      <div class="min-w-[14rem] flex-1 sm:max-w-sm">
        <label
          class="block text-sm font-semibold"
          for="placement-lookup"
        >
          Record or area
        </label>
        <input
          id="placement-lookup"
          v-model="text"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="AD 556796"
          class="mt-1 box-border block w-full min-w-0 rounded-md border border-base-soft bg-base-foreground px-3 py-2 font-mono text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
      </div>
      <button
        type="submit"
        class="rounded-md bg-secondary px-4 py-2 font-semibold text-secondary-content disabled:opacity-60"
        :disabled="busy"
      >
        {{ busy ? 'Finding' : 'Find' }}
      </button>
      <p class="w-full text-sm text-base-soft">
        A kind and an id: GA (geographic area), GZ (gazetteer), AD (asserted distribution),
        CO (specimen) or FO (field occurrence), for example AD 556796 or GZ 10453.
      </p>
    </form>

    <div
      v-if="result?.error"
      class="rounded-md border border-warning bg-base-foreground px-3 py-2 text-sm text-base-content"
      role="status"
    >
      <p>{{ result.error }}</p>
      <p
        v-for="line in result.details || []"
        :key="line"
        class="mt-1"
      >
        {{ line }}
      </p>
    </div>

    <template v-else-if="result">
      <pre
        class="overflow-x-auto rounded-md border border-base-muted bg-base-foreground p-3 font-mono text-xs leading-relaxed text-base-content"
      >{{ result.text }}</pre>

      <p
        class="text-sm font-semibold"
        :class="result.status.listed ? 'text-base-content' : 'text-danger'"
      >
        {{ result.status.text }}
      </p>

      <p
        v-if="result.differs"
        class="text-sm font-semibold text-base-content"
      >
        {{ result.differs }}
      </p>

      <p
        v-for="note in result.notes"
        :key="note"
        class="text-sm text-base-content"
      >
        {{ note }}
      </p>

      <ul
        v-if="result.links.length"
        class="flex flex-wrap gap-x-4 gap-y-1 text-sm"
      >
        <li
          v-for="link in result.links"
          :key="link.href"
        >
          <a
            :href="link.href"
            target="_blank"
            rel="noopener"
            class="text-secondary hover:underline"
          >{{ link.label }}</a>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  initial: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  result: { type: Object, default: null }
})

const emit = defineEmits(['find'])
const text = ref(props.initial)

watch(() => props.initial, (value) => { text.value = value })
</script>
