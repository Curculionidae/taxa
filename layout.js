// Project contributions to the framework's layout regions (see the package's
// src/utils/loadLayoutSlots.js and modules/otus/constants/regions.js).
// Imported eagerly at app start. Both entries render only in curator mode,
// see panels/_shared/curatorMode/readme.md.
import CuratorModeButton from './panels/_shared/curatorMode/CuratorModeButton.vue'
import OtuTaxonWorksButton from './panels/_shared/curatorMode/OtuTaxonWorksButton.vue'

export default {
  // Renders nothing here: the "Leave curator mode" button moves itself into
  // the top bar.
  'header:after': CuratorModeButton,

  // Taxon page, next to the JSON and DwC download buttons.
  'taxa_page:header:actions:end': OtuTaxonWorksButton
}
