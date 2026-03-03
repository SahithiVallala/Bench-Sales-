"""
Google Gemini AI Service
Handles: resume parsing, job match scoring, content generation
"""
import os
import json
import re
from typing import Optional
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))

# gemini-1.5-flash free tier: 1,500 requests/day (vs 20/day for flash-lite)
# This ensures AI scoring works for full job searches without hitting quota.
_MODEL_NAME = "gemini-1.5-flash"
_model = genai.GenerativeModel(_MODEL_NAME)
_quota_exceeded = False   # set True once we detect a 429 to stop retrying


def _call_gemini(prompt: str) -> str:
    """Make a Gemini API call and return raw text response."""
    global _quota_exceeded
    if _quota_exceeded:
        raise RuntimeError("Gemini quota exceeded for today")
    try:
        response = _model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        msg = str(e).lower()
        if "429" in msg or "quota" in msg or "resource_exhausted" in msg:
            _quota_exceeded = True
            print(f"[Gemini] Quota exceeded on {_MODEL_NAME} — keyword fallback active for rest of session")
        raise


def _extract_json(text: str) -> dict:
    """Extract JSON object from Gemini response (strips markdown fences)."""
    # Remove markdown code fences if present
    cleaned = re.sub(r"```(?:json)?", "", text).replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {}


# ── Contact Extraction ─────────────────────────────────────────────────────────

# US state abbreviations used by location regex
_US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY","DC","PR",
}


def _regex_email(text: str) -> Optional[str]:
    match = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', text)
    return match.group(0).lower() if match else None


def _regex_phone(text: str) -> Optional[str]:
    match = re.search(
        r'(?:\+?1[\s.\-]?)?'
        r'(?:\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}'
        r'|\+\d{1,3}[\s.\-]?\d{6,12})',
        text
    )
    return match.group(0).strip() if match else None


def _regex_name(text: str) -> Optional[str]:
    """
    Heuristic: the candidate's name is almost always the first non-empty line
    of the resume that looks like a proper name (2-4 title-cased words, no
    digits or special characters).
    """
    lines = [l.strip() for l in text[:800].splitlines() if l.strip()]
    for line in lines[:8]:
        # Skip lines that look like contact info, URLs, or section headers
        if re.search(r'[@\d/|#*\\]', line):
            continue
        if re.search(
            r'(?i)(resume|curriculum vitae|\bcv\b|objective|summary|profile|'
            r'linkedin|github|http|www\.|skills|education|experience)',
            line
        ):
            continue
        words = line.split()
        # Name: 2-4 words, each starting uppercase, letters/apostrophe/hyphen only
        if 2 <= len(words) <= 4 and all(
            re.match(r"^[A-Z][a-zA-Z'\-\.]{0,20}$", w) for w in words
        ):
            return line
    return None


def _regex_location(text: str) -> Optional[str]:
    """
    Extract city/state or city/country from the top section of the resume.
    Prioritises US 'City, ST' patterns, then falls back to 'City, Country'.
    """
    top = text[:1200]

    # US pattern: "Austin, TX" or "New York, NY 10001"
    for m in re.finditer(
        r'\b([A-Z][a-zA-Z](?:[a-zA-Z\s]{0,18}[a-zA-Z])?),\s*([A-Z]{2})\b',
        top
    ):
        city, state = m.group(1).strip(), m.group(2)
        if state in _US_STATES and len(city) >= 3:
            return f"{city}, {state}"

    # International / spelled-out state: "Hyderabad, India" / "Chicago, Illinois"
    m = re.search(
        r'\b([A-Z][a-zA-Z]{2,20}(?:\s[A-Z][a-zA-Z]{2,15})?),\s*([A-Z][a-zA-Z]{3,20})\b',
        top
    )
    if m:
        loc = f"{m.group(1).strip()}, {m.group(2).strip()}"
        # Avoid false positives like university/company names
        if not re.search(
            r'(?i)(university|college|institute|school|corp|inc|ltd|llc|pvt)',
            loc
        ):
            return loc

    return None


