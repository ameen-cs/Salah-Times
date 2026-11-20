-- Schema for the Supabase database the site uses. Run it once in the Supabase SQL editor.
-- (netlify/database/migrations/ holds the same table for the old Netlify Database.)

CREATE TABLE IF NOT EXISTS salah_times (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  mosque_id      text        NOT NULL UNIQUE,
  mosque_name    text        NOT NULL,
  fajr           text,
  zohr           text,
  asar           text,
  maghrib        text,
  esha           text,
  juma_khutbah   text,
  juma_salah     text,
  juma_adhan     text,
  juma_sunan     text,
  juma_speaker   text,
  juma_note      text,
  early_zohr     text,
  adhan          jsonb       DEFAULT '{}',
  special_times  jsonb       DEFAULT '{}',
  next_change    jsonb       DEFAULT '{}',
  extended_times jsonb       DEFAULT '{}',
  announcements  jsonb       DEFAULT '[]',
  updated_at     timestamptz DEFAULT now(),
  updated_by     text
);

-- Row-level security is left OFF so the site's server functions can write with the anon
-- key. Anyone holding that key can read and write this table, so move to a private
-- server-side key and turn RLS on (ALTER TABLE salah_times ENABLE ROW LEVEL SECURITY)
-- when possible.
