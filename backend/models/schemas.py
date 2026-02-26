"""
Pydantic schemas — request/response models for all API endpoints
"""
from pydantic import BaseModel, HttpUrl
from typing import List, Optional, Any
from datetime import datetime, date
from decimal import Decimal
from enum import Enum


# ── Enums ──────────────────────────────────────────────────────────────────────

class Platform(str, Enum):
    linkedin    = "linkedin"
    indeed      = "indeed"
    naukri      = "naukri"
    dice        = "dice"
    glassdoor   = "glassdoor"
    ziprecruiter = "ziprecruiter"
    remotive    = "remotive"

class JobType(str, Enum):
    full_time   = "full_time"
    part_time   = "part_time"
    contract    = "contract"
    internship  = "internship"
    any         = "any"

class WorkMode(str, Enum):
    remote  = "remote"
    hybrid  = "hybrid"
    onsite  = "onsite"
    any     = "any"

class ExperienceLevel(str, Enum):
    entry   = "entry"    # 0-2 years
    mid     = "mid"      # 2-5 years
    senior  = "senior"   # 5+ years
    any     = "any"

class DatePosted(str, Enum):
    today       = "today"
    three_days  = "3days"
    week        = "week"
    month       = "month"
    any         = "any"

class SubmissionStatus(str, Enum):
    shortlisted         = "shortlisted"
    resume_ready        = "resume_ready"
    submitted           = "submitted"
    vendor_submitted    = "vendor_submitted"
    client_submitted    = "client_submitted"
    interview           = "interview"
    offer               = "offer"
    placed              = "placed"
    rejected            = "rejected"
    on_hold             = "on_hold"


# ── Resume Schemas ─────────────────────────────────────────────────────────────

class ResumeBase(BaseModel):
    candidate_name: str
    email:          Optional[str] = None
    phone:          Optional[str] = None
    visa_status:    Optional[str] = None
    work_auth:      Optional[str] = None
    current_location: Optional[str] = None
    relocation:     Optional[bool] = False
    work_mode_pref: Optional[str] = "any"

class ResumeCreate(ResumeBase):
    pass  # file uploaded separately via multipart

class ResumeExtracted(BaseModel):
    """AI-extracted fields returned after parsing"""
    primary_role:       Optional[str] = None
    primary_skills:     List[str] = []
    secondary_skills:   List[str] = []
    experience_years:   Optional[float] = None
    education:          Optional[str] = None
    certifications:     List[str] = []
    ai_summary:         Optional[str] = None
    rate_expectation:   Optional[str] = None

class ResumeResponse(ResumeBase, ResumeExtracted):
    id:             str
    file_name:      Optional[str] = None
    file_url:       Optional[str] = None
    extracted_at:   Optional[datetime] = None
    created_at:     datetime

    class Config:
        from_attributes = True


# ── Job Search Schemas ─────────────────────────────────────────────────────────

class JobSearchRequest(BaseModel):
    resume_id:          str                         # which resume to match against
    job_titles:         List[str]                   # ["Java Developer", "Backend Engineer"]
    platforms:          List[Platform] = [          # which platforms to search
                            Platform.linkedin,
                            Platform.indeed,
                            Platform.dice,
                            Platform.naukri
                        ]
    locations:          Optional[List[str]] = None  # ["Remote", "Austin TX"]
    job_type:           JobType = JobType.any
    work_mode:          WorkMode = WorkMode.any
    experience_level:   ExperienceLevel = ExperienceLevel.any
    date_posted:        DatePosted = DatePosted.week
    include_keywords:   Optional[List[str]] = None  # extra keywords to include
    exclude_keywords:   Optional[List[str]] = None  # keywords to filter out
    salary_min:         Optional[int] = None        # minimum salary/rate
    num_results:        int = 30                    # max results to return