def extract_contact_info(resume_text: str) -> dict:
    """
    Extract full name, email, phone, and location from resume text.

    Strategy (in priority order):
      1. Regex for all four fields — fast, uses zero AI quota
      2. ONE Gemini call for any fields still missing — only fires when needed

    This keeps Gemini usage to ≤1 call per upload instead of 2-3.
    """
    top = resume_text[:1200].strip()

    # ── Step 1: regex pass ────────────────────────────────────────────────────
    full_name = _regex_name(top)
    email     = _regex_email(top)
    phone     = _regex_phone(top)
    location  = _regex_location(top)

    print(f"[Contact] Regex found — name:{bool(full_name)} email:{bool(email)} "
          f"phone:{bool(phone)} location:{bool(location)}")

    # ── Step 2: ONE Gemini call for whatever is still missing ─────────────────
    missing = [f for f, v in [
        ("full_name", full_name), ("email", email),
        ("phone", phone), ("location", location)
    ] if not v]

    if missing:
        try:
            prompt = f"""Extract the following fields from the top of this resume.
Return ONLY a valid JSON object — no explanation, no markdown.

Fields to extract: {', '.join(missing)}

JSON format:
{{
  "full_name": "First Last or null",
  "email": "email@example.com or null",
  "phone": "+1 (555) 000-0000 or null",
  "location": "City, State or City, Country or null"
}}

Rules:
- full_name: the candidate's own name, usually the very first line
- location: city + state/country only (e.g. "Austin, TX" or "Bangalore, India")
- Return null for any field you cannot find

Resume header:
---
{top}
---
Return only the JSON:"""
            raw  = _call_gemini(prompt)
            data = _extract_json(raw)
            if not full_name:
                full_name = data.get("full_name") or None
            if not email:
                email = data.get("email") or None
            if not phone:
                phone = data.get("phone") or None
            if not location:
                location = data.get("location") or None
            print(f"[Contact] Gemini filled: {missing}")
        except Exception as e:
            print(f"[Gemini] Contact extraction error: {e}")

    return {
        "full_name": full_name,
        "email":     email,
        "phone":     phone,
        "location":  location,
    }


# ── Resume Parsing ─────────────────────────────────────────────────────────────

def parse_resume(resume_text: str) -> dict:
    """
    Extract structured data from raw resume text using Gemini.
    Returns a dict matching ResumeExtracted schema.
    """
    prompt = f"""
You are a resume parser for a US IT staffing company.

Extract the following information from the resume text below and return ONLY a valid JSON object.
No explanation, no markdown — just the JSON.

Required JSON structure:
{{
  "full_name": "candidate's full name from the top of the resume",
  "email": "email address found in the resume, or null",
  "phone": "phone number found in the resume, or null",
  "primary_role": "most recent/primary job title",
  "primary_skills": ["skill1", "skill2", ...],
  "secondary_skills": ["skill1", "skill2", ...],
  "experience_years": <number like 4.5>,
  "education": "highest degree + field + university",
  "certifications": ["cert1", "cert2", ...],
  "ai_summary": "2-3 sentence professional summary of this candidate",
  "rate_expectation": "if mentioned, like $65/hr or $90k/yr, else null"
}}

Rules:
- full_name: the candidate's own name, usually the first line of the resume
- primary_skills: top 6-8 most relevant technical skills
- secondary_skills: additional tools, frameworks, soft skills (max 8)
- experience_years: total years of professional experience as a decimal
- ai_summary: write in third person, mention role, years, top skills
- If a field is not found, use null (not empty string)

Resume Text:
---
{resume_text[:8000]}
---

Return only the JSON:
"""
    try:
        raw = _call_gemini(prompt)
        data = _extract_json(raw)
        # Ensure lists are always lists, not None
        for field in ["primary_skills", "secondary_skills", "certifications"]:
            if not isinstance(data.get(field), list):
                data[field] = []
        return data
    except Exception as e:
        print(f"[Gemini] Resume parsing error: {e}")
        return {
            "primary_role": None,
            "primary_skills": [],
            "secondary_skills": [],
            "experience_years": None,
            "education": None,
            "certifications": [],
            "ai_summary": None,
            "rate_expectation": None
        }


# ── Job Match Scoring ──────────────────────────────────────────────────────────

