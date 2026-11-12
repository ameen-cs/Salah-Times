// Shared server-side access to the Netlify Database (Postgres).
//
// Used by the /api/db function (browser reads + admin writes) and by the scheduled
// sync-times function. Nothing in the browser talks to the database directly.
//
// Every query is parameterised, and column / filter names come from the allow-lists
// below, never from request data, so a request can only touch the salah_times table.

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

let pool;
// Lazy so unit tests (and anything that injects its own pool) never need the package.
export async function getPool() {
  if (!pool) {
    const { getDatabase } = await import("@netlify/database");
    pool = getDatabase().pool;
  }
  return pool;
}

export async function queryRows(db, filters = {}) {
  const params = [];
  const where = [];
  for (const [key, value] of Object.entries(filters)) {
    if (!FILTERABLE.has(key)) throw new BadRequest(`Cannot filter by "${key}"`);
    params.push(String(value));
    where.push(`${key}::text = $${params.length}`);
  }
  const sql = `SELECT * FROM ${TABLE}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY mosque_id`;
  const { rows } = await db.query(sql, params);
  return rows;
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
    const data = { ...row };
    // The column is NOT NULL, so a brand-new row needs a name. Fall back to the id, but
    // only for the insert: an existing row keeps its real name when none is sent.
    const nameFallback = data.mosque_name == null;
    if (nameFallback) data.mosque_name = data.mosque_id;

    const cols = [];
    const marks = [];
    const params = [];
    for (const key of Object.keys(data)) {
      if (!WRITABLE.has(key)) continue;
      const value = data[key];
      params.push(JSON_COLUMNS.includes(key) ? (value == null ? null : JSON.stringify(value))
                  : value == null ? null : String(value));
      const cast = JSON_COLUMNS.includes(key) ? "::jsonb" : TIME_COLUMNS.includes(key) ? "::timestamptz" : "";
      cols.push(key);
      marks.push(`$${params.length}${cast}`);
    }
    const updates = cols
      .filter(c => c !== "mosque_id" && !(nameFallback && c === "mosque_name"))
      .map(c => `${c} = EXCLUDED.${c}`);
    const sql =
      `INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${marks.join(", ")}) ` +
      `ON CONFLICT (mosque_id) DO UPDATE SET ${updates.length ? updates.join(", ") : "mosque_id = EXCLUDED.mosque_id"} ` +
      `RETURNING *`;
    const { rows } = await db.query(sql, params);
    saved.push(rows[0]);
  }
  return saved;
}

export class BadRequest extends Error {}
