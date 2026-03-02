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
    "linkedin":     "linkedin",
    "indeed":       "indeed",
    "ziprecruiter": "ziprecruiter",
}

# Map JSearch job_publisher values → our platform names
PUBLISHER_TO_PLATFORM = {
    "linkedin":     "linkedin",
    "indeed":       "indeed",
    "ziprecruiter": "ziprecruiter",
    "zip recruiter":"ziprecruiter",
    "glassdoor":    "glassdoor",
}

EXPERIENCE_LEVEL_KEYWORDS = {
    "entry":  "entry level",
    "mid":    "mid level",
    "senior": "senior level",
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

    # Experience level keyword
    exp_keyword = EXPERIENCE_LEVEL_KEYWORDS.get(experience_level)
    if exp_keyword:
        query_parts.append(exp_keyword)

    if include_keywords:
        query_parts.extend(include_keywords)

    # NOTE: JSearch does NOT support site: operators — platform filtering
    # is done client-side using the job_publisher field returned per job.
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


async def search_platforms_combined(
    platforms: List[str],
    job_titles: List[str],
    locations: Optional[List[str]] = None,
    work_mode: str = "any",
    job_type: str = "any",
    experience_level: str = "any",
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    date_posted: str = "week",
    num_results: int = 30,
) -> List[Dict]:
    """
    Call JSearch ONCE for all selected platforms combined.
    Filters results by job_publisher to match selected platforms.
    Falls back to all results if publisher filtering returns too few.

    Why: JSearch does not support site: operators. Calling it once per
    platform (linkedin/indeed/ziprecruiter) fires the same query 3 times,
    wastes quota, and returns the same jobs 3 times.
    """
    api_key = os.getenv("JSEARCH_API_KEY", "")
    if not api_key:
        print("[JSearch] API key not configured")
        return []

    # Build query
    title_part = " OR ".join(f'"{t}"' for t in job_titles)
    query_parts = [title_part]

    if locations:
        clean = [l.strip() for l in locations if l.strip()]
        if clean:
            query_parts.append(f"in {', '.join(clean)}")

    if work_mode == "remote":
        query_parts.append("remote")

    exp_keyword = EXPERIENCE_LEVEL_KEYWORDS.get(experience_level)
    if exp_keyword:
        query_parts.append(exp_keyword)

    if include_keywords:
        query_parts.extend(include_keywords)

    query = " ".join(query_parts)

    # Request extra pages so we have enough after publisher filtering
    num_pages = min(max((num_results + 9) // 10, 2), 3)

    params = {
        "query":       query,
        "page":        "1",
        "num_pages":   str(num_pages),
        "date_posted": DATE_POSTED_MAP.get(date_posted, "week"),
    }

    emp_type = EMPLOYMENT_TYPE_MAP.get(job_type)
    if emp_type:
        params["employment_types"] = emp_type

    if work_mode == "remote":
        params["remote_jobs_only"] = "true"

    headers = {
        "X-RapidAPI-Key":  api_key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    }

    print(f"[JSearch] Combined query for {platforms}: {query}")

    raw_data = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(JSEARCH_URL, params=params, headers=headers)

            if resp.status_code == 429:
                print("[JSearch] Rate limit hit")
                return []
            if resp.status_code != 200:
                print(f"[JSearch] Error {resp.status_code}: {resp.text[:200]}")
                return []

            raw_data = resp.json().get("data", [])
            print(f"[JSearch] Raw jobs from API: {len(raw_data)}")

    except Exception as e:
        print(f"[JSearch] Request error: {e}")
        return []

    # Build set of requested platform names (lowercase)
    requested = {p.lower() for p in platforms}

    # Parse all jobs and tag with actual publisher
    all_parsed = []
    for job in raw_data:
        description = job.get("job_description", "") or ""
        title       = job.get("job_title", "") or ""
        if exclude_keywords:
            combined = (title + " " + description).lower()
            if any(kw.lower() in combined for kw in exclude_keywords):
                continue
        parsed = _parse_job(job, "")   # _parse_job uses actual publisher; empty fallback
        if parsed:
            all_parsed.append(parsed)

    # Filter to only jobs from the requested platforms
    platform_filtered = [
        j for j in all_parsed if j.get("platform", "").lower() in requested
    ]

    print(f"[JSearch] After publisher filter ({requested}): {len(platform_filtered)} jobs")

    # If publisher filtering leaves too few results, fall back to all results
    # (JSearch may not always return publisher-matched results for every platform)
    if len(platform_filtered) < max(3, num_results // 3):
        print("[JSearch] Too few platform-matched jobs — using all results")
        return all_parsed[:num_results]

    return platform_filtered[:num_results]


def _parse_job(job: dict, requested_platform: str) -> Optional[Dict]:
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

    # Detect actual platform from publisher field (e.g. "LinkedIn" → "linkedin")
    publisher_raw = (job.get("job_publisher") or "").lower().strip()
    # Use the known mapping if available; fall back to raw publisher name so jobs
    # aren't all mislabeled as the first requested platform.
    platform = PUBLISHER_TO_PLATFORM.get(publisher_raw) or publisher_raw or requested_platform

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
        "description":    (job.get("job_description") or "")[:2000],
        "location":       location,
        "work_mode":      work_mode,
        "job_type":       job_type,
        "salary_range":   salary_range,
        "posted_date":    posted_date,
        "skills_required": skills,
    }
