-- Run this in your Supabase SQL Editor to create the salah_times table
-- Dashboard > SQL Editor > New Query > Paste & Run

CREATE TABLE IF NOT EXISTS public.salah_times (
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
  early_zohr     text,
  adhan          jsonb       DEFAULT '{}',
  special_times  jsonb       DEFAULT '{}',
  next_change    jsonb       DEFAULT '{}',
  extended_times jsonb       DEFAULT '{}',
  announcements  jsonb       DEFAULT '[]',
  updated_at     timestamptz DEFAULT now(),
  updated_by     text
);

-- Allow public read access (anon key)
ALTER TABLE public.salah_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.salah_times
  FOR SELECT USING (true);

CREATE POLICY "Allow anon insert/update" ON public.salah_times
  FOR ALL USING (true) WITH CHECK (true);

-- Migration: run these if the table already exists
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS juma_salah     text;
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS juma_adhan     text;
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS juma_sunan     text;
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS juma_speaker   text;
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS early_zohr     text;
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS next_change    jsonb DEFAULT '{}';
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS extended_times jsonb DEFAULT '{}';
ALTER TABLE public.salah_times ADD COLUMN IF NOT EXISTS announcements  jsonb DEFAULT '[]';
