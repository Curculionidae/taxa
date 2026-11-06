# News unread marks

`NewsUnreadDot.vue` marks news posts this browser has not opened yet:

- a red dot on the "News" link in the top bar (on phones also on the menu
  button, since the menu itself is hidden), shown while any post is unread;
- a red "New" label after the title of each unread post, wherever posts are
  listed with a linked `<h3>` title: the `/news` page and the home page news
  widget.

A post counts as read only once its own page (`/news/:id`) is opened. Opening
the `/news` list does not clear anything.

Registered in the project-root `layout.js` (`header:after` slot). It renders
nothing visible itself: it sets `data-news-unread` on `<html>` (the dot's CSS
keys on that plus any header link whose `href` ends in `/news`, so renaming
the menu entry's link in `config/header.yml` breaks the match), and writes one
CSS rule per unread post (`h3 a[href$='/news/<id>']`) into a `<style>` element
for the labels.

How it decides:

- It needs the 20 newest posts (`GET /news?per=20`, through the package's
  `News` service). The answer is cached in `localStorage` key
  `tp-news-latest` for 24 hours (`CACHE_HOURS`), so most page loads make no
  request. On news pages it fetches fresh once per page load, so a visitor
  reading the news sees new posts at once.
- `localStorage` key `tp-news-read` holds `{ since, read }`: posts older than
  `since` count as seen, `read` lists the ids of newer posts the visitor has
  opened (capped at 200). Only posts newer than `since` are recorded, so
  reading the archive cannot push recent posts out of the list. Same storage
  as the dark mode and curator mode toggles: per browser, not synced between
  devices.
- On a first visit `since` is set to 30 days back (`FRESH_DAYS`) and stored,
  so the window stays fixed: a post that was new then stays new until opened.
- The state is also kept in memory, so with storage blocked (some private
  modes) the marks stay right within a visit; each full page load then acts
  as a first visit.
- If the news request fails, no marks, but an opened post is still recorded
  as read.

Not covered: pinned posts (`pinned_news_id` in `config/news.yml`, none set)
render with an unlinked `<h2>` title and get no label.
