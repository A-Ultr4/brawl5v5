import { getStore } from "@netlify/blobs";

// Live player stats for the public page.
// Tags come from the published tournament data; numbers come from Brawl Time Ninja.
// Cached in Netlify Blobs and refreshed at most once per TTL, on demand.
const DATA_URL = "https://raw.githubusercontent.com/A-Ultr4/brawl5v5/data/state.json";
const TTL = 55 * 60 * 1000;
const MIN_FORCE = 5 * 60 * 1000;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const RANK = { BRONZE: "ブロンズ", SILVER: "シルバー", GOLD: "ゴールド", DIAMOND: "ダイヤモンド", MYTHIC: "神話", LEGENDARY: "レジェンダリー", MASTERS: "マスター", MASTER: "マスター", PRO: "プロ" };
const JA = {
  "SHELLY": "シェリー", "COLT": "コルト", "BULL": "ブル", "BROCK": "ブロック", "RICO": "リコ", "SPIKE": "スパイク", "BARLEY": "バーリー",
  "JESSIE": "ジェシー", "NITA": "ニタ", "DYNAMIKE": "ダイナマイク", "EL PRIMO": "エル・プリモ", "MORTIS": "モーティス", "CROW": "クロウ",
  "POCO": "ポコ", "BO": "ボウ", "PIPER": "エリザベス", "PAM": "パム", "TARA": "タラ", "DARRYL": "ダリル", "PENNY": "ペニー",
  "FRANK": "フランケン", "GENE": "ジーン", "TICK": "ティック", "LEON": "レオン", "ROSA": "ローサ", "CARL": "カール", "BIBI": "ビビ",
  "8-BIT": "8ビット", "SANDY": "サンディ", "BEA": "ビー", "EMZ": "Emz", "MR. P": "Mr.P", "MAX": "MAX", "JACKY": "ジャッキー",
  "GALE": "ゲイル", "NANI": "ナーニ", "SPROUT": "スプラウト", "SURGE": "サージ", "COLETTE": "コレット", "AMBER": "アンバー",
  "LOU": "ルー", "BYRON": "バイロン", "EDGAR": "エドガー", "RUFFS": "ラフス", "STU": "スチュー", "BELLE": "ベル", "SQUEAK": "スクウィーク",
  "GROM": "グロム", "BUZZ": "バズ", "GRIFF": "グリフ", "ASH": "アッシュ", "MEG": "メグ", "LOLA": "ローラ", "FANG": "ファング",
  "EVE": "イヴ", "JANET": "ジャネット", "BONNIE": "ボニー", "OTIS": "オーティス", "SAM": "サム", "GUS": "ガス", "BUSTER": "バスター",
  "CHESTER": "チェスター", "GRAY": "グレイ", "MANDY": "マンディ", "R-T": "R-T", "WILLOW": "ウィロー", "MAISIE": "メイジー",
  "HANK": "ハンク", "CORDELIUS": "コーデリアス", "DOUG": "ダグ", "PEARL": "パール", "CHUCK": "チャック", "CHARLIE": "チャーリー",
  "MICO": "ミコ", "KIT": "キット", "LARRY & LAWRIE": "ラリー&ローリー", "MELODIE": "メロディー", "ANGELO": "アンジェロ",
  "DRACO": "ドラコ", "LILY": "リリー", "BERRY": "ベリー", "CLANCY": "クランシー", "MOE": "モー", "KENJI": "ケンジ", "SHADE": "シェイド",
  "JUJU": "ジュジュ", "MEEPLE": "ミープル", "OLLIE": "オーリー", "LUMI": "ルミ", "FINX": "フィンクス", "JAE-YONG": "ジェヨン",
  "KAZE": "カゼ", "ALLI": "アリー", "TRUNK": "トランク", "MINA": "ミナ", "ZIGGY": "ジギー", "GIGI": "ジジ", "PIERCE": "ピアース",
};
const rankJa = (n) => {
  if (!n) return "";
  const [t, num] = String(n).trim().split(/\s+/);
  const ja = RANK[t] || t;
  return num ? `${ja} ${num}` : ja;
};
const nameJa = (n) => {
  const k = String(n || "").toUpperCase();
  return JA[k] || k.charAt(0) + k.slice(1).toLowerCase();
};

async function fetchPlayer(tag) {
  const url = "https://brawltime.ninja/api/player.byTag?input=" + encodeURIComponent(JSON.stringify({ json: tag }));
  const r = await fetch(url, { headers: { "user-agent": "brawl5v5-tournament-site (hourly, 10 players)", accept: "application/json" } });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  const p = j && j.result && j.result.data && j.result.data.json;
  if (!p || typeof p.trophies !== "number") throw new Error("no data");
  const bs = Array.isArray(p.brawlers) ? p.brawlers : Object.values(p.brawlers || {});
  let top = null;
  for (const b of bs) if (!top || (b.trophies || 0) > (top.trophies || 0)) top = b;
  return {
    trophies: p.trophies,
    highest: p.highestTrophies,
    wins3v3: p["3vs3Victories"],
    level: p.expLevel,
    club: (p.club && p.club.name) || "",
    brawlers: bs.length,
    prestige: p.totalPrestigeLevel,
    rank: rankJa(p.rankedRankName),
    rankBest: rankJa(p.highestAllTimeRankedRankName),
    topBrawler: top ? `${nameJa(top.name)}（${Number(top.trophies || 0).toLocaleString("en-US")}）` : "",
  };
}

async function refresh(store, old) {
  const st = await fetch(DATA_URL + "?t=" + Date.now()).then((r) => r.json());
  const tags = [];
  for (const k of ["blue", "red"]) for (const m of (st.teams && st.teams[k] && st.teams[k].members) || []) if (m.tag) tags.push(String(m.tag).replace(/^#/, "").toUpperCase());
  const players = {}, errors = {};
  await Promise.all(
    tags.map(async (t) => {
      const o = old && old.players && old.players[t];
      try {
        const n = await fetchPlayer(t);
        if (o && typeof o.trophies === "number" && o.trophies !== n.trophies) n.trophiesPrev = o.trophies;
        else if (o && o.trophiesPrev != null) n.trophiesPrev = o.trophiesPrev;
        players[t] = n;
      } catch (e) {
        errors[t] = String((e && e.message) || e);
        if (o) players[t] = o;
      }
    })
  );
  const out = { at: new Date().toISOString(), players, errors };
  if (Object.keys(players).length) await store.setJSON("latest", out);
  return out;
}

export default async (req) => {
  const store = getStore({ name: "stats", consistency: "strong" });
  let cur = null;
  try { cur = await store.get("latest", { type: "json" }); } catch {}
  const age = cur && cur.at ? Date.now() - Date.parse(cur.at) : Infinity;
  const force = new URL(req.url).searchParams.get("refresh") === "1" && age > MIN_FORCE;
  if (!cur || force || age > TTL) {
    try { cur = await refresh(store, cur); }
    catch (e) { if (!cur) return json({ error: String((e && e.message) || e) }, 502); }
  }
  return json(cur);
};

export const config = { path: "/api/stats" };
