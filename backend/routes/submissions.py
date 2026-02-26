"""
Submission tracking routes — full pipeline from shortlist to placement
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Optional

from models.schemas import SubmissionCreate, SubmissionStatusUpdate
from services.supabase_client import get_supabase
from services import gemini_service

router = APIRouter(prefix="/api/submissions", tags=["submissions"])

# Stage → which timestamp field to set
STATUS_TIMESTAMP_MAP = {
    "submitted":         "submitted_at",
    "vendor_submitted":  "vendor_submitted_at",
    "client_submitted":  "client_submitted_at",
    "interview":         "interview_at",
    "offer":             "offer_at",
    "placed":            "placed_at",
}


@router.post("")
async def create_submission(body: SubmissionCreate):
    """Create a new submission and generate AI content (note + pitch)."""
    supabase = get_supabase()

    # Fetch resume for AI generation
    resume_result = supabase.table("resumes") \
        .select("candidate_name, primary_role, primary_skills, "
                "experience_years, work_auth") \
        .eq("id", body.resume_id).single().execute()

    if not resume_result.data:
        raise HTTPException(404, "Resume not found")

    resume = resume_result.data

    # Fetch vendor name if provided
    vendor_name = None
    if body.vendor_id:
        v = supabase.table("vendors") \
            .select("company_name").eq("id", body.vendor_id).single().execute()
        if v.data:
            vendor_name = v.data["company_name"]

    # Generate AI submission note + pitch
    ai_content = gemini_service.generate_submission_note(
        candidate_name=resume.get("candidate_name", ""),
        candidate_role=resume.get("primary_role", body.job_title),
        candidate_skills=resume.get("primary_skills", []),
        experience_years=resume.get("experience_years"),
        work_auth=resume.get("work_auth"),
        job_title=body.job_title,
        company_name=body.company_name,
        bill_rate=body.bill_rate,
        vendor_name=vendor_name,
    )

    now = datetime.now(timezone.utc).isoformat()

    record = {
        "resume_id":        body.resume_id,
        "job_id":           body.job_id,
        "vendor_id":        body.vendor_id,
        "job_title":        body.job_title,
        "company_name":     body.company_name,
        "platform":         body.platform,
        "job_url":          body.job_url,
        "bill_rate":        body.bill_rate,
        "pay_rate":         body.pay_rate,
        "rate_type":        body.rate_type,
        "notes":            body.notes,
        "status":           "shortlisted",
        "submission_note":  ai_content.get("submission_note"),
        "candidate_pitch":  ai_content.get("candidate_pitch"),
        "stage_history":    [{"stage": "shortlisted", "changed_at": now, "notes": "Submission created"}],
    }

    result = supabase.table("submissions").insert(record).execute()
    if not result.data:
        raise HTTPException(500, "Failed to create submission")

    # Update job_assignment status to submitted
    if body.job_id and body.resume_id:
        supabase.table("job_assignments") \
            .update({"status": "submitted"}) \
            .eq("job_id", body.job_id) \
            .eq("resume_id", body.resume_id) \
            .execute()

    return result.data[0]


@router.get("")
async def list_submissions(
    status:    Optional[str] = None,
    resume_id: Optional[str] = None,
    limit:     int = 50,
    offset:    int = 0
):
    """List submissions with optional filters. Joins resume name."""
    supabase = get_supabase()

    query = supabase.table("submissions_detail") \
        .select("*") \
        .order("created_at", desc=True) \
        .limit(limit) \
        .offset(offset)

    if status:
        query = query.eq("status", status)
    if resume_id:
        query = query.eq("resume_id", resume_id)

    result = query.execute()
    return result.data or []


@router.get("/{submission_id}")
async def get_submission(submission_id: str):
    """Get full submission detail with stage history."""
    supabase = get_supabase()
    result = supabase.table("submissions_detail") \
        .select("*").eq("id", submission_id).single().execute()
    if not result.data:
        raise HTTPException(404, "Submission not found")
    return result.data


@router.patch("/{submission_id}/status")
async def update_submission_status(submission_id: str, body: SubmissionStatusUpdate):
    """Advance submission to next pipeline stage."""
    supabase = get_supabase()

    # Get current submission
    current = supabase.table("submissions") \
        .select("stage_history, status") \
        .eq("id", submission_id).single().execute()

    if not current.data:
        raise HTTPException(404, "Submission not found")

    now = datetime.now(timezone.utc).isoformat()
    new_status = body.status.value

    # Append to stage history
    history = current.data.get("stage_history") or []
    history.append({
        "stage":      new_status,
        "changed_at": now,
        "notes":      body.notes or ""
    })

    # Build update payload
    update_data = {
        "status":        new_status,
        "stage_history": history,
        "updated_at":    now,
    }

    # Set the stage-specific timestamp if applicable
    timestamp_field = STATUS_TIMESTAMP_MAP.get(new_status)
    if timestamp_field:
        update_data[timestamp_field] = now

    result = supabase.table("submissions") \
        .update(update_data).eq("id", submission_id).execute()

    if not result.data:
        raise HTTPException(500, "Failed to update status")

    return result.data[0]


@router.delete("/{submission_id}")
async def delete_submission(submission_id: str):
    supabase = get_supabase()
    result = supabase.table("submissions").delete().eq("id", submission_id).execute()
    if not result.data:
        raise HTTPException(404, "Submission not found")
    return {"message": "Submission deleted"}


@router.post("/{submission_id}/regenerate-note")
async def regenerate_submission_note(submission_id: str):
    """Regenerate the AI submission note for a submission."""
    supabase = get_supabase()

    sub = supabase.table("submissions_detail") \
        .select("*").eq("id", submission_id).single().execute()
    if not sub.data:
        raise HTTPException(404, "Submission not found")

    s = sub.data
    vendor_name = s.get("vendor_company")

    ai_content = gemini_service.generate_submission_note(
        candidate_name=s.get("candidate_name", ""),
        candidate_role=s.get("candidate_role", s.get("job_title", "")),
        candidate_skills=s.get("candidate_skills", []),
        experience_years=s.get("candidate_experience"),
        work_auth=s.get("work_auth"),
        job_title=s.get("job_title", ""),
        company_name=s.get("company_name"),
        bill_rate=s.get("bill_rate"),
        vendor_name=vendor_name,
    )

    result = supabase.table("submissions").update({
        "submission_note": ai_content.get("submission_note"),
        "candidate_pitch": ai_content.get("candidate_pitch"),
    }).eq("id", submission_id).execute()

    return {
        "submission_note": ai_content.get("submission_note"),
        "candidate_pitch": ai_content.get("candidate_pitch"),
    }
