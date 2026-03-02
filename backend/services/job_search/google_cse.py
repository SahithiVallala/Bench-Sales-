"""
Serper.dev (Google Search API) — searches Naukri, Dice, Glassdoor
Replaced Google CSE which required billing; Serper.dev gives 2500 free searches.
Endpoint: https://google.serper.dev/search  (POST)
Same function signatures as before — no other files need to change.
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

# Map date_posted value → Serper tbs (time-based search) param
DATE_TBS_MAP = {
    "today":  "qdr:d",
    "3days":  "qdr:d3",
    "week":   "qdr:w",
    "month":  "qdr:m",
    "any":    None,
}

EXPERIENCE_LEVEL_KEYWORDS = {
    "entry":  "entry level",
    "mid":    "mid level",
    "senior": "senior",
}


def _build_query(
    job_titles: List[str],
    locations: Optional[List[str]],
    work_mode: str,
    job_type: str,
    include_keywords: Optional[List[str]],
    exclude_keywords: Optional[List[str]],
    site: str,
    experience_level: str = "any"
) -> str:
    parts = []

    # Job titles — quoted and OR'd (most important signal)
    if len(job_titles) == 1:
        parts.append(f'"{job_titles[0]}"')
    else:
        titles_str = " OR ".join(f'"{t}"' for t in job_titles)
        parts.append(f"({titles_str})")

    # Location — plain text, no quotes (quoting location is overly restrictive)
    if locations:
        clean = [l.strip() for l in locations if l.strip()]
        if clean:
            parts.append(" OR ".join(clean))

    # Work mode — plain text keyword only (quoting blocks too many results)
    if work_mode and work_mode != "any":
        parts.append(work_mode)

    # Job type — plain text (e.g. "contract" not '"contract"')
    if job_type and job_type != "any":
        parts.append(job_type.replace("_", " "))

    # Experience level — plain text
    exp_keyword = EXPERIENCE_LEVEL_KEYWORDS.get(experience_level)
    if exp_keyword:
        parts.append(exp_keyword)

    # Include keywords — quoted (user explicitly requested these)
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
    """Search a single platform (Naukri/Dice/Glassdoor) via Serper.dev."""
    api_key = os.getenv("SERPER_API_KEY", "")
    if not api_key:
        print("[Serper] SERPER_API_KEY not set in .env")
        return []

    site = PLATFORM_SITES.get(platform)
    if not site:
        print(f"[Serper] Unknown platform: {platform}")
        return []

    query = _build_query(
        job_titles, locations, work_mode, job_type,
        include_keywords, exclude_keywords, site, experience_level
    )

    tbs = DATE_TBS_MAP.get(date_posted)
    headers = {
        "X-API-KEY":    api_key,
        "Content-Type": "application/json",
    }

    print(f"[Serper] {platform} query: {query}")

    # Serper returns 10 results per page — paginate to reach num_results
    pages_needed = max(1, (num_results + 9) // 10)   # e.g. 20 results → 2 pages
    results = []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for page in range(1, pages_needed + 1):
                payload = {"q": query, "num": 10, "page": page}
                if tbs:
                    payload["tbs"] = tbs

                resp = await client.post(SERPER_URL, json=payload, headers=headers)

                if resp.status_code == 401:
                    print("[Serper] Invalid API key — check SERPER_API_KEY in .env")
                    break
                if resp.status_code == 429:
                    print("[Serper] Rate limit hit — free tier exhausted (2500/month)")
                    break
                if resp.status_code != 200:
                    print(f"[Serper] Error {resp.status_code}: {resp.text[:200]}")
                    break

                organic = resp.json().get("organic", [])
                print(f"[Serper] {platform} page {page}: {len(organic)} results")

                if not organic:
                    break   # no more results

                for item in organic:
                    parsed = _parse_item(item, platform)
                    if parsed:
                        results.append(parsed)
                    if len(results) >= num_results:
                        break

                if len(results) >= num_results:
                    break

    except Exception as e:
        print(f"[Serper] Request error: {type(e).__name__}: {e}")

    return results[:num_results]


def _parse_item(item: dict, platform: str) -> Optional[Dict]:
    title   = item.get("title", "")
    link    = item.get("link", "")
    snippet = item.get("snippet", "")
    date    = item.get("date", None)   # Serper returns date for some results

    if not title or not link:
        return None

    # Skip obvious non-job pages
    skip_words = ["login", "signup", "register", "home page", "search results",
                  "all companies", "top companies", "browse jobs"]
    if any(w in title.lower() for w in skip_words):
        return None

    # Skip job category / search result index pages — not individual job postings
    link_lower = link.lower()

    # Generic patterns that always indicate a search results page
    if any(p in link_lower for p in ["/jobs?", "jobs/q-", "/job-search", "/career-advice/"]):
        return None

    # Platform-specific: Naukri individual jobs are at /job-listings-<title>-<id>
    # everything else on naukri.com is a category page (e.g. /java-developer-jobs)
    if "naukri.com" in link_lower:
        path = link_lower.split("naukri.com")[-1].split("?")[0]
        if not (path.startswith("/job-listings") or path.startswith("/job-listing/")):
            return None

    # Platform-specific: Dice individual jobs are at /job-detail/<id>
    if "dice.com" in link_lower and "/job-detail/" not in link_lower:
        return None

    # Platform-specific: Glassdoor individual jobs contain /job-listing/ or /job-listings/
    if "glassdoor.com" in link_lower:
        if not any(p in link_lower for p in ["/job-listing/", "/job-listings/", "/partner/jobListing"]):
            return None

    # Extract company from title (format: "Job Title - Company | Platform")
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
