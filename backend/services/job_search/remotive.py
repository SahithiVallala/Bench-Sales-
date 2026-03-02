"""
Remotive API — free remote job listings, no API key required
"""
import httpx
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional

REMOTIVE_URL = "https://remotive.com/api/remote-jobs"

# Map common tech keywords to Remotive's category slugs
# Using category instead of search= gives far more results since
# Remotive's text search is strict (exact substring match on title only)
TITLE_TO_CATEGORY = {
    "software": "software-dev",
    "developer": "software-dev",
    "engineer": "software-dev",
    "java": "software-dev",
    "python": "software-dev",
    "react": "software-dev",
    "angular": "software-dev",
    "vue": "software-dev",
    "node": "software-dev",
    "frontend": "software-dev",
    "front-end": "software-dev",
    "backend": "software-dev",
    "back-end": "software-dev",
    "fullstack": "software-dev",
    "full-stack": "software-dev",
    "mobile": "software-dev",
    "ios": "software-dev",
    "android": "software-dev",
    "devops": "devops-sysadmin",
    "sysadmin": "devops-sysadmin",
    "infrastructure": "devops-sysadmin",
    "cloud": "devops-sysadmin",
    "data": "data",
    "analyst": "data",
    "ml": "data",
    "machine learning": "data",
    "ai ": "data",
    "designer": "design",
    "ux": "design",
    "ui": "design",
    "qa": "qa",
    "tester": "qa",
    "quality": "qa",
    "product": "product",
    "manager": "management",
    "sales": "sales",
    "support": "customer-support",
    "writer": "writing",
    "content": "writing",
    "marketing": "marketing",
    "finance": "finance",
    "accounting": "finance",
}


DATE_POSTED_DAYS = {
    "today": 1,
    "3days": 3,
    "week":  7,
    "month": 30,
}


def _date_cutoff(date_posted: str):
    """Return a UTC datetime cutoff, or None for 'any'."""
    days = DATE_POSTED_DAYS.get(date_posted)
    if days:
        return datetime.now(timezone.utc) - timedelta(days=days)
    return None


def _detect_category(job_titles: List[str]) -> str:
    """Pick the best Remotive category from the job title list."""
    combined = " ".join(job_titles).lower()
    for keyword, category in TITLE_TO_CATEGORY.items():
        if keyword in combined:
            return category
    return "software-dev"   # sensible default for bench sales use-case


async def search_remote_jobs(
    job_titles: List[str],
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    date_posted: str = "any",
    num_results: int = 10
) -> List[Dict]:
    """
    Search Remotive for remote jobs matching the given titles.

    Strategy: fetch up to 100 jobs by category (much broader than text search),
    then filter client-side by title keywords.  The old approach of passing
    search=<title> returned 0 results because Remotive's server-side search
    does a strict substring match on title and most roles (e.g. 'Java Developer')
    yielded no hits despite relevant jobs existing under a category.
    """
    category = _detect_category(job_titles)

    params = {
        "category": category,
        "limit": 100,   # fetch the full category pool; filter client-side
    }

    results = []
    cutoff = _date_cutoff(date_posted)

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(REMOTIVE_URL, params=params)

            if resp.status_code != 200:
                print(f"[Remotive] Error {resp.status_code}: {resp.text[:200]}")
                return []

            data = resp.json()
            jobs = data.get("jobs", [])
            print(f"[Remotive] Category '{category}' returned {len(jobs)} jobs "
                  f"(total in DB: {data.get('total-job-count', 'N/A')})")

            # Build a flat list of meaningful title keywords for matching
            title_keywords = [
                w for w in " ".join(job_titles).lower().split() if len(w) > 3
            ]

            for job in jobs:
                title = job.get("title", "")
                description = job.get("description", "") or ""
                title_lower = title.lower()

                # Date filter — skip jobs older than the requested window
                if cutoff:
                    pub_date_str = job.get("publication_date", "")[:10]
                    if pub_date_str:
                        try:
                            pub_dt = datetime.strptime(pub_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                            if pub_dt < cutoff:
                                continue
                        except ValueError:
                            pass

                # Must contain at least one meaningful keyword from the search titles
                if not any(
                    t.lower() in title_lower or title_lower in t.lower()
                    for t in job_titles
                ):
                    if not any(kw in title_lower for kw in title_keywords):
                        continue

                # Exclude keywords filter
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
        print(f"[Remotive] Request error: {type(e).__name__}: {e}")

    print(f"[Remotive] Returning {len(results)} jobs after filtering")
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
