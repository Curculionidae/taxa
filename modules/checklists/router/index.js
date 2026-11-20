// Routes of the checklists module: the public page and the curator page
// (curator mode only, see CuratorPage.vue).
export default [
  {
    name: 'checklists',
    path: '/checklists',
    component: () => import('../ChecklistsPage.vue')
  },
  {
    name: 'checklists-curator',
    path: '/checklists/curator',
    component: () => import('../CuratorPage.vue')
  }
]
