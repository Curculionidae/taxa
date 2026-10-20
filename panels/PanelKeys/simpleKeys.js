import { makeAPIRequest } from '@/utils/request'

// Simple keys (is_virtual leads: a root plus a flat list of OTUs, no couplets,
// e.g. key 35019 for Datonychus) are left out of /otus/:id/inventory/keys on
// purpose (Lead.public_root_leads_for_leaf_otus filters is_virtual), and /leads
// only returns them with is_virtual=true. Both the project's list and each key's
// OTUs are the same for every page, so they are cached for the session.
let simpleKeysPromise = null
const simpleKeyOtusCache = new Map()

export function loadSimpleKeys() {
  if (!simpleKeysPromise) {
    simpleKeysPromise = makeAPIRequest
      .get('/leads', { params: { is_virtual: true, per: 500 } })
      .then(({ data }) => (Array.isArray(data) ? data.filter((l) => l.is_virtual) : []))
      .catch(() => {
        simpleKeysPromise = null
        return []
      })
  }
  return simpleKeysPromise
}

// At most this many /leads/key/:id requests run at once, so a project with many
// simple keys does not flood the API on the first OTU page of a session.
const MAX_PARALLEL = 4
let running = 0
const waiting = []

function limited(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      task()
        .then(resolve, reject)
        .finally(() => {
          running--
          waiting.shift()?.()
        })
    }
    if (running < MAX_PARALLEL) run()
    else waiting.push(run)
  })
}

// OTU ids listed in one simple key (the root's children). The requests carry no
// abort signal on purpose: the result is cached for the session, so a request
// still running when the panel unmounts is reused on the next OTU page.
export function loadSimpleKeyOtus(leadId) {
  if (!simpleKeyOtusCache.has(leadId)) {
    const promise = limited(() => makeAPIRequest.get(`/leads/key/${leadId}`))
      .then(({ data }) => {
        const ids = new Set()
        for (const lead of Object.values(data?.data?.leads || {})) {
          if (lead?.target_type === '/api/v1/otus' && lead.target_id != null) {
            ids.add(lead.target_id)
          }
        }
        return ids
      })
      .catch(() => {
        simpleKeyOtusCache.delete(leadId)
        return new Set()
      })
    simpleKeyOtusCache.set(leadId, promise)
  }
  return simpleKeyOtusCache.get(leadId)
}
