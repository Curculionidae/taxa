import { SPECIES_GROUP, SPECIES_AND_INFRASPECIES_GROUP } from '../../../constants'
import PanelTypeSpecimen from './PanelTypeSpecimen.vue'

export default {
  id: 'panel:type-specimen',
  component: PanelTypeSpecimen,
  available: [SPECIES_GROUP, SPECIES_AND_INFRASPECIES_GROUP]
}
