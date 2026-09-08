<template>
  <span>{{ count.toLocaleString() }}</span>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { fetchValidSpeciesCount } from './lib/validSpeciesCount.js'

const count = ref('??')

onMounted(() => {
  fetchValidSpeciesCount().then((total) => {
    if (total != null) count.value = total
  })
})
</script>
