"""
Serper.dev (Google Search API) — searches Naukri, Dice
Endpoint: https://google.serper.dev/search  (POST)
Free tier: 2500 searches/month
"""
import os
import httpx
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv()

SERPER_URL = "https://google.serper.dev/search"

# Platform → site restriction used in the search query
PLATFORM_SITES = {
    "naukri":    "naukri.com",
    "dice":      "dice.com",
    "glassdoor": "glassdoor.com",
}

# NOTE: Experience level is NOT added to the Serper query.
# Adding "entry level" etc. to a Google site: query massively reduces results
# because most job postings don't use those exact phrases in their page titles.
# Experience filtering is handled as a post-filter in routes/jobs.py instead.

# NOTE: Google's tbs (time-based search) filters by INDEXING date, not posting date.
# Naukri/Dice pages are rarely re-crawled, so tbs always returns 0 results.
# Date filtering is intentionally omitted for CSE — rely on JSearch/Remotive for dates.


def _build_query(
    job_titles: List[str],
    locations: Optional[List[str]],
    work_mode: str,
    job_type: str,
    include_keywords: Optional[List[str]],
    exclude_keywords: Optional[List[str]],
    site: str,
) -> str:
    parts = []

    # Job titles — quoted and OR'd (most important signal)
    if len(job_titles) == 1:
        parts.append(f'"{job_titles[0]}"')
    else:
        titles_str = " OR ".join(f'"{t}"' for t in job_titles)
        parts.append(f"({titles_str})")

    # Location — plain text (quoting kills results for location)
    if locations:
        clean = [l.strip() for l in locations if l.strip()]
        if clean:
            parts.append(" OR ".join(clean))

    # Work mode — plain text
    if work_mode and work_mode != "any":
        parts.append(work_mode)

    # Job type — plain text
    if job_type and job_type != "any":
        parts.append(job_type.replace("_", " "))

    # Include keywords — quoted
    if include_keywords:
        kw_str = " OR ".join(f'"{k}"' for k in include_keywords)
        parts.append(f"({kw_str})")

    # Exclude keywords
    if exclude_keywords:
        for kw in exclude_keywords:
            parts.append(f'-"{kw}"')

    # Site restriction — must be last
    parts.append(f"site:{site}")

    return " ".join(parts)


