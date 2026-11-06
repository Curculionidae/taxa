<!--
  Marks news posts this browser has not opened yet: a red dot on the "News"
  link in the top bar, and a "New" label after the title of each unread post
  wherever it is listed (news page, home page news widget). See readme.md in
  this folder.

  Placed on every page by the project's layout.js in the `header:after`
  slot. Renders nothing visible itself: it sets `data-news-unread` on <html>
  for the dot, and writes one CSS rule per unread post for the labels.
-->
<template>
  <span hidden />
</template>

<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { News } from '@/modules/news/services/News'
import { makeNews } from '@/modules/news/adapters/makeNews'

const STORAGE_KEY = 'tp-news-read'
const CACHE_KEY = 'tp-news-latest'

// Other pages reuse the fetched post list for this long. News pages always
// fetch it fresh, so a visitor reading the news sees new posts at once.
const CACHE_HOURS = 24

// Posts checked for "unread". More new posts than this at once is unlikely.
const POSTS_CHECKED = 20

// A first-time visitor (or one whose browser keeps nothing) sees as new only
// posts younger than this. A "new" badge on an old post misleads.
const FRESH_DAYS = 30

// Upper bound on remembered post ids, so the stored list cannot grow forever.
const MAX_READ_IDS = 200

const route = useRoute()

// Kept in memory as well, so the marks stay right within a visit even when
// the browser blocks storage.
let state = null
let posts = null
let styleElement = null

function postIdFromPath(path) {
  const match = path.match(/\/news\/(\d+)/)

  return match ? Number(match[1]) : null
}

function isNewsPath(path) {
  return /\/news(\/|$)/.test(path)
}

function readStorage(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

// { since, read }: posts older than `since` count as seen; `read` holds the
// ids of newer posts the visitor has opened.
function loadState() {
  const stored = readStorage(STORAGE_KEY)

  if (stored && !isNaN(new Date(stored.since)) && Array.isArray(stored.read)) {
    return stored
  }

  const since = new Date(Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000)
  const fresh = { since: since.toISOString(), read: [] }

  // Stored at once, so the 30-day window stays fixed from the first visit:
  // a post that was new then stays new until it is opened.
  writeStorage(STORAGE_KEY, fresh)

  return fresh
}

// The newest posts as [{ id, createdAt }], from the cache when it is recent
// enough and `fresh` is not asked for. Null when the request fails.
async function loadPosts({ fresh = false } = {}) {
  const cached = readStorage(CACHE_KEY)
  const age = Date.now() - new Date(cached?.fetchedAt)

  if (!fresh && Array.isArray(cached?.posts) && age < CACHE_HOURS * 60 * 60 * 1000) {
    return cached.posts.map((post) => ({ ...post, createdAt: new Date(post.createdAt) }))
  }

  try {
    // The API lists the newest post first.
    const { data } = await News.where({ per: POSTS_CHECKED })
    const list = (data || []).map(makeNews).map(({ id, createdAt }) => ({ id, createdAt }))

    writeStorage(CACHE_KEY, { fetchedAt: new Date().toISOString(), posts: list })

    return list
  } catch {
    return null
  }
}

function unreadIds() {
  const since = new Date(state.since)

  return (posts || [])
    .filter((post) => post.createdAt > since && !state.read.includes(post.id))
    .map((post) => post.id)
}

function render() {
  const ids = unreadIds()

  document.documentElement.toggleAttribute('data-news-unread', ids.length > 0)

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.dataset.source = 'news-unread'
    document.head.appendChild(styleElement)
  }

  styleElement.textContent = ids.length
    ? ids.map((id) => `h3 a[href$='/news/${id}']`).join(',\n') +
      ' { --news-unread-label: "New"; }'
    : ''
}

function markRead(id) {
  const post = posts?.find((item) => item.id === id)

  // Only posts that can count as new are worth remembering. Recording old
  // archive posts would push recent ones out of the capped list. With no
  // post list (request failed) the id is kept, to be on the safe side.
  if (posts && (!post || post.createdAt <= new Date(state.since))) return

  if (!state.read.includes(id)) {
    state.read = [...state.read, id].slice(-MAX_READ_IDS)
    writeStorage(STORAGE_KEY, state)
  }
}

// Set once a fresh list was fetched; later news pages in the same visit
// reuse it.
let hasFreshPosts = false

async function update(path, { fresh = false } = {}) {
  const wantsFresh = fresh && !hasFreshPosts

  if (wantsFresh || !posts) {
    const list = await loadPosts({ fresh: wantsFresh })

    if (list) {
      posts = list
      hasFreshPosts ||= wantsFresh
    }
  }

  const openId = postIdFromPath(path)

  if (openId) markRead(openId)

  render()
}

onMounted(() => {
  state = loadState()
  update(route.path, { fresh: isNewsPath(route.path) })
})

watch(
  () => route.path,
  (path) => {
    if (state && isNewsPath(path)) update(path, { fresh: true })
  }
)

onBeforeUnmount(() => {
  document.documentElement.removeAttribute('data-news-unread')
  styleElement?.remove()
})
</script>

<style>
/* Red dot on the News link (desktop menu, mobile menu) and on the mobile
   menu button, which is all a phone shows of the menu. */
html[data-news-unread] .tp-header-nav a[href$='/news'],
html[data-news-unread] .tp-mobile-navbar-button {
  position: relative;
}

html[data-news-unread] .tp-header-nav a[href$='/news']::after,
html[data-news-unread] #mobile-menu a[href$='/news']::after,
html[data-news-unread] .tp-mobile-navbar-button::after {
  content: '';
  position: absolute;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: var(--color-danger);
}

/* Desktop: top right of the word. */
html[data-news-unread] .tp-header-nav a[href$='/news']::after {
  top: 0;
  right: -0.6rem;
}

/* Mobile menu: the link fills the row, so the dot sits after the word. */
html[data-news-unread] #mobile-menu a[href$='/news']::after {
  position: static;
  display: inline-block;
  margin-left: 0.4rem;
  vertical-align: super;
}

/* Mobile menu button: top right corner of the icon. */
html[data-news-unread] .tp-mobile-navbar-button::after {
  top: 0.25rem;
  right: 0.25rem;
}

/* "New" label after an unread post's title. The script sets the variable
   only on unread posts' title links. */
h3 a[href*='/news/']::after {
  content: var(--news-unread-label, none);
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
  background: var(--color-danger);
  color: var(--color-white);
}
</style>
