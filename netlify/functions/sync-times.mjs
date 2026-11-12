// Scheduled sync: pulls live Jamaat times from the masjid boards and stores them
// in the Netlify Database, so the database fallback stays fresh even on days nobody visits.
//
// Runs on Netlify's servers (3x daily, see `config.schedule` below). Scheduled
// functions only fire on the published production deploy and cannot be called over
// HTTP (Netlify answers 403) — use "Run now" on the function's page in the dashboard.
//
// Rather than re-implement the board parsers, this loads the site's own js/config.js
// and js/api.js into a sandbox and calls the same fetch/parse/save code the browser
// uses — so the two can never drift apart. The sandbox swaps the browser CORS proxy
// for direct requests (no CORS server-side) and skips the constructor's side effects.
//
// Chakaskraal runs its own site rather than a board; its scraper needs a DOM, so
// the sandbox is given linkedom's DOMParser.

import fs from "node:fs";
import { getPool, queryRows, upsertRows } from "../lib/database.mjs";
import path from "node:path";
import vm from "node:vm";
import { DOMParser } from "linkedom";

export const config = {
  // UTC: 04:00, 12:00 and 18:00 SAST
  schedule: "0 2,10,16 * * *",
};

const UA = "Mozilla/5.0 (SalahTimes scheduled sync)";

function readSiteFile(rel) {
  // netlify.toml `included_files` puts js/ next to the bundled function; fall back to cwd for `netlify dev`.
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", rel),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, "utf8"); } catch { /* try next */ }
  }
  throw new Error(`cannot read ${rel}`);
}

export function loadSiteCode(db) {
  const sandbox = {
    console,
    AbortSignal,
    DOMParser,
    URL,
    setTimeout,
    clearTimeout,
    db, // server-side database, in place of the browser client
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: (url, opts = {}) =>
      fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) } }),
  };
  const ctx = vm.createContext(sandbox);

  vm.runInContext(readSiteFile("js/config.js"), ctx, { filename: "config.js" });
  // Drop the trailing `const api = new SalahTimesAPI()` — its constructor fires browser-only probes.
  const apiSrc = readSiteFile("js/api.js").replace(/^const api = new SalahTimesAPI\(\);\s*$/m, "");
  vm.runInContext(apiSrc, ctx, { filename: "api.js" });
  // Direct requests: no CORS proxy needed on the server.
  vm.runInContext("PROXIES.length = 0; PROXIES.push(t => t);", ctx);

  const api = vm.runInContext(
    `(() => {
       const a = Object.create(SalahTimesAPI.prototype);
       a.mem = {}; a.overrides = {}; a.dbOverrides = {}; a._inflight = {};
       return a;
     })()`,
    ctx
  );
  const mosques = vm.runInContext("MOSQUES", ctx);
  return { api, mosques };
}

// Same query/upsert surface the site code expects from `db`, backed by the database directly.
// Failures return null (as the browser client does) so _saveToDb's checks still work.
export function serverDb(pool) {
  return {
    async query(_table, filters = {}) {
      try { return await queryRows(pool, filters); }
      catch (e) { console.error("[sync-times] query failed:", e.message); return null; }
    },
    async upsert(_table, data) {
      try { return await upsertRows(pool, data); }
      catch (e) { console.error("[sync-times] save failed:", e.message); return null; }
    },
  };
}

export default async function handler() {
  return runSync(await getPool());
}

export async function runSync(pool) {
  const db = serverDb(pool);
  const { api, mosques } = loadSiteCode(db);

  // Record whether each database write actually succeeded (_saveToDb swallows errors).
  let lastWriteOk = false;
  const realUpsert = db.upsert.bind(db);
  db.upsert = async (...args) => {
    const res = await realUpsert(...args);
    lastWriteOk = !!res;
    return res;
  };

  const results = [];
  for (const mosque of mosques.filter(m => m.boardId || m.scrapeUrl)) {
    try {
      const data = mosque.boardId
        ? await api._fetchLive(mosque.boardId)
        : await api._fetchScraped(mosque.scrapeUrl);
      if (!data) { results.push({ id: mosque.id, ok: false, error: "no live data" }); continue; }
      if (!data.special_times || !Object.keys(data.special_times).length) {
        data.special_times = mosque.defaults.special_times || {};
      }
      api._reconcileMaghrib(data);
      lastWriteOk = false;
      await api._saveToDb(mosque, data);
      results.push(lastWriteOk
        ? { id: mosque.id, ok: true, fajr: data.fajr, esha: data.esha }
        : { id: mosque.id, ok: false, error: "database write failed" });
    } catch (e) {
      results.push({ id: mosque.id, ok: false, error: String(e.message || e).slice(0, 120) });
    }
  }

  const synced = results.filter(r => r.ok).length;
  console.log(`[sync-times] ${synced}/${results.length} synced`, JSON.stringify(results));

  return new Response(JSON.stringify({ synced, total: results.length, results }, null, 2), {
    status: synced > 0 ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}
