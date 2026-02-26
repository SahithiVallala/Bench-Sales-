"""
Remotive API — free remote job listings, no API key required
"""
import httpx
from typing import List, Dict, Optional

REMOTIVE_URL = "https://remotive.com/api/remote-jobs"


async def search_remote_jobs(
    job_titles: List[str],
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    num_results: int = 10
) -> List[Dict]:
    """Search Remotive for remote jobs matching the given titles."""
    results = []

    # Remotive supports one search term — use the first job title
    primary_title = job_titles[0] if job_titles else ""

    params = {
        "search":   primary_title,
        "limit":    min(num_results * 3, 50),  # fetch extra for filtering
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(REMOTIVE_URL, params=params)

            if resp.status_code != 200:
                print(f"[Remotive] Error {resp.status_code}")
                return []

            jobs = resp.json().get("jobs", [])

            for job in jobs:
                title = job.get("title", "")
                description = job.get("description", "") or ""

                # Title must match at least one of the given titles
                title_lower = title.lower()
                if not any(t.lower() in title_lower or title_lower in t.lower()
                           for t in job_titles):
                    # Also check if any title keyword appears
                    all_title_words = " ".join(job_titles).lower().split()
                    if not any(w in title_lower for w in all_title_words if len(w) > 3):
                        continue

                # Filter out excluded keywords
                if exclude_keywords:
                    combined = (title + " " + description).lower()
                    if any(kw.lower() in combined for kw in exclude_keywords):
                        continue

                parsed = _parse_job(job)
                if parsed:
                    results.append(parsed)

                if len(results) >= num_results:
                    break

    except Exception as e:
        print(f"[Remotive] Request error: {e}")

    return results


def _parse_job(job: dict) -> Optional[Dict]:
    title   = job.get("title", "")
    job_url = job.get("url", "")

    if not title or not job_url:
        return None

    # Salary
    salary = job.get("salary", "")

    # Tags as skills
    tags = job.get("tags", [])
    skills = [t for t in tags if isinstance(t, str)]

    return {
        "title":          title,
        "company":        job.get("company_name"),
        "platform":       "remotive",
        "job_url":        job_url,
        "description":    job.get("description", "")[:2000],
        "location":       "Remote",
        "work_mode":      "remote",
        "job_type":       "full_time",
        "salary_range":   salary or None,
        "posted_date":    job.get("publication_date", "")[:10] or None,
        "skills_required": skills[:10],
    }
