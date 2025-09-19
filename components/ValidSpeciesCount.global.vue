<template>
  <span>{{ count.toLocaleString() }}</span>
</template>

<script setup>
import { makeAPIRequest } from '@/utils'
import { onMounted, ref } from 'vue'

const count = ref('??')

onMounted(() => {
  makeAPIRequest
    .get('/taxon_names.json', {
      params: {
        per: 1,
        validity: true,
        taxon_name_id: [809411],
        rank: ['NomenclaturalRank::Iczn::SpeciesGroup::Species'],
        descendants: true
      }
    })
    .then((response) => {
      count.value = Number(response.headers['pagination-total'])
    })
})
</script>