async def _fetch_serper(
    client: httpx.AsyncClient,
    query: str,
    platform: str,
    num_results: int,
    headers: dict,
) -> List[Dict]:
    """
    Execute paginated Serper requests for a query.
    Returns up to num_results parsed jobs.
    Capped at 5 pages (50 results) to avoid excessive API quota usage.
    """
    pages_needed = min(max(1, (num_results + 9) // 10), 5)  # max 5 pages = 50 results
    results = []

    for page in range(1, pages_needed + 1):
        payload = {"q": query, "num": 10, "page": page}
        try:
            resp = await client.post(SERPER_URL, json=payload, headers=headers)
        except Exception as e:
            print(f"[Serper] Request error ({type(e).__name__}): {e}")
            break

        if resp.status_code == 401:
            print("[Serper] Invalid API key — check SERPER_API_KEY in .env")
            break
        if resp.status_code == 429:
            print("[Serper] Rate limit hit — free tier (2500/month) exhausted")
            break
        if resp.status_code != 200:
            print(f"[Serper] Error {resp.status_code}: {resp.text[:200]}")
            break

        organic = resp.json().get("organic", [])
        passed = 0
        for item in organic:
            parsed = _parse_item(item, platform)
            if parsed:
                results.append(parsed)
                passed += 1
            if len(results) >= num_results:
                break

        print(f"[Serper] {platform} page {page}/{pages_needed}: "
              f"{len(organic)} raw → {passed} passed → {len(results)} total")

        if not organic or len(results) >= num_results:
            break

    return results


async def search_platform(
    platform: str,
    job_titles: List[str],
    locations: Optional[List[str]] = None,
    work_mode: str = "any",
    job_type: str = "any",
    experience_level: str = "any",   # kept for API compat; not used in query
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    date_posted: str = "week",       # kept for API compat; not used (see NOTE above)
    num_results: int = 10
) -> List[Dict]:
    """Search a single platform (Naukri/Dice) via Serper.dev."""
    api_key = os.getenv("SERPER_API_KEY", "")
    if not api_key:
        print("[Serper] SERPER_API_KEY not set in .env")
        return []

    site = PLATFORM_SITES.get(platform)
    if not site:
        print(f"[Serper] Unknown platform: {platform}")
        return []

    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

    # Primary query: with location
    query = _build_query(
        job_titles, locations, work_mode, job_type,
        include_keywords, exclude_keywords, site,
    )
    print(f"[Serper] {platform} query: {query}")

    async with httpx.AsyncClient(timeout=30) as client:
        results = await _fetch_serper(client, query, platform, num_results, headers)

        # Fallback: if location was set and returned too few results, retry without location.
        # Google's index for niche platforms (Dice/Naukri) is small — location restricts further.
        if len(results) < max(3, num_results // 3) and locations:
            query_no_loc = _build_query(
                job_titles, None, work_mode, job_type,
                include_keywords, exclude_keywords, site,
            )
            print(f"[Serper] {platform} too few results ({len(results)}) with location — "
                  f"retrying without location: {query_no_loc}")
            extra = await _fetch_serper(client, query_no_loc, platform, num_results, headers)
            # Merge, keeping existing results first and deduplicating by URL
            seen = {r["job_url"] for r in results}
            for job in extra:
                if job["job_url"] not in seen:
                    results.append(job)
                    seen.add(job["job_url"])
                if len(results) >= num_results:
                    break

    print(f"[Serper] {platform} FINAL: {len(results)} jobs (requested {num_results})")
    return results[:num_results]


def _parse_item(item: dict, platform: str) -> Optional[Dict]:
    title   = item.get("title", "")
    link    = item.get("link", "")
    snippet = item.get("snippet", "")
    date    = item.get("date", None)

    if not title or not link:
        return None

    # Skip obvious non-job pages by title
    skip_words = ["login", "signup", "register", "home page", "search results",
                  "all companies", "top companies", "browse jobs"]
    if any(w in title.lower() for w in skip_words):
        return None

    link_lower = link.lower()

    # Generic search/category page patterns
    if any(p in link_lower for p in [
        "/jobs?", "jobs/q-", "/job-search", "/career-advice/",
        "/sitemap", "/about", "/blog", "/press", "/company/",
    ]):
        return None

    # Naukri: individual jobs are at /job-listings-<title>-<id>
    if "naukri.com" in link_lower:
        path = link_lower.split("naukri.com")[-1].split("?")[0]
        if not (path.startswith("/job-listings") or path.startswith("/job-listing/")):
            return None

    # Dice: accept /job-detail/ (primary) and /jobs/<slug> (newer format)
    if "dice.com" in link_lower:
        if not any(p in link_lower for p in ["/job-detail/", "/jobs/"]):
            return None
        # /jobs on its own (no slug) is the search landing page
        if "/jobs/" in link_lower and link_lower.rstrip("/").endswith("/jobs"):
            return None

    # Glassdoor: individual jobs only
    if "glassdoor.com" in link_lower:
        if not any(p in link_lower for p in ["/job-listing/", "/job-listings/", "/partner/jobListing"]):
            return None

    # Extract company from "Job Title - Company | Platform" format
    company = None
    if " - " in title:
        parts = title.split(" - ")
        if len(parts) >= 2:
            company = parts[-1].split("|")[0].strip()
            for plat in ["Naukri.com", "Dice", "Glassdoor"]:
                company = company.replace(plat, "").strip()
            if not company:
                company = None

    return {
        "title":        title.split(" - ")[0].strip() if " - " in title else title,
        "company":      company,
        "platform":     platform,
        "job_url":      link,
        "description":  snippet,
        "location":     None,
        "work_mode":    None,
        "job_type":     None,
        "salary_range": None,
        "posted_date":  date,
    }
