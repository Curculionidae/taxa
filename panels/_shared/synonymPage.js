/**
 * synonymPage.js
 *
 * Whether the OTU page is a synonym's (its name is not valid). On such a page
 * the panels show only what is recorded under that exact name; by default
 * TaxonWorks adds the valid name's and every synonym's records ("coordinate
 * OTUs": `coordinate_otus`, `otu_scope[]=coordinate_otus`, `coordinatify`).
 * The valid name's page stays merged. Same rule as the package panels since
 * taxonpages PR 380 (`taxon.is_valid !== false` there). An OTU without a taxon
 * name has no `is_valid` and counts as valid.
 *
 * Depended on by:
 *   - ../PanelMapV2/PanelMapV2.vue
 *   - ../PanelGallery/PanelGallery.vue
 *   - ../PanelAssertedDistributions/PanelAssertedDistributions.vue
 *   - ../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue
 *   - ../PanelContentV2/PanelContentV2.vue (content of the name's own OTU only)
 *
 * @param {object|undefined} taxon  the page's `taxon` prop
 * @returns {boolean}
 */
export function isSynonymPage(taxon) {
  return taxon?.is_valid === false
}
