"""
Job Search routes — multi-platform search with AI match scoring
"""
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import List

from models.schemas import JobSearchRequest, JobSearchResponse, JobResult
from services.supabase_client import get_supabase
from services import gemini_service
from services.job_search import google_cse, jsearch, remotive

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# Which API handles which platform
CSE_PLATFORMS      = {"naukri", "dice", "glassdoor"}
JSEARCH_PLATFORMS  = {"linkedin", "indeed", "ziprecruiter"}
REMOTIVE_PLATFORMS = {"remotive"}


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

    results_per_platform = max(5, req.num_results // max(len(platforms_selected), 1))

    # 3. Build async tasks for all platforms
    tasks = []

    for platform in cse_platforms:
        tasks.append(google_cse.search_platform(
            platform=platform,
            job_titles=req.job_titles,
            locations=req.locations,
            work_mode=req.work_mode.value,
            job_type=req.job_type.value,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            date_posted=req.date_posted.value,
            num_results=results_per_platform
        ))

    for platform in jsearch_platforms:
        tasks.append(jsearch.search_platform(
            platform=platform,
            job_titles=req.job_titles,
            locations=req.locations,
            work_mode=req.work_mode.value,
            job_type=req.job_type.value,
            experience_level=req.experience_level.value,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            date_posted=req.date_posted.value,
            num_results=results_per_platform
        ))

    if include_remotive:
        tasks.append(remotive.search_remote_jobs(
            job_titles=req.job_titles,
            include_keywords=req.include_keywords,
            exclude_keywords=req.exclude_keywords,
            num_results=results_per_platform
        ))

    # 4. Run all searches in parallel
    all_platform_results = await asyncio.gather(*tasks, return_exceptions=True)

    # 5. Merge + deduplicate by job_url
    raw_jobs = []
    seen_urls = set()
    for platform_results in all_platform_results:
        if isinstance(platform_results, Exception):
            print(f"[Search] Platform error: {platform_results}")
            continue
        for job in platform_results:
            url = job.get("job_url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                raw_jobs.append(job)

    if not raw_jobs:
        return JobSearchResponse(
            total=0,
            jobs=[],
            resume_id=req.resume_id,
            searched_at=datetime.now(timezone.utc)
        )

    # 6. Score each job against resume with Gemini (in parallel, batched)
    scored_jobs = await _score_jobs_parallel(
        raw_jobs[:req.num_results],
        candidate_role,
        candidate_skills,
        experience_years
    )

    # 7. Sort by match score descending
    scored_jobs.sort(key=lambda j: j.get("match_score", 0), reverse=True)

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
            desc = job.get("description", "") or ""
            title = job.get("title", "")
            if not desc and not title:
                job["match_score"] = 0
                job["match_reasons"] = {}
                return job

            loop = asyncio.get_event_loop()
            score_data = await loop.run_in_executor(
                None,
                gemini_service.score_job_match,
                title,
                desc,
                candidate_role,
                candidate_skills,
                experience_years
            )
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
