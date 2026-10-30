import { getStore } from "@netlify/blobs";

// Anonymous visitor counts for the public page.
// POST {cid}  : heartbeat from an open page (on load and every 2 minutes)
//   h/<YYYY-MM-DD>/<HH>/<cid>   one key per browser per Japan hour  -> hourly unique visitors
//   p/<bucket>/<cid>            one key per browser per 2-minute bucket -> "viewing now"
// GET         : { now, today, week, last24:[{h,n}], byHour:[24 averages over 7 days] }
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const CID = /^[a-z0-9]{12,40}$/;
const BUCKET = 2 * 60 * 1000;
const parts = (ms) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const g = (t) => f.find((x) => x.type === t).value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: g("hour") };
};

async function nowCount(store) {
  const b = Math.floor(Date.now() / BUCKET);
  const seen = new Set();
  for (const k of [b, b - 1]) {
    const { blobs } = await store.list({ prefix: `p/${k}/` });
    for (const x of blobs) seen.add(x.key.split("/")[2]);
  }
  return seen.size;
}

export default async (req) => {
  const store = getStore({ name: "visits", consistency: "strong" });
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const cid = String((body && body.cid) || "");
    if (!CID.test(cid)) return json({ error: "bad_request" }, 400);
    const t = Date.now(), p = parts(t);
    await Promise.all([
      store.set(`h/${p.day}/${p.hour}/${cid}`, "1"),
      store.set(`p/${Math.floor(t / BUCKET)}/${cid}`, "1"),
    ]);
    return json({ now: await nowCount(store) });
  }
  if (req.method !== "GET") return json({ error: "method" }, 405);

  const t = Date.now();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(parts(t - i * 864e5).day);
  const perHour = {}; // "day hour" -> count
  const perDay = {};  // day -> Set(cid)
  await Promise.all(
    days.map(async (d) => {
      const { blobs } = await store.list({ prefix: `h/${d}/` });
      perDay[d] = new Set();
      for (const x of blobs) {
        const [, day, hour, cid] = x.key.split("/");
        perHour[`${day} ${hour}`] = (perHour[`${day} ${hour}`] || 0) + 1;
        perDay[d].add(cid);
      }
    })
  );
  const last24 = [];
  for (let i = 23; i >= 0; i--) {
    const p = parts(t - i * 36e5);
    last24.push({ h: p.hour, d: p.day, n: perHour[`${p.day} ${p.hour}`] || 0 });
  }
  const byHour = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    const sum = days.reduce((a, d) => a + (perHour[`${d} ${hh}`] || 0), 0);
    byHour.push(Math.round((sum / days.length) * 10) / 10);
  }
  const week = new Set();
  for (const d of days) for (const c of perDay[d]) week.add(c);
  return json({
    now: await nowCount(store),
    today: perDay[days[days.length - 1]].size,
    week: week.size,
    hourNow: parts(t).hour,
    last24,
    byHour,
  });
};

export const config = { path: "/api/visits" };
