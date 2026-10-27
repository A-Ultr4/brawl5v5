# brawl5v5

Public site for the Brawl Stars 5v5 tournament (Netlify).

- `public/index.html` — the page (deployed by Netlify; changes here use deploy credits)
- `netlify/functions/rating.mjs` — `/api/rating` star-rating API (Netlify Blobs)
- `netlify/functions/cheer.mjs` — `/api/cheer` daily cheer + streak API (Netlify Blobs)
- `data` branch, `state.json` — live tournament data the page loads at runtime (no deploy needed)
