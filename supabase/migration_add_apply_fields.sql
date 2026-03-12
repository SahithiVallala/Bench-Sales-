-- Migration: Add job-application fields to resumes table
-- Run this in Supabase SQL Editor

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS linkedin_url        TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_url       TEXT,
  ADD COLUMN IF NOT EXISTS city                TEXT,
  ADD COLUMN IF NOT EXISTS state               TEXT,
  ADD COLUMN IF NOT EXISTS zip_code            TEXT,
  ADD COLUMN IF NOT EXISTS current_company     TEXT,
  ADD COLUMN IF NOT EXISTS notice_period       TEXT,
  ADD COLUMN IF NOT EXISTS cover_letter_template TEXT;
