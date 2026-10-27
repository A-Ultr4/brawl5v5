import { getStore } from "@netlify/blobs";

// Site rating store. Keys:
//   v/<round>/<stars>/<cid>  one vote per browser per round (value = ISO time)
//   r/<round>                first vote time for that round (for ordering)
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function summary(store) {
  const { blobs } = await store.list({ prefix: "v/" });
  const map = {};
  for (const b of blobs) {
    const parts = b.key.split("/");
    if (parts.length !== 4) continue;
    const n = Number(parts[2]);
    if (!(n >= 1 && n <= 5)) continue;
    let k;
    try { k = decodeURIComponent(parts[1]); } catch { continue; }
    (map[k] ||= [0, 0, 0, 0, 0])[n - 1]++;
  }
  const since = {};
  const meta = await store.list({ prefix: "r/" });
  await Promise.all(
    meta.blobs.map(async (b) => {
      try { since[decodeURIComponent(b.key.slice(2))] = (await store.get(b.key)) || ""; } catch {}
    })
  );
  return Object.keys(map)
    .map((k) => {
      const d = map[k];
      const count = d.reduce((a, v) => a + v, 0);
      const sum = d.reduce((a, v, i) => a + v * (i + 1), 0);
      return { round: k, count, avg: count ? Math.round((sum / count) * 100) / 100 : 0, dist: d, since: since[k] || "" };
    })
    .sort((a, b) => (b.since || "").localeCompare(a.since || ""));
}

export default async (req) => {
  const store = getStore({ name: "ratings", consistency: "strong" });
  if (req.method === "GET") return json({ rounds: await summary(store) });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const round = String((body && body.round) || "").trim().slice(0, 40);
  const stars = Number(body && body.stars);
  const cid = String((body && body.cid) || "");
  if (!round || !Number.isInteger(stars) || stars < 1 || stars > 5 || !/^[a-z0-9]{12,40}$/.test(cid)) {
    return json({ error: "bad_request" }, 400);
  }
  const r = encodeURIComponent(round);
  const now = new Date().toISOString();
  await Promise.all([1, 2, 3, 4, 5].filter((n) => n !== stars).map((n) => store.delete(`v/${r}/${n}/${cid}`)));
  await store.set(`v/${r}/${stars}/${cid}`, now);
  try { await store.set(`r/${r}`, now, { onlyIfNew: true }); } catch {}
  return json({ ok: true, rounds: await summary(store) });
};

export const config = { path: "/api/rating" };
