"""
AI Page Action Route
Analyzes job application pages: finds the right Apply button and maps form fields.

Flow:
  1. Chrome Extension sends page URL + visible elements
  2. This route calls Gemini (main) → Groq (fallback)
  3. Returns structured JSON the extension uses to click / fill

Two action types:
  - "find_button":  returns { click_text: "Apply Now", reason: "..." }
  - "map_fields":   returns { mappings: [{ field_id: "email", value: "..." }] }
"""
import os
import re
import json
import asyncio
from typing import Any, Optional

import google.generativeai as genai
from fastapi import APIRouter
from pydantic import BaseModel
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

from dotenv import load_dotenv
load_dotenv()

router = APIRouter()

# ── AI client setup ────────────────────────────────────────────────────────────
genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
_gemini_fast    = genai.GenerativeModel("gemini-flash-lite-latest")  # fast: find_button, map_fields
_gemini_quality = genai.GenerativeModel("gemini-1.5-flash")           # quality: answer_questions

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile")

# Build LangChain ChatGroq client only if key is present
_groq_client = (
    ChatGroq(api_key=GROQ_API_KEY, model=GROQ_MODEL, temperature=0, max_tokens=512)
    if GROQ_API_KEY else None
)


# ── Request / Response models ──────────────────────────────────────────────────
class PageActionRequest(BaseModel):
    action_type: str                    # "find_button" | "map_fields"
    page_url:    str
    page_title:  str
    elements:    list[Any]              # button list OR form field list
    candidate:   Optional[dict] = None  # candidate data (for map_fields)
    job:         Optional[dict] = None  # job data (for cover letter replacement)


# ── JSON extraction helper ────────────────────────────────────────────────────
def _extract_json(text: str) -> dict:
    """Strip markdown fences and parse JSON from AI response."""
    cleaned = re.sub(r"```(?:json)?", "", text).replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
    return {}


# ── Prompt builder ─────────────────────────────────────────────────────────────
def _build_prompt(req: PageActionRequest) -> str:
    if req.action_type == "find_button":
        elements_text = "\n".join(
            f"  - [{e.get('type','?')}] \"{e.get('text','')}\""
            + (f"  →  {e.get('href','')[:80]}" if e.get('href') else "")
            for e in req.elements[:30]
        )
        return f"""You are an intelligent job application assistant.

Page URL:   {req.page_url}
Page title: {req.page_title}

VISIBLE INTERACTIVE ELEMENTS:
{elements_text}

TASK: Identify the ONE element to click to start filling out a job application form.

PREFER (in priority order):
  1. "Easy Apply" (LinkedIn in-platform modal)
  2. "Apply Now"
  3. "Apply for this job" / "Apply for Job"
  4. "Apply to this position" / "Apply"
  5. External ATS links (Workday, Greenhouse, Lever, iCIMS, SmartRecruiters, Taleo, Brassring)

REJECT — do NOT return these:
  - "Apply with LinkedIn / Indeed / Google / Facebook"
  - "Sign in to apply", "Log in to apply", "Create account", "Register to apply"
  - "Save job", "Save", "Share", "Report", "Dismiss"

If the page already IS a form (input fields visible), return null.

Return ONLY valid JSON — no explanation, no markdown:
{{"click_text": "exact text of element to click", "reason": "brief reason"}}
If no suitable element found:
{{"click_text": null, "reason": "brief reason"}}"""

    elif req.action_type == "answer_questions":
        c   = req.candidate or {}
        j   = req.job or {}
        name_parts = (c.get("candidate_name") or "").split()

        # Build resume summary from candidate data
        skills_raw = c.get("primary_skills") or []
        skills     = ", ".join(skills_raw) if isinstance(skills_raw, list) else str(skills_raw)
        exp_years  = c.get("experience_years", "")
        summary    = c.get("summary") or c.get("professional_summary") or ""

        cand_text = f"""\
  Full Name:        {c.get("candidate_name", "")}
  Experience:       {exp_years} years
  Primary Skills:   {skills}
  Location:         {c.get("current_location") or c.get("city", "")}
  Current Role:     {c.get("primary_role") or "Software Professional"}
  Education:        {c.get("education") or ""}
  Summary:          {summary[:400] if summary else "Experienced professional with strong technical background"}"""

        job_text = f"""\
  Job Title:    {j.get("title", "")}
  Company:      {j.get("company", "")}
  Platform:     {j.get("platform", "")}"""

        questions_text = "\n".join(
            f"  {i+1}. id={e.get('id') or 'null'}  label=\"{e.get('label', '')}\""
            + (f"  maxLength={e.get('maxLength')}" if e.get('maxLength') else "")
            for i, e in enumerate(req.elements[:15])
        )

        return f"""You are a professional job application assistant helping a candidate apply for a job.

CANDIDATE PROFILE:
{cand_text}

JOB DETAILS:
{job_text}

SCREENING QUESTIONS TO ANSWER:
{questions_text}

TASK: Write a natural, first-person answer for EACH question above.

RULES:
- Answer in first person ("I have...", "My experience with...")
- Keep each answer between 50-150 words unless maxLength suggests shorter
- Base answers on the candidate's actual profile — do NOT invent achievements
- Sound confident and human — avoid clichés like "passionate team player"
- For "why this company" — express genuine interest based on job title/company
- For experience questions — reference the skills and years of experience listed
- For achievement questions — describe a plausible technical contribution based on their skills

Return ONLY valid JSON — no explanation, no markdown:
{{"answers": {{"field_id_or_label": "answer text"}}}}
Use the field's 'id' as the key if id is not null, otherwise use the 'label' as the key.
Example: {{"answers": {{"cover_letter": "I am excited to apply...", "q_why_us": "I believe..."}}}}"""

    elif req.action_type == "map_fields":
        c   = req.candidate or {}
        j   = req.job or {}
        name_parts = (c.get("candidate_name") or "").split()
        cover = (c.get("cover_letter_template") or "").replace(
            "[COMPANY]", j.get("company", "the company")
        ).replace("[JOB]", j.get("title", "the position"))[:600]

        cand_text = f"""\
  name:            {c.get("candidate_name", "")}
  firstName:       {name_parts[0] if name_parts else ""}
  lastName:        {" ".join(name_parts[1:]) if len(name_parts) > 1 else ""}
  email:           {c.get("email", "")}
  phone:           {c.get("phone", "")}
  location/city:   {c.get("current_location") or c.get("city", "")}
  zipCode:         {c.get("zip_code", "")}
  experienceYears: {c.get("experience_years", "")}
  linkedinUrl:     {c.get("linkedin_url", "")}
  portfolioUrl:    {c.get("portfolio_url", "")}
  currentCompany:  {c.get("current_company") or "Fresher"}
  noticePeriod:    {c.get("notice_period") or "Immediate"}
  coverLetter:     {cover}"""

        fields_text = "\n".join(
            f"  - id={e.get('id') or 'null'}  name={e.get('name') or 'null'}  "
            f"type={e.get('type','')}  label=\"{e.get('label') or e.get('ariaLabel') or ''}\"  "
            f"placeholder=\"{e.get('placeholder') or ''}\""
            for e in req.elements[:25]
        )

        return f"""You are an intelligent job application form-filler.

CANDIDATE DATA:
{cand_text}

FORM FIELDS ON PAGE:
{fields_text}

TASK: Map each form field to the right candidate value.

RULES:
- Use field's 'id' as field_id (if null, use 'name' attribute)
- Skip file upload fields (type=file)
- For cover letter / comments / message fields → use coverLetter text
- For experience / years fields → use experienceYears as a whole number string
- For "org" / "current company" fields → use currentCompany
- DO NOT guess values you don't have data for
- DO NOT include fields you can't fill

Return ONLY valid JSON — no explanation, no markdown:
{{"mappings": [{{"field_id": "element_id_or_name", "value": "value_to_fill"}}]}}
Return empty array if nothing to fill: {{"mappings": []}}"""

    return ""


