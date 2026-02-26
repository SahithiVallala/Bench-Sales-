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

# Use Flash for speed + free tier
_model = genai.GenerativeModel("gemini-1.5-flash")


def _call_gemini(prompt: str) -> str:
    """Make a Gemini API call and return raw text response."""
    response = _model.generate_content(prompt)
    return response.text.strip()


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
