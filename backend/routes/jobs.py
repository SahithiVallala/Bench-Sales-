"""
Job Search routes — multi-platform search with AI match scoring
"""
import asyncio
import math
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import List

from models.schemas import JobSearchRequest, JobSearchResponse, JobResult
from services.supabase_client import get_supabase
from services import gemini_service
from services.job_search import google_cse, jsearch, remotive

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# Which API handles which platform
# Note: Glassdoor is served via JSearch because Google search only returns
# Glassdoor category listing pages (individual jobs require login/JS).
# JSearch surfaces Glassdoor-published jobs via its job_publisher field.
CSE_PLATFORMS      = {"naukri", "dice"}
JSEARCH_PLATFORMS  = {"linkedin", "indeed", "ziprecruiter", "glassdoor"}
REMOTIVE_PLATFORMS = {"remotive"}


def _keyword_score(title: str, description: str, candidate_role: str, candidate_skills: list) -> dict:
    """
    Fast keyword-based fallback scorer — used when Gemini quota is exceeded.
    Counts how many candidate skills appear in the job text.
    """
    text = (title + " " + description).lower()
    role_match = bool(candidate_role) and candidate_role.lower() in text

    matched = [s for s in candidate_skills if s.lower() in text]
    missing = [s for s in candidate_skills if s.lower() not in text]

    if candidate_skills:
        score = int(len(matched) / len(candidate_skills) * 100)
        if role_match:
            score = min(100, score + 10)
        summary = f"Keyword match: {len(matched)}/{len(candidate_skills)} skills found in job description."
    elif candidate_role:
        score   = 65 if role_match else 35
        summary = "Job title matches candidate role." if role_match else "Role mismatch with job title."
    else:
        # No resume data to score against — neutral
        score   = 50
        summary = "Resume not yet parsed — upload and parse resume for accurate scoring."

    return {
        "match_score":    score,
        "matched_skills": matched,
        "missing_skills": missing,
        "summary":        summary,
    }


# Title words that indicate seniority / junior level (lowercase)
_SENIOR_WORDS = {"senior", "sr", "lead", "principal", "staff", "director",
                 "manager", "architect", "vp", "head", "chief", "distinguished"}
_JUNIOR_WORDS = {"junior", "jr", "entry", "associate", "intern",
                 "trainee", "graduate", "fresher", "beginner"}


def _extract_min_years(text: str) -> int | None:
    """
    Extract the minimum years of experience REQUIRED by the job.
    Returns None if no clear requirement found.

    Only matches patterns that unambiguously refer to candidate requirements,
    NOT company descriptions like "We have 20 years of experience".

    Safe patterns:
      - "5+ years"                    → 5   (almost always a requirement)
      - "minimum 4 years"             → 4
      - "at least 7 years"            → 7
      - "3-5 years required"          → 3
      - "requires 5 years"            → 5

    Intentionally NOT matched (too many false positives):
      - "X years of experience"  ← also appears in company bio sections
      - "X-Y years"              ← appears in "founded 10-15 years ago"
    """
    t = text.lower()

    # "minimum X years" / "at least X years" / "minimum of X years"
    m = re.search(r'(?:minimum|at\s+least|minimum\s+of)\s+(\d{1,2})\s*\+?\s*years?', t)
    if m:
        return int(m.group(1))

    # "requires/required X years"
    m = re.search(r'require[sd]?\s+(\d{1,2})\s*\+?\s*years?', t)
    if m:
        return int(m.group(1))

    # "X+ years" — the plus sign makes this almost always a job requirement
    m = re.search(r'\b(\d{1,2})\+\s*years?', t)
    if m:
        return int(m.group(1))

    return None


def _experience_matches(job: dict, experience_level: str) -> bool:
    """
    Returns True if the job's required experience matches the selected level.
    Only hard-excludes jobs that clearly exceed the selected range.

    Ranges:
      entry  = 0-2 years
      mid    = 2-5 years
      senior = 5+ years
    """
    if experience_level == "any":
        return True

    title = (job.get("title", "") or "").lower()
    desc  = (job.get("description", "") or "").lower()
    text  = title + " " + desc

    min_yrs = _extract_min_years(text)

    title_tokens = set(re.split(r'[\s,./\-]+', title))
    is_senior_title = bool(title_tokens & _SENIOR_WORDS)
    is_junior_title = bool(title_tokens & _JUNIOR_WORDS)

    if experience_level == "entry":
        # Exclude jobs requiring 3+ years
        if min_yrs is not None and min_yrs >= 3:
            return False
        # Exclude jobs with senior/lead titles (unless also tagged junior — rare edge case)
        if is_senior_title and not is_junior_title:
            return False
        return True

    elif experience_level == "mid":
        # Exclude jobs requiring 6+ years (senior territory)
        if min_yrs is not None and min_yrs >= 6:
            return False
        # Exclude obvious intern/trainee roles
        if is_junior_title and not is_senior_title and min_yrs is None:
            return False
        return True

    elif experience_level == "senior":
        # Exclude clearly entry/intern roles when no year requirement found
        if is_junior_title and not is_senior_title and min_yrs is None:
            return False
        # Exclude jobs explicitly requiring < 2 years
        if min_yrs is not None and min_yrs < 2:
            return False
        return True

    return True


