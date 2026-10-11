<template>
  <div class="flex flex-wrap items-center gap-2 text-sm text-base-content">
    <span
      v-if="label"
      class="text-base-soft"
    >
      {{ label }}
    </span>
    <button
      v-for="option in options"
      :key="option.label"
      type="button"
      class="px-2 py-1 rounded cursor-pointer"
      :class="
        modelValue === option.value
          ? 'bg-secondary text-secondary-content'
          : 'hover:underline'
      "
      :aria-pressed="modelValue === option.value"
      :title="option.title"
      @click="() => emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  // The chosen option's `value`.
  modelValue: {
    type: String,
    default: undefined
  },

  // `{ label, value, title? }`. One option may have no value: the default.
  options: {
    type: Array,
    required: true
  },

  label: {
    type: String,
    default: undefined
  }
})

const emit = defineEmits(['update:modelValue'])
</script>
