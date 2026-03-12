7-- ============================================================
-- Bench Sales Automation Platform — Supabase Schema
-- Run this in Supabase SQL Editor to create all tables
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- RESUMES
-- Stores uploaded candidate resumes + AI-extracted data
-- ────────────────────────────────────────────────────────────
CREATE TABLE resumes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_name      TEXT NOT NULL,
    email               TEXT,
    phone               TEXT,
    visa_status         TEXT,                    -- H1B, OPT, GC, USC, TN, EAD, CPT
    work_auth           TEXT,                    -- W2, C2C, 1099, Any
    current_location    TEXT,
    relocation          BOOLEAN DEFAULT FALSE,
    work_mode_pref      TEXT DEFAULT 'any',      -- remote, hybrid, onsite, any

    -- File info
    file_name           TEXT,
    file_url            TEXT,                    -- Supabase Storage URL

    -- AI-extracted fields (filled after parsing)
    parsed_text         TEXT,                    -- full text from PDF
    primary_role        TEXT,                    -- e.g. "Java Backend Developer"
    primary_skills      TEXT[] DEFAULT '{}',     -- ["Java","Spring Boot","AWS"]
    secondary_skills    TEXT[] DEFAULT '{}',
    experience_years    DECIMAL(4,1),
    education           TEXT,
    certifications      TEXT[] DEFAULT '{}',
    ai_summary          TEXT,                    -- short AI-generated paragraph
    rate_expectation    TEXT,                    -- e.g. "$65/hr" or "$90k/yr"

    extracted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- JOBS CACHE
-- Stores job search results to avoid repeat API calls (7-day TTL)
-- ────────────────────────────────────────────────────────────
CREATE TABLE jobs_cache (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               TEXT NOT NULL,
    company             TEXT,
    platform            TEXT,                    -- linkedin, indeed, naukri, dice, glassdoor, ziprecruiter, remotive
    job_url             TEXT UNIQUE,
    description         TEXT,
    location            TEXT,
    work_mode           TEXT,                    -- remote, hybrid, onsite
    job_type            TEXT,                    -- full_time, part_time, contract, internship
    experience_req      TEXT,
    skills_required     TEXT[] DEFAULT '{}',
    salary_range        TEXT,
    posted_date         DATE,
    search_params       JSONB,                   -- what query params produced this result
    is_expired          BOOLEAN DEFAULT FALSE,
    cached_at           TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- ────────────────────────────────────────────────────────────
-- JOB ASSIGNMENTS
-- Links a job to a resume BEFORE formal submission
-- One job can be assigned to many resumes; one resume can have many jobs
-- ────────────────────────────────────────────────────────────
CREATE TABLE job_assignments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id              UUID NOT NULL REFERENCES jobs_cache(id) ON DELETE CASCADE,
    resume_id           UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    match_score         INTEGER CHECK (match_score >= 0 AND match_score <= 100),
    match_reasons       JSONB,
    -- {
    --   matched_skills: ["Java", "Spring Boot"],
    --   missing_skills: ["Kubernetes"],
    --   summary: "Strong match — 6/7 skills present..."
    -- }
    status              TEXT DEFAULT 'assigned',  -- assigned, submitted, skipped
    assigned_at         TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(job_id, resume_id)
);

-- ────────────────────────────────────────────────────────────
-- VENDORS
-- Companies that forward resumes to end clients
-- ────────────────────────────────────────────────────────────
CREATE TABLE vendors (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name        TEXT NOT NULL,
    contact_name        TEXT,
    email               TEXT,
    phone               TEXT,
    tier                TEXT DEFAULT 'standard',  -- preferred, standard, new
    specializations     TEXT[] DEFAULT '{}',
    total_submissions   INTEGER DEFAULT 0,
    total_placements    INTEGER DEFAULT 0,
    is_active           BOOLEAN DEFAULT TRUE,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- SUBMISSIONS
-- Full pipeline tracking from shortlist to placement
-- ────────────────────────────────────────────────────────────
CREATE TABLE submissions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Relations
    resume_id               UUID NOT NULL REFERENCES resumes(id),
    job_id                  UUID REFERENCES jobs_cache(id),       -- nullable (manual entry)
    vendor_id               UUID REFERENCES vendors(id),          -- nullable (direct client)

    -- Job snapshot (copied at submission time so edits to jobs_cache don't affect history)
    job_title               TEXT NOT NULL,
    company_name            TEXT,
    platform                TEXT,
    job_url                 TEXT,

    -- Pipeline status
    -- Allowed values: shortlisted | resume_ready | submitted | vendor_submitted |
    --                 client_submitted | interview | offer | placed | rejected | on_hold
    status                  TEXT NOT NULL DEFAULT 'shortlisted',

    -- Full audit trail — array of stage change events
    -- Format: [{"stage":"submitted","changed_at":"2026-01-14T10:00:00Z","notes":"sent to ABC vendor"}]
    stage_history           JSONB DEFAULT '[]'::JSONB,

    -- Compensation
    bill_rate               DECIMAL(10,2),   -- rate charged to client
    pay_rate                DECIMAL(10,2),   -- rate paid to candidate
    rate_type               TEXT DEFAULT 'hourly',   -- hourly | annual

    -- Key stage timestamps
    submitted_at            TIMESTAMPTZ,
    vendor_submitted_at     TIMESTAMPTZ,
    client_submitted_at     TIMESTAMPTZ,
    interview_at            TIMESTAMPTZ,
    offer_at                TIMESTAMPTZ,
    placed_at               TIMESTAMPTZ,

    -- AI-generated content
    submission_note         TEXT,    -- AI-written submission email
    candidate_pitch         TEXT,    -- AI-written 3-line pitch

    -- Other
    rejection_reason        TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- INDEXES — for query performance
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_resumes_created         ON resumes(created_at DESC);
CREATE INDEX idx_jobs_cache_platform     ON jobs_cache(platform);
CREATE INDEX idx_jobs_cache_expires      ON jobs_cache(expires_at);
CREATE INDEX idx_assignments_resume      ON job_assignments(resume_id);
CREATE INDEX idx_assignments_job         ON job_assignments(job_id);
CREATE INDEX idx_assignments_score       ON job_assignments(match_score DESC);
CREATE INDEX idx_submissions_resume      ON submissions(resume_id);
CREATE INDEX idx_submissions_status      ON submissions(status);
CREATE INDEX idx_submissions_created     ON submissions(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at on row changes
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_resumes_updated_at
    BEFORE UPDATE ON resumes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_vendors_updated_at
    BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- HELPER VIEW — submissions with resume + vendor info joined
-- ────────────────────────────────────────────────────────────
CREATE VIEW submissions_detail AS
SELECT
    s.*,
    r.candidate_name,
    r.primary_role      AS candidate_role,
    r.primary_skills    AS candidate_skills,
    r.experience_years  AS candidate_experience,
    r.visa_status,
    r.work_auth,
    v.company_name      AS vendor_company,
    v.contact_name      AS vendor_contact,
    v.email             AS vendor_email
FROM submissions s
LEFT JOIN resumes  r ON s.resume_id = r.id
LEFT JOIN vendors  v ON s.vendor_id = v.id;
