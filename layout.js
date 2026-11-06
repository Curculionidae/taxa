// Project contributions to the framework's layout regions (see the package's
// src/utils/loadLayoutSlots.js and modules/otus/constants/regions.js).
// Imported eagerly at app start. The curator entries render only in curator
// mode, see panels/_shared/curatorMode/readme.md; the news dot is described in
// panels/_shared/newsUnread/readme.md.
import CuratorModeButton from './panels/_shared/curatorMode/CuratorModeButton.vue'
import OtuTaxonWorksButton from './panels/_shared/curatorMode/OtuTaxonWorksButton.vue'
import NewsUnreadDot from './panels/_shared/newsUnread/NewsUnreadDot.vue'

export default {
  // Renders nothing here: the "Leave curator mode" button moves itself into
  // the top bar.
  // The news dot also renders nothing here: it marks the News link with CSS.
  'header:after': [CuratorModeButton, NewsUnreadDot],

  // Taxon page, next to the JSON and DwC download buttons.
  'taxa_page:header:actions:end': OtuTaxonWorksButton
}