@router.post("/search", response_model=JobSearchResponse)
async def search_jobs(req: JobSearchRequest):
    """
    Search jobs across selected platforms, score each against the selected resume.
    All platform searches run in PARALLEL for speed.
    """
    supabase = get_supabase()

    # 1. Fetch resume for matching
    resume_result = supabase.table("resumes") \
        .select("id, candidate_name, primary_role, primary_skills, "
                "secondary_skills, experience_years, parsed_text") \
        .eq("id", req.resume_id) \
        .single().execute()

    if not resume_result.data:
        raise HTTPException(404, "Resume not found")

    resume = resume_result.data
    candidate_skills = (resume.get("primary_skills") or []) + \
                       (resume.get("secondary_skills") or [])
    candidate_role   = resume.get("primary_role") or ""
    experience_years = resume.get("experience_years")

    # 2. Split selected platforms by API type
    platforms_selected = [p.value for p in req.platforms]
    cse_platforms      = [p for p in platforms_selected if p in CSE_PLATFORMS]
    jsearch_platforms  = [p for p in platforms_selected if p in JSEARCH_PLATFORMS]
    include_remotive   = "remotive" in platforms_selected

    # Per-platform quota: divide requested jobs equally across all selected platforms.
    total_platforms = len(cse_platforms) + len(jsearch_platforms) + (1 if include_remotive else 0)
    per_platform    = math.ceil(req.num_results / total_platforms) if total_platforms else req.num_results

    # Fetch much more than needed — URL filters, publisher filters and dedup all reduce counts.
    # CSE capped at 50: Serper returns 10/page, 5 pages max = 50 results per platform.
    # JSearch: 5× per platform because publisher filtering leaves ~30-40% after dedup.
    cse_per_platform  = min(per_platform * 6, 50)
    jsearch_total     = per_platform * max(len(jsearch_platforms), 1) * 5
    remotive_per_call = max(20, per_platform * 3)

    print(f"\n{'='*60}")
    print(f"[Search] platforms={platforms_selected} num_results={req.num_results}")
    print(f"[Search] per_platform={per_platform}  cse_fetch={cse_per_platform}  "
          f"jsearch_fetch={jsearch_total}  remotive_fetch={remotive_per_call}")
    print(f"{'='*60}")

    # 3. Build async tasks; track which platform(s) each task covers.
    #    task_platform[i] = platform name for single-platform tasks,
    #    or None for JSearch (which returns multiple platforms in one call).
    tasks         = []
    task_platform = []

    for platform in cse_platforms:
        tasks.append(google_cse.search_platform(
            platform=platform,
            job_titles=req.job_titles,
            locations=req.locations,
            work_mode=req.work_mode.value,
            job_type=req.job_type.value,
            experience_level=req.experience_level.value,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            date_posted=req.date_posted.value,
            num_results=cse_per_platform
        ))
        task_platform.append(platform)

    # ONE JSearch call for all selected platforms — avoids duplicate queries.
    # Each job already carries a "platform" field set by _parse_job.
    if jsearch_platforms:
        tasks.append(jsearch.search_platforms_combined(
            platforms=jsearch_platforms,
            job_titles=req.job_titles,
            locations=req.locations,
            work_mode=req.work_mode.value,
            job_type=req.job_type.value,
            experience_level=req.experience_level.value,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            date_posted=req.date_posted.value,
            num_results=jsearch_total
        ))
        task_platform.append(None)  # multi-platform; trust job["platform"] field

    if include_remotive:
        tasks.append(remotive.search_remote_jobs(
            job_titles=req.job_titles,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            date_posted=req.date_posted.value,
            num_results=remotive_per_call
        ))
        task_platform.append("remotive")

    # 4. Run all searches in parallel
    all_platform_results = await asyncio.gather(*tasks, return_exceptions=True)

    # 5. Bucket raw jobs by platform + deduplicate.
    #    CSE results belong to one platform (tracked via task_platform).
    #    JSearch results carry a "platform" field per job.
    #    Remotive results are all tagged "remotive".
    seen_urls = set()
    buckets: dict = {p: [] for p in platforms_selected}
    # JSearch jobs from unrecognized publishers (e.g. "bebee", "recruit.net") are
    # redistributed round-robin among selected JSearch platforms so they aren't lost.
    jsearch_overflow: list = []
    jsearch_overflow_idx = 0

    for i, platform_results in enumerate(all_platform_results):
        if isinstance(platform_results, Exception):
            print(f"[Search] Platform error: {platform_results}")
            continue
        expected = task_platform[i]   # None for JSearch, platform name otherwise
        for job in platform_results:
            url = job.get("job_url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            if expected is None:
                # JSearch — trust the job's "platform" field (set by _parse_job)
                actual = job.get("platform", "").lower()
                if actual in buckets:
                    buckets[actual].append(job)
                elif jsearch_platforms:
                    # Unrecognized publisher (e.g. "bebee") — keep and redistribute
                    jsearch_overflow.append(job)
            else:
                # CSE or Remotive — use the known expected platform
                if expected in buckets:
                    buckets[expected].append(job)

    # Distribute unrecognized JSearch jobs round-robin across selected JSearch platforms
    for job in jsearch_overflow:
        target = jsearch_platforms[jsearch_overflow_idx % len(jsearch_platforms)]
        job["platform"] = target
        buckets[target].append(job)
        jsearch_overflow_idx += 1

    print(f"\n[Buckets after collection]")
    for p, jobs in buckets.items():
        print(f"  {p}: {len(jobs)} raw jobs")
    print(f"  jsearch_overflow redistributed: {jsearch_overflow_idx} jobs")

    raw_jobs = [job for jobs_list in buckets.values() for job in jobs_list]
    print(f"[Total raw_jobs to score]: {len(raw_jobs)}")

    if not raw_jobs:
        return JobSearchResponse(
            total=0,
            jobs=[],
            resume_id=req.resume_id,
            searched_at=datetime.now(timezone.utc)
        )

    # 6. Score ALL raw jobs so every platform's candidates are ranked fairly.
    scored_jobs = await _score_jobs_parallel(
        raw_jobs,
        candidate_role,
        candidate_skills,
        experience_years
    )

    # 7. Enforce strict per-platform quota with experience-level post-filter:
    #    - Re-bucket scored jobs by platform, dropping those that don't match
    #      the requested experience level (checked via regex on title+description).
    #    - Take the top per_platform (by score) from each selected platform.
    #    - If a platform delivered fewer than its quota, fill the gap from
    #      other platforms' overflow (highest-scoring extras first).
    exp_level = req.experience_level.value
    scored_buckets: dict = {p: [] for p in platforms_selected}
    exp_filtered_out = 0
    for job in scored_jobs:
        p = job.get("platform", "")
        if p in scored_buckets:
            if _experience_matches(job, exp_level):
                scored_buckets[p].append(job)
            else:
                exp_filtered_out += 1

    print(f"\n[After experience filter ({exp_level})] removed={exp_filtered_out}")
    for p, jobs in scored_buckets.items():
        print(f"  {p}: {len(jobs)} jobs  (quota per platform: {per_platform})")

    final_jobs: list = []
    overflow:   list = []
    for platform in platforms_selected:
        bucket = sorted(scored_buckets[platform],
                        key=lambda j: j.get("match_score", 0), reverse=True)
        taken = bucket[:per_platform]
        final_jobs.extend(taken)
        overflow.extend(bucket[per_platform:])
        print(f"  → {platform}: took {len(taken)} / {len(bucket)} available")

    # Fill remaining slots from overflow (any platform that had extras)
    if len(final_jobs) < req.num_results:
        overflow.sort(key=lambda j: j.get("match_score", 0), reverse=True)
        needed = req.num_results - len(final_jobs)
        fill = overflow[:needed]
        final_jobs.extend(fill)
        print(f"  → overflow fill: +{len(fill)} jobs  (needed {needed})")

    print(f"\n[Final] returning {len(final_jobs)} / {req.num_results} requested")
    scored_jobs = final_jobs

    # 8. Save to jobs_cache + job_assignments
    saved_jobs = await _save_jobs_to_cache(
        supabase, scored_jobs, req.resume_id,
        req.model_dump(exclude={"resume_id"})
    )

    return JobSearchResponse(
        total=len(saved_jobs),
        jobs=saved_jobs,
        resume_id=req.resume_id,
        searched_at=datetime.now(timezone.utc)
    )


async def _score_jobs_parallel(
    jobs: list,
    candidate_role: str,
    candidate_skills: list,
    experience_years
) -> list:
    """Score all jobs in parallel (max 5 concurrent to respect API rate limits)."""
    semaphore = asyncio.Semaphore(5)

    async def score_one(job: dict) -> dict:
        async with semaphore:
            desc  = job.get("description", "") or ""
            title = job.get("title", "")

            # Try Gemini first; fall back to keyword scoring on quota/error
            try:
                loop = asyncio.get_event_loop()
                score_data = await loop.run_in_executor(
                    None,
                    gemini_service.score_job_match,
                    title, desc, candidate_role, candidate_skills, experience_years
                )
                # Gemini silently returns score=0 when quota is exceeded — detect and fall back
                gemini_failed = (
                    score_data.get("match_score", 0) == 0
                    and not score_data.get("matched_skills")
                    and "unable to score" in (score_data.get("summary", "")).lower()
                )
                if gemini_failed:
                    raise RuntimeError("Gemini quota exceeded — using keyword scorer")
            except Exception as e:
                print(f"[Score] Gemini unavailable ({e}), using keyword fallback")
                score_data = _keyword_score(title, desc, candidate_role, candidate_skills)

            job["match_score"]   = score_data.get("match_score", 0)
            job["match_reasons"] = {
                "matched_skills": score_data.get("matched_skills", []),
                "missing_skills": score_data.get("missing_skills", []),
                "summary":        score_data.get("summary", "")
            }
            return job

    return await asyncio.gather(*[score_one(j) for j in jobs])


async def _save_jobs_to_cache(
    supabase, jobs: list, resume_id: str, search_params: dict
) -> List[JobResult]:
    """
    Upsert jobs into jobs_cache, create job_assignments.
    Returns list of JobResult with DB ids.
    """
    result_jobs = []

    for job in jobs:
        try:
            # Upsert into jobs_cache (unique on job_url)
            cache_record = {
                "title":           job["title"],
                "company":         job.get("company"),
                "platform":        job.get("platform"),
                "job_url":         job["job_url"],
                "description":     job.get("description"),
                "location":        job.get("location"),
                "work_mode":       job.get("work_mode"),
                "job_type":        job.get("job_type"),
                "salary_range":    job.get("salary_range"),
                "skills_required": job.get("skills_required", []),
                "search_params":   search_params,
            }
            if job.get("posted_date"):
                cache_record["posted_date"] = job["posted_date"]

            cache_result = supabase.table("jobs_cache").upsert(
                cache_record, on_conflict="job_url"
            ).execute()

            job_id = None
            if cache_result.data:
                job_id = cache_result.data[0]["id"]

                # Create job_assignment (ignore if already exists)
                try:
                    supabase.table("job_assignments").upsert({
                        "job_id":       job_id,
                        "resume_id":    resume_id,
                        "match_score":  job.get("match_score", 0),
                        "match_reasons": job.get("match_reasons", {}),
                        "status":       "assigned",
                    }, on_conflict="job_id,resume_id").execute()
                except Exception:
                    pass  # Already assigned — ignore

            result_jobs.append(JobResult(
                id=job_id,
                title=job["title"],
                company=job.get("company"),
                platform=job.get("platform", ""),
                job_url=job["job_url"],
                location=job.get("location"),
                work_mode=job.get("work_mode"),
                job_type=job.get("job_type"),
                salary_range=job.get("salary_range"),
                posted_date=str(job.get("posted_date") or ""),
                description=job.get("description"),
                skills_required=job.get("skills_required", []),
                match_score=job.get("match_score"),
                match_reasons=job.get("match_reasons"),
            ))

        except Exception as e:
            print(f"[Jobs] Cache save error for {job.get('title')}: {e}")
            # Still return the job even if cache save fails
            result_jobs.append(JobResult(**{
                k: job.get(k) for k in JobResult.model_fields
                if k in job
            }))

    return result_jobs


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Get full job detail from cache."""
    supabase = get_supabase()
    result = supabase.table("jobs_cache") \
        .select("*").eq("id", job_id).single().execute()
    if not result.data:
        raise HTTPException(404, "Job not found")
    return result.data


@router.post("/{job_id}/assign/{resume_id}")
async def assign_job_to_resume(job_id: str, resume_id: str):
    """Manually assign a job to a resume (creates job_assignment)."""
    supabase = get_supabase()
    result = supabase.table("job_assignments").upsert({
        "job_id":    job_id,
        "resume_id": resume_id,
        "status":    "assigned",
    }, on_conflict="job_id,resume_id").execute()
    return result.data[0] if result.data else {"message": "Assigned"}
