-- Creates the table that stores each masjid's Jamaat times, Jumu'ah details and admin edits.
--
-- There are no row-level-security policies. The browser never connects to the database;
-- every read and write goes through the /api/db function, which checks the admin
-- password before allowing writes.

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
