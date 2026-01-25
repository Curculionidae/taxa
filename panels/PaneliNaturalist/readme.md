I took this panel from the orthoptera species file repo. Minor adjustments:

- Images now open in a new tab: added `target="_blank" rel="noopener noreferrer"`
- Added hover opacity to image links: `class="block hover:opacity-90 transition"`
- Only research grade images shown (expected to have better image quality): added `quality_grade: 'research'` to the axios request

Changed image grid for better layout: 
```html
  <div class="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-3">
```

image size changed to medium:
```html
<div class="aspect-[3/2] overflow-hidden rounded">
  <img
    class="w-full h-full object-cover"
    :src="observation.observation_photos[0].photo.url.replace('square', 'medium')"
  />
</div>
```
