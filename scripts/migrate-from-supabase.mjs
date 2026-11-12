// One-off: copy every row from the old Supabase salah_times table into the Netlify Database.
//
// Safe to re-run (rows are upserted by mosque_id). It only READS from Supabase.
//
// 1. Apply the schema first (see setup.sql / README).
// 2. Get the Netlify database connection string:
//        netlify database status --show-credentials
// 3. Run, with the old Supabase details passed as environment variables (they are no
//    longer in the code):
//
//    PowerShell:
//      $env:SUPABASE_URL = "https://api.supabase.superbbulk.co.za"
//      $env:SUPABASE_KEY = "<the old anon key>"
//      $env:NETLIFY_DB_URL = "<connection string from step 2>"
//      node scripts/migrate-from-supabase.mjs
//
//    Add --dry-run to list what would be copied without writing anything.

import { getDatabase } from "@netlify/database";
import { upsertRows } from "../netlify/lib/database.mjs";

const { SUPABASE_URL, SUPABASE_KEY, NETLIFY_DB_URL } = process.env;
const dryRun = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_KEY first.");
  process.exit(1);
}
if (!dryRun && !NETLIFY_DB_URL) {
  console.error("Set NETLIFY_DB_URL (netlify database status --show-credentials), or use --dry-run.");
  process.exit(1);
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/salah_times?select=*`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
});
if (!res.ok) {
  console.error(`Supabase read failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
console.log(`Found ${rows.length} rows in Supabase:`);
for (const r of rows) console.log(`  ${r.mosque_id.padEnd(14)} fajr=${r.fajr ?? "-"} esha=${r.esha ?? "-"} updated_by=${r.updated_by ?? "-"} updated_at=${r.updated_at ?? "-"}`);

if (dryRun) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

const { pool } = getDatabase({ connectionString: NETLIFY_DB_URL });
const saved = await upsertRows(pool, rows);
console.log(`Copied ${saved.length} rows into the Netlify Database.`);
await pool.end?.();
