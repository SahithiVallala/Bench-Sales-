-- JD Inbox Migration
-- Run this in Supabase SQL Editor after the initial schema.sql

CREATE TABLE IF NOT EXISTS jd_emails (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_id        TEXT UNIQUE NOT NULL,        -- Outlook message ID
    subject         TEXT,
    sender          TEXT,
    received_at     TIMESTAMPTZ,
    body_text       TEXT,                        -- extracted plain text
    attachment_name TEXT,                        -- if JD was in attachment
    jd_text         TEXT,                        -- final extracted JD content
    ai_title        TEXT,                        -- AI-extracted job title
    ai_company      TEXT,                        -- AI-extracted company
    ai_skills       TEXT[] DEFAULT '{}',         -- AI-extracted required skills
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast ordering by received date
CREATE INDEX IF NOT EXISTS idx_jd_emails_received_at ON jd_emails (received_at DESC);

-- Index for sender lookups
CREATE INDEX IF NOT EXISTS idx_jd_emails_sender ON jd_emails (sender);
