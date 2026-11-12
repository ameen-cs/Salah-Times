-- Reference copy of the schema. Netlify applies the migration in
-- netlify/database/migrations/ on deploy; this file only mirrors it for reading.

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
