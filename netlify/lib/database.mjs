// Shared server-side access to the site's database: a Supabase project, reached
// through its REST API (PostgREST).
//
// Used by the /api/db function (browser reads + admin writes) and by the scheduled
// sync-times function. Nothing in the browser talks to the database directly, so the
// Supabase key never leaves the server.
//
// Set these in the Netlify dashboard (Project configuration > Environment variables):
//   SUPABASE_PROJECT_URL   e.g. https://api.supabase.superbbulk.co.za
//   SUPABASE_API_KEY       the project's API key (currently the anon key; the table has
//                          row-level security off, as the old setup did)
//
// Column and filter names come from the allow-lists below, never from request data, so a
// request can only touch the salah_times table. (Netlify Database version: see git
// history before the "Move data back to Supabase" commit.)

export const TABLE = "salah_times";

// Columns a client may write. Anything else in a payload is ignored.
const TEXT_COLUMNS = [
  "mosque_id", "mosque_name", "fajr", "zohr", "asar", "maghrib", "esha",
  "juma_khutbah", "juma_salah", "juma_adhan", "juma_sunan", "juma_speaker",
  "juma_note", "early_zohr", "updated_by",
];
const JSON_COLUMNS = ["adhan", "special_times", "next_change", "extended_times", "announcements"];
const TIME_COLUMNS = ["updated_at"];
const WRITABLE = new Set([...TEXT_COLUMNS, ...JSON_COLUMNS, ...TIME_COLUMNS]);

// Columns a client may filter reads by (equality only)
const FILTERABLE = new Set(["id", "mosque_id", "updated_by"]);

// The "pool" is just the connection details; it keeps the same shape the callers expect.
export async function getPool() {
  const url = process.env.SUPABASE_PROJECT_URL;
  const key = process.env.SUPABASE_API_KEY;
  if (!url || !key) throw new Error("SUPABASE_PROJECT_URL / SUPABASE_API_KEY are not set");
  return { url: url.replace(/\/+$/, ""), key };
}

async function rest(db, path, init = {}) {
  const res = await fetch(`${db.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: db.key,
      Authorization: `Bearer ${db.key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Status only: the response body can echo request details we don't want in logs
    throw new Error(`Supabase request failed (${res.status})`);
  }
  return res.status === 204 ? [] : res.json();
}

export async function queryRows(db, filters = {}) {
  const qs = ["select=*", "order=mosque_id"];
  for (const [key, value] of Object.entries(filters)) {
    if (!FILTERABLE.has(key)) throw new BadRequest(`Cannot filter by "${key}"`);
    qs.push(`${key}=eq.${encodeURIComponent(String(value))}`);
  }
  return rest(db, `${TABLE}?${qs.join("&")}`);
}

// Insert-or-update by mosque_id. Only the columns present in a row are written, so a
// partial row leaves the rest of that masjid's stored values alone.
export async function upsertRows(db, input) {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length) throw new BadRequest("No rows to save");
  const saved = [];
  for (const row of list) {
    if (!row || typeof row !== "object" || typeof row.mosque_id !== "string" || !row.mosque_id.trim()) {
      throw new BadRequest("Each row needs a mosque_id");
    }
    const data = {};
    for (const [key, value] of Object.entries(row)) {
      if (!WRITABLE.has(key)) continue;
      data[key] = value === undefined ? null
        : JSON_COLUMNS.includes(key) ? value
        : value == null ? null
        : TIME_COLUMNS.includes(key) ? String(value)
        : String(value);
    }
    // mosque_name is NOT NULL and Postgres checks that on the proposed insert row even
    // when the row already exists, so every write must carry a name. When none is sent,
    // reuse the stored one (so it stays unchanged), or fall back to the id for a new row.
    if (data.mosque_name == null) {
      const existing = await rest(db, `${TABLE}?select=mosque_name&mosque_id=eq.${encodeURIComponent(data.mosque_id)}`);
      data.mosque_name = existing[0]?.mosque_name || data.mosque_id;
    }
    const rows = await rest(db, `${TABLE}?on_conflict=mosque_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(data),
    });
    saved.push(rows[0]);
  }
  return saved;
}

export class BadRequest extends Error {}
