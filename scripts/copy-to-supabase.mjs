// One-off: copy every row from the live site's current database (read through the
// public /api/db endpoint) into the Supabase salah_times table.
//
// Safe to re-run (rows are upserted by mosque_id). Reads only from the site.
//
// PowerShell, from the project folder:
//   $env:SUPABASE_PROJECT_URL = "https://api.supabase.superbbulk.co.za"
//   $env:SUPABASE_API_KEY = "<api key>"
//   node scripts/copy-to-supabase.mjs            (add --dry-run to only list the rows)

import { getPool, upsertRows } from "../netlify/lib/database.mjs";

const SITE = "https://stanger-salah-times.netlify.app";
const dryRun = process.argv.includes("--dry-run");

const res = await fetch(`${SITE}/api/db?nocache=1`);
if (!res.ok) { console.error(`Could not read ${SITE}/api/db: ${res.status}`); process.exit(1); }
const rows = await res.json();
console.log(`Read ${rows.length} rows from the live site.`);
for (const r of rows) console.log(`  ${r.mosque_id.padEnd(14)} ${r.updated_by || "-"}  ${r.updated_at}`);
if (dryRun) { console.log("Dry run: nothing written."); process.exit(0); }

const db = await getPool();
// updated_at / id come along as stored; upsertRows only writes known columns
const saved = await upsertRows(db, rows.map(({ id, ...rest }) => rest));
console.log(`Wrote ${saved.length} rows to Supabase.`);
