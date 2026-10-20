import { fetchAllPages } from '../../_shared/fetchAllPages.js'
import { createTaxonNameIdLoader } from './taxonNameIds.js'

// One loader for the whole app, so a node shown twice is looked up once.
export const nameIdLoader = createTaxonNameIdLoader((url, params) =>
  fetchAllPages(url, params)
)
