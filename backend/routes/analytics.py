"""Analytics + Dashboard routes"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter
from services.supabase_client import get_supabase

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/dashboard")
async def dashboard_stats():
    """Return KPI stats for the main dashboard."""
    supabase = get_supabase()

    now  = datetime.now(timezone.utc)
    today_start  = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_start   = (now - timedelta(days=7)).isoformat()
    month_start  = (now - timedelta(days=30)).isoformat()

    # Total resumes
    resumes_count = supabase.table("resumes") \
        .select("id", count="exact").execute()
    total_resumes = resumes_count.count or 0

    # Submissions today
    today_subs = supabase.table("submissions") \
        .select("id", count="exact") \
        .gte("created_at", today_start).execute()
    submitted_today = today_subs.count or 0

    # Interviews this week
    interviews = supabase.table("submissions") \
        .select("id", count="exact") \
        .eq("status", "interview") \
        .gte("interview_at", week_start).execute()
    interviews_week = interviews.count or 0

    # Placements this month
    placements = supabase.table("submissions") \
        .select("id", count="exact") \
        .eq("status", "placed") \
        .gte("placed_at", month_start).execute()
    placements_month = placements.count or 0

    # Pipeline funnel — count per status
    all_active = supabase.table("submissions") \
        .select("status").execute()

    pipeline = {}
    for row in (all_active.data or []):
        s = row["status"]
        pipeline[s] = pipeline.get(s, 0) + 1

    active_submissions = sum(
        pipeline.get(s, 0) for s in
        ["shortlisted", "resume_ready", "submitted",
         "vendor_submitted", "client_submitted", "interview", "offer"]
    )

    return {
        "total_resumes":         total_resumes,
        "active_submissions":    active_submissions,
        "submitted_today":       submitted_today,
        "interviews_this_week":  interviews_week,
        "placements_this_month": placements_month,
        "pipeline":              pipeline,
    }


@router.get("/pipeline")
async def pipeline_funnel():
    """Stage-by-stage submission counts for funnel chart."""
    supabase = get_supabase()
    all_subs = supabase.table("submissions").select("status").execute()

    stages = [
        "shortlisted", "resume_ready", "submitted",
        "vendor_submitted", "client_submitted",
        "interview", "offer", "placed", "rejected", "on_hold"
    ]
    counts = {s: 0 for s in stages}
    for row in (all_subs.data or []):
        s = row["status"]
        if s in counts:
            counts[s] += 1

    return [{"stage": s, "count": counts[s]} for s in stages]
