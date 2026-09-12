<template>
  <div class="tp-autocomplete md:block relative w-fit">
    <div
      class="flex absolute inset-y-0 left-0 items-center pl-3 pointer-events-none"
    >
      <IconSearch
        class="w-4 h-4 text-base-soft"
        aria-hidden="true"
      />
    </div>
    <InputText
      ref="inputElement"
      v-model="typed"
      type="text"
      role="combobox"
      :autofocus="autofocus"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="list.length > 0"
      aria-controls="autocomplete-listbox"
      :aria-activedescendant="activeDescendant"
      class="tp-autocomplete__input bg-base-foreground block box-border w-full pl-10"
      :placeholder="placeholder"
      @input="trigger"
      @keydown="handleKeydown"
    />
    <AutocompleteSpinner
      v-if="isSearching"
      class="tp-autocomplete__spinner hidden absolute top-1/2 -translate-y-1/2 right-2 h-5 w-5"
    />

    <ul
      v-if="list.length"
      id="autocomplete-listbox"
      class="tp-autocomplete__list list absolute z-[500] max-h-52 w-full overflow-y-auto border bg-base-foreground border-base-border !m-0 rounded-md shadow-lg mt-1"
      role="listbox"
    >
      <li
        v-for="(item, index) in list"
        :id="`autocomplete-option-${index}`"
        :key="item.id"
        class="tp-autocomplete__item px-3 py-2 border-b text-xs text-base-content cursor-pointer hover:bg-secondary/5 border-base-border truncate flex items-center gap-1.5"
        :class="{
          'bg-secondary/10': index === activeIndex,
          'tp-autocomplete__item--plant': isPlantItem(item)
        }"
        role="option"
        :aria-selected="index === activeIndex"
        @mousedown.prevent="selectItem(item)"
      >
        <svg
          v-if="isPlantItem(item)"
          class="tp-autocomplete__leaf w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        ><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z" /></svg>
        <span v-html="label ? item[label] : item" />
      </li>
    </ul>
  </div>
</template>

<script>
import { reactive } from 'vue'

// Module scope (this <script> block, not <script setup>, only runs once
// per module load) so every Autocomplete instance on the page shares one
// cache — a name looked up once isn't re-fetched by a different instance
// or after this component remounts.
const nomenclaturalCodeCache = reactive(new Map())
const fetchingIds = new Set()
</script>

<script setup>
import { ref, computed, watch } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import AutocompleteSpinner from '@/components/Autocomplete/AutocompleteSpinner.vue'
import './autocomplete-tokens.css'

const props = defineProps({
  autofocus: {
    type: Boolean,
    default: false
  },

  placeholder: {
    type: String,
    default: 'Search...'
  },

  url: {
    type: String,
    required: true
  },

  queryParam: {
    type: String,
    default: 'term'
  },

  params: {
    type: Object,
    default: () => ({})
  },

  label: {
    type: String,
    default: undefined
  },

  retainInput: {
    type: Boolean,
    default: false
  }
})

const typed = defineModel('input', {
  type: String,
  default: ''
})

const emit = defineEmits(['select'])
const list = ref([])
const isSearching = ref(false)
const inputElement = ref(null)
const activeIndex = ref(-1)

const activeDescendant = computed(() =>
  activeIndex.value >= 0
    ? `autocomplete-option-${activeIndex.value}`
    : undefined
)

watch(list, () => {
  activeIndex.value = -1
})

// Rows on the OTU-name search (see modules/otus/views/Index.vue, which uses
// this component directly with these props) get a leaf icon + green tint
// when the underlying name is nomenclatural code ICN (plants, but also
// fungi/algae — a simplification that's safe for this weevil/host-plant
// project, no algae/fungi OTUs expected).
const isOtuSearch = computed(() => props.url === '/otus/autocomplete')

function taxonNameId(item) {
  const match = /title="(\d+)"/.exec(item?.label_html || '')
  return match ? Number(match[1]) : null
}

function isPlantItem(item) {
  if (!isOtuSearch.value) return false

  const id = taxonNameId(item)

  return id != null && nomenclaturalCodeCache.get(id) === 'icn'
}

async function fetchNomenclaturalCodes(ids) {
  const params = new URLSearchParams()

  ids.forEach((id) => {
    params.append('taxon_name_id[]', id)
    fetchingIds.add(id)
  })

  try {
    const { data } = await makeAPIRequest.get(`/taxon_names?${params}`)

    data.forEach((taxonName) => {
      nomenclaturalCodeCache.set(taxonName.id, taxonName.nomenclatural_code)
    })
  } catch {
    // leave uncached ids unresolved; they'll be retried on a later search
  } finally {
    ids.forEach((id) => fetchingIds.delete(id))
  }
}

const delay = 500
let timeout

function trigger(e) {
  clearTimeout(timeout)

  if (e.target.value.length) {
    timeout = setTimeout(() => {
      list.value = []
      isSearching.value = true

      makeAPIRequest
        .get(props.url, {
          params: {
            ...props.params,
            [props.queryParam]: typed.value
          }
        })
        .then(({ data }) => {
          list.value = data

          if (isOtuSearch.value) {
            const ids = [
              ...new Set(
                data
                  .map(taxonNameId)
                  .filter(
                    (id) =>
                      id != null &&
                      !nomenclaturalCodeCache.has(id) &&
                      !fetchingIds.has(id)
                  )
              )
            ]

            if (ids.length) fetchNomenclaturalCodes(ids)
          }
        })
        .catch(() => {})
        .finally(() => {
          isSearching.value = false
        })
    }, delay)
  } else {
    list.value = []
  }
}

function highlightItem() {
  const el = document.querySelector(`#${activeDescendant.value}`)

  el?.scrollIntoView({
    block: 'nearest',
    behavior: 'auto'
  })
}

function handleKeydown(e) {
  if (!list.value.length) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % list.value.length
      break
    case 'ArrowUp':
      e.preventDefault()
      activeIndex.value =
        activeIndex.value <= 0 ? list.value.length - 1 : activeIndex.value - 1
      break
    case 'Enter':
      if (activeIndex.value >= 0) {
        e.preventDefault()
        selectItem(list.value[activeIndex.value])
      }
      break
  }

  highlightItem()
}

const selectItem = (item) => {
  emit('select', item)

  if (props.retainInput) {
    typed.value = props.label ? item[props.label] : item
  } else {
    typed.value = ''
  }

  list.value = []
  activeIndex.value = -1
  inputElement.value.inputRef.blur()
}

function setFocus() {
  inputElement.value.inputRef.focus()
}

defineExpose({
  setFocus
})
</script>

<style lang="scss" scoped>
.tp-autocomplete {
  &__list {
    display: none;
    padding: 0px;
  }

  &__item {
    margin: 0px;
  }

  &__item--plant {
    // background-image (not background-color) so this always shows through
    // regardless of the hover:bg-secondary/5 and active bg-secondary/10
    // Tailwind utilities also applied to this element — separate CSS
    // properties, no specificity fight.
    background-image: linear-gradient(
      var(--pp-plant-tint),
      var(--pp-plant-tint)
    );
  }

  &__leaf {
    color: var(--pp-plant-icon);
  }

  &__input:focus ~ &__list {
    display: block;
  }

  &__input:focus ~ &__spinner {
    display: block;
  }
}
</style>
