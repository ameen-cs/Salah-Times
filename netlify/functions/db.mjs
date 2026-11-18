// /api/db: the site's only door to the Netlify Database.
//
//   GET  /api/db?mosque_id=jamia&updated_by=admin   public read, optional equality filters
//   POST /api/db?action=login                       checks the admin password
//   POST /api/db                                    save a row (or array of rows); admin only
//
// Writes need the admin password in an `x-admin-password` header, checked here against
// the ADMIN_PASSWORD environment variable set in the Netlify dashboard. The password is
// never shipped to the browser.

import { createHash, timingSafeEqual } from "node:crypto";
import { getPool, queryRows, upsertRows, BadRequest } from "../lib/database.mjs";

export const config = { path: "/api/db" };

const json = (body, status = 200, headers = { "Cache-Control": "no-store" }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

// Public reads are cached at Netlify's CDN so most page views never reach the database
// (each query wakes it, and database compute is what costs credits). The cache has to
// outlast the database's 5-minute sleep timer or steady traffic keeps it awake all day,
// so the CDN serves for 6 hours and refreshes in the background. The stored rows only
// change on the 3 daily syncs or an admin edit. Browsers always revalidate. The admin
// page, a hard refresh and the Refresh button send nocache=1 to get live data.
const PUBLIC_READ_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-CDN-Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
  "Netlify-Vary": "query",
};

// Compare digests so length differences don't leak through timing
function passwordMatches(given, expected) {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

export function createHandler({ pool = getPool, env = process.env, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  return async function handler(req) {
    const url = new URL(req.url);
    try {
      if (req.method === "GET") {
        const filters = Object.fromEntries(url.searchParams.entries());
        const nocache = "nocache" in filters;
        delete filters.nocache;
        return json(await queryRows(await pool(), filters), 200, nocache ? undefined : PUBLIC_READ_HEADERS);
      }

      if (req.method === "POST") {
        if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set on the server" }, 500);
        const ok = passwordMatches(req.headers.get("x-admin-password"), env.ADMIN_PASSWORD);
        if (!ok) {
          await delay(400); // slows down password guessing
          return json({ error: "Unauthorised" }, 401);
        }
        if (url.searchParams.get("action") === "login") return json({ ok: true });

        let body;
        try { body = await req.json(); } catch { throw new BadRequest("Body must be JSON"); }
        return json(await upsertRows(await pool(), body));
      }

      return json({ error: "Method not allowed" }, 405);
    } catch (e) {
      if (e instanceof BadRequest) return json({ error: e.message }, 400);
      console.error("[db]", e);
      return json({ error: "Database error" }, 500);
    }
  };
}

export default createHandler();
