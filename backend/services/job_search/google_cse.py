"""
Google Custom Search Engine — searches Naukri, Dice, Glassdoor
Same proven approach as AI-Client-Discovery project
"""
import os
import httpx
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv()

GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"

# Platform → site restriction
PLATFORM_SITES = {
    "naukri":    "naukri.com",
    "dice":      "dice.com",
    "glassdoor": "glassdoor.com",
}

DATE_RESTRICT_MAP = {
    "today":  "d1",
    "3days":  "d3",
    "week":   "w1",
    "month":  "m1",
    "any":    None,
}


def _build_query(
    job_titles: List[str],
    locations: Optional[List[str]],
    work_mode: str,
    job_type: str,
    include_keywords: Optional[List[str]],
    exclude_keywords: Optional[List[str]],
    site: str
) -> str:
    parts = []

    # Job titles — OR'd
    if len(job_titles) == 1:
        parts.append(f'"{job_titles[0]}"')
    else:
        titles_str = " OR ".join(f'"{t}"' for t in job_titles)
        parts.append(f"({titles_str})")

    # Location
    if locations:
        clean = [l.strip() for l in locations if l.strip()]
        if clean:
            if len(clean) == 1:
                parts.append(f'"{clean[0]}"')
            else:
                locs_str = " OR ".join(f'"{l}"' for l in clean)
                parts.append(f"({locs_str})")

    # Work mode
    if work_mode and work_mode != "any":
        parts.append(f'"{work_mode}"')

    # Job type
    if job_type and job_type != "any":
        readable = job_type.replace("_", "-")
        parts.append(f'"{readable}"')

    # Include keywords
    if include_keywords:
        kw_str = " OR ".join(f'"{k}"' for k in include_keywords)
        parts.append(f"({kw_str})")

    # Hiring signal
    parts.append('(hiring OR "apply now" OR "job opening")')

    # Exclude keywords
    if exclude_keywords:
        for kw in exclude_keywords:
            parts.append(f'-"{kw}"')

    # Site restriction
    parts.append(f"site:{site}")

    return " ".join(parts)


async def search_platform(
    platform: str,
    job_titles: List[str],
    locations: Optional[List[str]] = None,
    work_mode: str = "any",
    job_type: str = "any",
    include_keywords: Optional[List[str]] = None,
    exclude_keywords: Optional[List[str]] = None,
    date_posted: str = "week",
    num_results: int = 10
) -> List[Dict]:
    """Search a single platform via Google CSE."""
    api_key = os.getenv("GOOGLE_CSE_API_KEY", "")
    cx = os.getenv("GOOGLE_CSE_ID", "")

    if not api_key or not cx:
        print("[Google CSE] API key or CX not configured")
        return []

    site = PLATFORM_SITES.get(platform)
    if not site:
        print(f"[Google CSE] Unknown platform: {platform}")
        return []

    query = _build_query(job_titles, locations, work_mode, job_type,
                         include_keywords, exclude_keywords, site)

    date_restrict = DATE_RESTRICT_MAP.get(date_posted)

    pages_needed = min((num_results + 9) // 10, 10)
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        for page in range(pages_needed):
            start = page * 10 + 1
            params = {
                "key": api_key,
                "cx": cx,
                "q": query,
                "start": start,
                "num": 10,
            }
            if date_restrict:
                params["dateRestrict"] = date_restrict

            try:
                resp = await client.get(GOOGLE_SEARCH_URL, params=params)
                if resp.status_code == 429 or resp.status_code == 403:
                    print(f"[Google CSE] Quota hit for {platform}")
                    break
                if resp.status_code != 200:
                    print(f"[Google CSE] Error {resp.status_code} for {platform}")
                    break

                items = resp.json().get("items", [])
                if not items:
                    break

                for item in items:
                    parsed = _parse_item(item, platform)
                    if parsed:
                        results.append(parsed)

                if len(results) >= num_results:
                    break

            except Exception as e:
                print(f"[Google CSE] Request error: {e}")
                break

    return results[:num_results]


def _parse_item(item: dict, platform: str) -> Optional[Dict]:
    title   = item.get("title", "")
    link    = item.get("link", "")
    snippet = item.get("snippet", "")

    if not title or not link:
        return None

    # Skip obvious non-job pages
    skip_words = ["login", "signup", "register", "home page", "search results"]
    if any(w in title.lower() for w in skip_words):
        return None

    # Try to extract company from title (format: "Job Title - Company | Platform")
    company = None
    if " - " in title:
        parts = title.split(" - ")
        if len(parts) >= 2:
            company = parts[-1].split("|")[0].strip()
            # Clean platform name from company
            for plat in ["Naukri.com", "Dice", "Glassdoor"]:
                company = company.replace(plat, "").strip()
            if not company:
                company = None

    return {
        "title":       title.split(" - ")[0].strip() if " - " in title else title,
        "company":     company,
        "platform":    platform,
        "job_url":     link,
        "description": snippet,
        "location":    None,
        "work_mode":   None,
        "job_type":    None,
        "salary_range": None,
        "posted_date": None,
    }
