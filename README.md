# brawl5v5

Public site for the Brawl Stars 5v5 tournament (Netlify).

- `public/index.html` — the page (deployed by Netlify; changes here use deploy credits)
- `netlify/functions/rating.mjs` — `/api/rating` star-rating API (Netlify Blobs)
- `netlify/functions/cheer.mjs` — `/api/cheer` daily cheer + streak API (Netlify Blobs)
- `netlify/functions/stats.mjs` — `/api/stats` live player numbers from Brawl Time Ninja (cached ~1h in Netlify Blobs)
- `netlify/functions/visits.mjs` — `/api/visits` anonymous visitor counts (viewing now, hourly, 7-day by hour)
- `data` branch, `state.json` — live tournament data the page loads at runtime (no deploy needed)