def score_job_match(
    job_title: str,
    job_description: str,
    candidate_role: str,
    candidate_skills: list[str],
    experience_years: Optional[float] = None
) -> dict:
    """
    Score how well a job matches a candidate (0-100).
    Returns: {match_score, matched_skills, missing_skills, summary}
    """
    skills_str = ", ".join(candidate_skills) if candidate_skills else "not specified"
    exp_str = f"{experience_years} years" if experience_years else "not specified"

    prompt = f"""
You are an expert IT recruiter evaluating candidate-job fit.

Candidate Profile:
- Current Role: {candidate_role or 'not specified'}
- Skills: {skills_str}
- Experience: {exp_str}

Job Details:
- Title: {job_title}
- Description: {job_description[:3000]}

Evaluate the fit and return ONLY a valid JSON object (no markdown, no explanation):
{{
  "match_score": <integer 0-100>,
  "matched_skills": ["skill1", "skill2", ...],
  "missing_skills": ["skill1", "skill2", ...],
  "summary": "1-2 sentence explanation of the match score"
}}

Scoring guide:
- 90-100: Almost perfect match, candidate has all required skills
- 75-89:  Strong match, minor gaps that are easy to fill
- 60-74:  Moderate match, some important skills missing
- 40-59:  Weak match, significant skill gaps
- 0-39:   Poor match, different domain or level

Return only the JSON:
"""
    try:
        raw = _call_gemini(prompt)
        data = _extract_json(raw)
        # Validate and clamp score
        score = int(data.get("match_score", 0))
        data["match_score"] = max(0, min(100, score))
        for field in ["matched_skills", "missing_skills"]:
            if not isinstance(data.get(field), list):
                data[field] = []
        if not data.get("summary"):
            data["summary"] = f"Match score: {data['match_score']}/100"
        return data
    except Exception as e:
        print(f"[Gemini] Match scoring error: {e}")
        return {
            "match_score": 0,
            "matched_skills": [],
            "missing_skills": [],
            "summary": "Unable to score this job at the moment."
        }


# ── Submission Content Generation ──────────────────────────────────────────────

def generate_submission_note(
    candidate_name: str,
    candidate_role: str,
    candidate_skills: list[str],
    experience_years: Optional[float],
    work_auth: Optional[str],
    job_title: str,
    company_name: Optional[str],
    bill_rate: Optional[float],
    vendor_name: Optional[str]
) -> dict:
    """
    Generate a professional submission email note and candidate pitch.
    Returns: {submission_note, candidate_pitch}
    """
    skills_str = ", ".join(candidate_skills[:6]) if candidate_skills else "various technologies"
    exp_str = f"{experience_years} years" if experience_years else "several years"
    rate_str = f"${bill_rate}/hr" if bill_rate else "open to discussion"
    vendor_str = vendor_name or "Hiring Team"
    company_str = f"at {company_name}" if company_name else ""

    prompt = f"""
You are a bench sales recruiter writing a professional resume submission email.

Candidate Details:
- Name: {candidate_name}
- Role: {candidate_role or job_title}
- Key Skills: {skills_str}
- Experience: {exp_str}
- Work Authorization: {work_auth or 'not specified'}
- Bill Rate: {rate_str}

Submission Details:
- Job Title: {job_title}
- Company: {company_name or 'the client'}
- Vendor/Recipient: {vendor_str}

Return ONLY a valid JSON object (no markdown):
{{
  "submission_note": "A professional 3-4 paragraph email to the vendor/client submitting this candidate. Start with a greeting, introduce the candidate, highlight relevant skills, mention availability and rate, and close professionally.",
  "candidate_pitch": "A concise 2-3 sentence pitch about why this candidate is a strong fit. Suitable for a quick message or call."
}}

Return only the JSON:
"""
    try:
        raw = _call_gemini(prompt)
        data = _extract_json(raw)
        return {
            "submission_note": data.get("submission_note", ""),
            "candidate_pitch": data.get("candidate_pitch", "")
        }
    except Exception as e:
        print(f"[Gemini] Content generation error: {e}")
        return {
            "submission_note": f"Please find attached the resume of {candidate_name} for the {job_title} position.",
            "candidate_pitch": f"{candidate_name} is an experienced {candidate_role} with {exp_str} of experience."
        }
