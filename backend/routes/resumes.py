"""
Resume routes — upload, parse, list, delete
"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional

from services.supabase_client import get_supabase, get_storage_bucket
from services.resume_parser import extract_text_from_file
from services import gemini_service

router = APIRouter(prefix="/api/resumes", tags=["resumes"])


@router.post("/extract-contact")
async def extract_contact(file: UploadFile = File(...)):
    """
    Lightweight endpoint: extract just name, email, phone from a resume file.
    Called client-side on file select to auto-populate the Candidate Info form
    before the user submits the full upload.
    """
    fname = file.filename.lower()
    if not (fname.endswith(".pdf") or fname.endswith(".docx") or fname.endswith(".doc")):
        raise HTTPException(400, "Only PDF and Word (.docx) files are supported")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10 MB)")

    parsed_text = extract_text_from_file(file_bytes, file.filename)
    if not parsed_text:
        return {"full_name": None, "email": None, "phone": None, "location": None}

    contact = gemini_service.extract_contact_info(parsed_text)
    return contact


@router.post("")
async def upload_resume(
    file:             UploadFile = File(...),
    candidate_name:   str        = Form(...),
    email:            Optional[str] = Form(None),
    phone:            Optional[str] = Form(None),
    visa_status:      Optional[str] = Form(None),
    work_auth:        Optional[str] = Form(None),
    current_location: Optional[str] = Form(None),
    relocation:       Optional[bool] = Form(False),
    work_mode_pref:   Optional[str]  = Form("any"),
):
    """Upload a resume (PDF or Word), parse it, extract data with AI, save to DB."""
    fname = file.filename.lower()
    if not (fname.endswith(".pdf") or fname.endswith(".docx") or fname.endswith(".doc")):
        raise HTTPException(400, "Only PDF and Word (.docx) files are supported")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(400, "File size must be under 10 MB")

    supabase = get_supabase()
    bucket   = get_storage_bucket()

    # 1. Upload file to Supabase Storage
    content_type = "application/pdf" if fname.endswith(".pdf") else \
                   "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    file_path = f"resumes/{uuid.uuid4()}_{file.filename}"
    try:
        supabase.storage.from_(bucket).upload(
            path=file_path,
            file=file_bytes,
            file_options={"content-type": content_type}
        )
        file_url = supabase.storage.from_(bucket).get_public_url(file_path)
    except Exception as e:
        raise HTTPException(500, f"File upload failed: {e}")

    # 2. Extract text from file
    parsed_text = extract_text_from_file(file_bytes, file.filename)
    if not parsed_text:
        raise HTTPException(422, "Could not extract text from file. Ensure it is not scanned/image-only.")

    # 3. AI parsing — now also extracts full_name, email, phone
    extracted = gemini_service.parse_resume(parsed_text)

    # Use regex as additional safety net for email/phone
    import re
    if not email:
        m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', parsed_text)
        email = m.group(0).lower() if m else None
    if not phone:
        m = re.search(
            r'(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}|\+\d{1,3}[\s.\-]?\d{6,12})',
            parsed_text
        )
        phone = m.group(0).strip() if m else None

    # Fall back to AI-extracted name if the form sent an empty/placeholder name
    effective_name = candidate_name.strip() or extracted.get("full_name") or candidate_name
    effective_email = email or extracted.get("email")
    effective_phone = phone or extracted.get("phone")

    # 4. Save to DB
    record = {
        "candidate_name":   effective_name,
        "email":            effective_email,
        "phone":            effective_phone,
        "visa_status":      visa_status,
        "work_auth":        work_auth,
        "current_location": current_location,
        "relocation":       relocation,
        "work_mode_pref":   work_mode_pref,
        "file_name":        file.filename,
        "file_url":         file_url,
        "parsed_text":      parsed_text,
        "primary_role":     extracted.get("primary_role"),
        "primary_skills":   extracted.get("primary_skills", []),
        "secondary_skills": extracted.get("secondary_skills", []),
        "experience_years": extracted.get("experience_years"),
        "education":        extracted.get("education"),
        "certifications":   extracted.get("certifications", []),
        "ai_summary":       extracted.get("ai_summary"),
        "rate_expectation": extracted.get("rate_expectation"),
        "extracted_at":     datetime.now(timezone.utc).isoformat(),
    }

    result = supabase.table("resumes").insert(record).execute()
    if not result.data:
        raise HTTPException(500, "Failed to save resume to database")

    return result.data[0]


@router.get("")
async def list_resumes():
    """List all saved resumes (summary view)."""
    supabase = get_supabase()
    result = supabase.table("resumes") \
        .select("id, candidate_name, email, primary_role, primary_skills, "
                "experience_years, visa_status, work_auth, work_mode_pref, "
                "current_location, file_name, created_at") \
        .order("created_at", desc=True) \
        .execute()
    return result.data or []


@router.get("/{resume_id}")
async def get_resume(resume_id: str):
    """Get full resume detail."""
    supabase = get_supabase()
    result = supabase.table("resumes") \
        .select("*") \
        .eq("id", resume_id) \
        .single() \
        .execute()
    if not result.data:
        raise HTTPException(404, "Resume not found")
    return result.data


@router.delete("/{resume_id}")
async def delete_resume(resume_id: str):
    """Delete a resume record (does not delete the storage file)."""
    supabase = get_supabase()
    result = supabase.table("resumes").delete().eq("id", resume_id).execute()
    if not result.data:
        raise HTTPException(404, "Resume not found")
    return {"message": "Resume deleted"}