# ── AI callers ─────────────────────────────────────────────────────────────────
def _call_gemini_sync(prompt: str, use_quality: bool = False) -> dict:
    model = _gemini_quality if use_quality else _gemini_fast
    resp  = model.generate_content(prompt)
    return _extract_json(resp.text.strip())


async def _call_groq(prompt: str) -> dict:
    """Call Groq via LangChain ChatGroq (async)."""
    if not _groq_client:
        raise RuntimeError("GROQ_API_KEY not configured")
    response = await _groq_client.ainvoke([HumanMessage(content=prompt)])
    return _extract_json(response.content)


# ── Route ──────────────────────────────────────────────────────────────────────
@router.post("/api/ai/page-action")
async def page_action(req: PageActionRequest):
    """
    Analyzes a job page and returns an AI decision:
    - find_button → { click_text, reason }
    - map_fields  → { mappings: [{ field_id, value }] }
    """
    if not req.elements:
        return {"result": {}, "model": "none"}

    prompt = _build_prompt(req)

    # Use higher-quality model for open question answering
    use_quality = req.action_type == "answer_questions"

    # ── 1. Try Gemini (main) ───────────────────────────────────────────────────
    try:
        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _call_gemini_sync, prompt, use_quality)
        if result:
            print(f"[AI] Gemini handled {req.action_type} for {req.page_url[:60]}")
            return {"result": result, "model": "gemini"}
    except Exception as e:
        print(f"[AI] Gemini failed ({req.action_type}): {e}")

    # ── 2. Fallback to Groq (LangChain ChatGroq) ──────────────────────────────
    if _groq_client:
        try:
            result = await _call_groq(prompt)
            if result:
                print(f"[AI] Groq handled {req.action_type} for {req.page_url[:60]}")
                return {"result": result, "model": "groq"}
        except Exception as e:
            print(f"[AI] Groq failed ({req.action_type}): {e}")

    return {"result": {}, "model": "none"}