class JobResult(BaseModel):
    id:                 Optional[str] = None        # jobs_cache id if saved
    title:              str
    company:            Optional[str] = None
    platform:           str
    job_url:            str
    location:           Optional[str] = None
    work_mode:          Optional[str] = None
    job_type:           Optional[str] = None
    salary_range:       Optional[str] = None
    posted_date:        Optional[str] = None
    description:        Optional[str] = None
    skills_required:    List[str] = []
    match_score:        Optional[int] = None        # 0-100
    match_reasons:      Optional[dict] = None       # matched/missing skills + summary

class JobSearchResponse(BaseModel):
    total:      int
    jobs:       List[JobResult]
    resume_id:  str
    searched_at: datetime


# ── Submission Schemas ─────────────────────────────────────────────────────────

class StageHistoryEntry(BaseModel):
    stage:      str
    changed_at: str
    notes:      Optional[str] = None

class SubmissionCreate(BaseModel):
    resume_id:      str
    job_id:         Optional[str] = None
    vendor_id:      Optional[str] = None
    job_title:      str
    company_name:   Optional[str] = None
    platform:       Optional[str] = None
    job_url:        Optional[str] = None
    bill_rate:      Optional[float] = None
    pay_rate:       Optional[float] = None
    rate_type:      str = "hourly"
    notes:          Optional[str] = None

class SubmissionStatusUpdate(BaseModel):
    status:     SubmissionStatus
    notes:      Optional[str] = None

class SubmissionResponse(BaseModel):
    id:                     str
    resume_id:              str
    candidate_name:         Optional[str] = None
    job_id:                 Optional[str] = None
    vendor_id:              Optional[str] = None
    job_title:              str
    company_name:           Optional[str] = None
    platform:               Optional[str] = None
    job_url:                Optional[str] = None
    status:                 str
    stage_history:          List[dict] = []
    bill_rate:              Optional[float] = None
    pay_rate:               Optional[float] = None
    rate_type:              str
    submitted_at:           Optional[datetime] = None
    vendor_submitted_at:    Optional[datetime] = None
    client_submitted_at:    Optional[datetime] = None
    interview_at:           Optional[datetime] = None
    offer_at:               Optional[datetime] = None
    placed_at:              Optional[datetime] = None
    submission_note:        Optional[str] = None
    candidate_pitch:        Optional[str] = None
    rejection_reason:       Optional[str] = None
    notes:                  Optional[str] = None
    created_at:             datetime
    updated_at:             datetime

    class Config:
        from_attributes = True


# ── Vendor Schemas ─────────────────────────────────────────────────────────────

class VendorCreate(BaseModel):
    company_name:       str
    contact_name:       Optional[str] = None
    email:              Optional[str] = None
    phone:              Optional[str] = None
    tier:               str = "standard"
    specializations:    List[str] = []
    notes:              Optional[str] = None

class VendorResponse(VendorCreate):
    id:                 str
    total_submissions:  int = 0
    total_placements:   int = 0
    is_active:          bool
    created_at:         datetime

    class Config:
        from_attributes = True


# ── AI Generation Schemas ──────────────────────────────────────────────────────

class SubmissionNoteRequest(BaseModel):
    resume_id:      str
    job_title:      str
    company_name:   Optional[str] = None
    job_description: Optional[str] = None
    vendor_name:    Optional[str] = None
    bill_rate:      Optional[float] = None

class SubmissionNoteResponse(BaseModel):
    submission_note:    str
    candidate_pitch:    str

class MatchScoreRequest(BaseModel):
    resume_id:          str
    job_description:    str
    job_title:          str

class MatchScoreResponse(BaseModel):
    match_score:        int
    matched_skills:     List[str]
    missing_skills:     List[str]
    summary:            str


# ── Analytics Schemas ──────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_resumes:          int
    active_submissions:     int
    submitted_today:        int
    interviews_this_week:   int
    placements_this_month:  int
    pipeline: dict          # {status: count} for funnel chart
