"""
Chrome Extension API Routes
Handles screening question answering and application logging from the browser extension.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import os
from services.gemini_service import _call_ai, _extract_json

router = APIRouter(prefix="/api", tags=["extension"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ScreeningRequest(BaseModel):
    question: str
    job_title: Optional[str] = None
    company: Optional[str] = None
    context: Optional[str] = None
    profile: Optional[dict] = None


class ApplicationLogRequest(BaseModel):
    job_url: Optional[str] = None
    job_title: Optional[str] = None
    company: Optional[str] = None
    platform: Optional[str] = None
    status: str  # 'applied' | 'skipped' | 'error'
    candidate_id: Optional[str] = None
    note: Optional[str] = None
    timestamp: Optional[str] = None


# ── Screening Answer ──────────────────────────────────────────────────────────

@router.post("/ai/screening-answer")
async def answer_screening_question(body: ScreeningRequest):
    """
    Generate an answer to a job application screening question using AI.
    Uses the candidate's profile to give personalized answers.
    """
    profile = body.profile or {}
    skills = ", ".join(profile.get("primary_skills", [])[:5]) or "various technologies"
    exp = profile.get("experience_years", "several")
    role = profile.get("primary_role", "Software Professional")
    work_auth = profile.get("work_auth", "")
    rate = profile.get("rate_expectation", "Negotiable")
    location = profile.get("location", "")

    prompt = f"""You are answering a job application screening question on behalf of a candidate.

Candidate Profile:
- Role: {role}
- Experience: {exp} years
- Skills: {skills}
- Work Authorization: {work_auth}
- Rate/Salary Expectation: {rate}
- Location: {location}

Job Context:
- Title: {body.job_title or 'Not specified'}
- Company: {body.company or 'Not specified'}
- Platform: {body.context or 'Job application form'}

Screening Question: "{body.question}"

Rules:
1. Answer in first person as the candidate
2. Keep the answer SHORT — 1-2 sentences max for simple questions, up to a paragraph for complex ones
3. For yes/no questions, answer "Yes" or "No" with a brief reason
4. For numeric fields (years, salary), give just the number or range
5. Never reveal you are AI
6. Be professional and honest

Return ONLY a JSON object:
{{"answer": "your answer here"}}
"""
    try:
        raw = _call_ai(prompt)
        data = _extract_json(raw)
        return {"answer": data.get("answer", _fallback_answer(body.question, profile))}
    except Exception as e:
        print(f"[Extension] Screening answer error: {e}")
        return {"answer": _fallback_answer(body.question, profile)}


def _fallback_answer(question: str, profile: dict) -> str:
    """Rule-based fallback when AI is unavailable."""
    q = question.lower()
    if any(k in q for k in ["year", "experience"]):
        return str(profile.get("experience_years", "3+"))
    if any(k in q for k in ["authorization", "authorized", "eligible", "sponsorship"]):
        work_auth = profile.get("work_auth", "")
        needs_sponsor = any(v in work_auth.lower() for v in ["h1b", "h-1b", "needs"]) if work_auth else False
        return "No" if needs_sponsor else "Yes"
    if "relocat" in q:
        return "Yes"
    if "remote" in q:
        return "Yes"
    if any(k in q for k in ["salary", "compensation", "pay", "rate"]):
        return profile.get("rate_expectation", "Negotiable")
    if "gender" in q:
        return profile.get("gender", "Prefer not to say")
    if any(k in q for k in ["ethnicity", "race"]):
        return "Prefer not to disclose"
    if "veteran" in q:
        return "I am not a protected veteran"
    if "disability" in q:
        return "I do not have a disability"
    return "Yes"


# ── Application Logging ───────────────────────────────────────────────────────

# In-memory log for now (could persist to Supabase later)
_application_log: list[dict] = []


@router.post("/applications/log")
async def log_application(body: ApplicationLogRequest):
    """
    Log an auto-applied job from the browser extension.
    Stored in memory and can be persisted to Supabase submissions table.
    """
    entry = body.model_dump()
    _application_log.append(entry)
    print(f"[Extension] Application logged: {body.status} — {body.job_title} at {body.company}")

    # Optionally create a submission record in Supabase
    if body.candidate_id and body.status == "applied":
        try:
            from services.supabase_client import supabase
            supabase.table("submissions").insert({
                "resume_id": body.candidate_id,
                "job_title": body.job_title,
                "company_name": body.company,
                "job_url": body.job_url,
                "platform": body.platform,
                "status": "submitted",
                "notes": f"Auto-applied via Chrome extension. {body.note or ''}".strip(),
            }).execute()
        except Exception as e:
            print(f"[Extension] Supabase log error: {e}")

    return {"success": True, "logged": len(_application_log)}


@router.get("/applications/log")
async def get_application_log():
    """Get the in-session application log."""
    return {"log": _application_log, "total": len(_application_log)}
