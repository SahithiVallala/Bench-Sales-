"""
JSearch API (RapidAPI) — searches LinkedIn, Indeed, ZipRecruiter
Free tier: 500 requests/month
"""
import os
import httpx
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv()

JSEARCH_URL = "https://jsearch.p.rapidapi.com/search"

PLATFORM_QUERY_MAP = {
    "linkedin":     "site:linkedin.com",
    "indeed":       "site:indeed.com",
    "ziprecruiter": "site:ziprecruiter.com",
}

DATE_POSTED_MAP = {
    "today":  "today",
    "3days":  "3days",
    "week":   "week",
    "month":  "month",
    "any":    "all",
}

EMPLOYMENT_TYPE_MAP = {
    "full_time":  "FULLTIME",
    "part_time":  "PARTTIME",
    "contract":   "CONTRACTOR",
    "internship": "INTERN",
    "any":        None,
}


async def search_platform(
    platform: str,
    job_titles: List[str],
    locations: Optional[List[str]] = None,
    work_mode: str = "any",
    job_type: str = "any",
    experience_level: str = "any",
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    date_posted: str = "week",
    num_results: int = 10
) -> List[Dict]:
    """Search LinkedIn/Indeed/ZipRecruiter via JSearch API."""
    api_key = os.getenv("JSEARCH_API_KEY", "")
    if not api_key:
        print("[JSearch] API key not configured")
        return []

    if platform not in PLATFORM_QUERY_MAP:
        print(f"[JSearch] Unsupported platform: {platform}")
        return []

    # Build query string
    title_part = " OR ".join(f'"{t}"' for t in job_titles)
    query_parts = [title_part]

    if locations:
        clean = [l.strip() for l in locations if l.strip()]
        if clean:
            query_parts.append(f"in {', '.join(clean)}")

    if work_mode and work_mode == "remote":
        query_parts.append("remote")

    if include_keywords:
        query_parts.extend(include_keywords)

    query = " ".join(query_parts)

    params = {
        "query":       query,
        "page":        "1",
        "num_pages":   str(min((num_results + 9) // 10, 3)),
        "date_posted": DATE_POSTED_MAP.get(date_posted, "week"),
    }

    # Employment type filter
    emp_type = EMPLOYMENT_TYPE_MAP.get(job_type)
    if emp_type:
        params["employment_types"] = emp_type

    # Remote only filter
    if work_mode == "remote":
        params["remote_jobs_only"] = "true"

    headers = {
        "X-RapidAPI-Key":  api_key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    }

    results = []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(JSEARCH_URL, params=params, headers=headers)

            if resp.status_code == 429:
                print(f"[JSearch] Rate limit hit")
                return []
            if resp.status_code != 200:
                print(f"[JSearch] Error {resp.status_code}: {resp.text[:200]}")
                return []

            data = resp.json().get("data", [])

            for job in data:
                # Filter out excluded keywords
                description = job.get("job_description", "") or ""
                title = job.get("job_title", "") or ""
                if exclude_keywords:
                    combined = (title + " " + description).lower()
                    if any(kw.lower() in combined for kw in exclude_keywords):
                        continue

                parsed = _parse_job(job, platform)
                if parsed:
                    results.append(parsed)

                if len(results) >= num_results:
                    break

    except Exception as e:
        print(f"[JSearch] Request error: {e}")

    return results


def _parse_job(job: dict, platform: str) -> Optional[Dict]:
    title = job.get("job_title", "")
    if not title:
        return None

    # Build job URL
    job_url = (
        job.get("job_apply_link")
        or job.get("job_google_link")
        or ""
    )
    if not job_url:
        return None

    # Location
    city    = job.get("job_city", "")
    state   = job.get("job_state", "")
    country = job.get("job_country", "")
    location_parts = [p for p in [city, state, country] if p]
    location = ", ".join(location_parts) if location_parts else None

    # Remote
    is_remote = job.get("job_is_remote", False)
    work_mode = "remote" if is_remote else None

    # Salary
    salary_min = job.get("job_min_salary")
    salary_max = job.get("job_max_salary")
    salary_period = job.get("job_salary_period", "")
    salary_range = None
    if salary_min and salary_max:
        salary_range = f"${salary_min:,.0f} - ${salary_max:,.0f} {salary_period}".strip()
    elif salary_min:
        salary_range = f"${salary_min:,.0f}+ {salary_period}".strip()

    # Employment type
    emp_type = job.get("job_employment_type", "")
    type_map = {
        "FULLTIME": "full_time", "PARTTIME": "part_time",
        "CONTRACTOR": "contract", "INTERN": "internship"
    }
    job_type = type_map.get(emp_type)

    # Posted date
    posted_at = job.get("job_posted_at_datetime_utc", "")
    posted_date = posted_at[:10] if posted_at else None

    # Required skills (from highlights if available)
    qualifications = job.get("job_highlights", {}).get("Qualifications", [])
    skills = []
    if qualifications:
        # Extract short skill-like items
        for q in qualifications[:10]:
            if len(q) < 50:
                skills.append(q)

    return {
        "title":          title,
        "company":        job.get("employer_name"),
        "platform":       platform,
        "job_url":        job_url,
        "description":    job.get("job_description", "")[:2000],
        "location":       location,
        "work_mode":      work_mode,
        "job_type":       job_type,
        "salary_range":   salary_range,
        "posted_date":    posted_date,
        "skills_required": skills,
    }
