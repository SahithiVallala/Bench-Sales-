"""
Bench Sales Automation Platform — FastAPI Backend
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os

load_dotenv()

from routes import resumes, jobs, submissions, analytics, extension, email

app = FastAPI(
    title="Bench Sales Automation Platform",
    description="API for bench sales job search, resume matching, and submission tracking",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,   # Must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(resumes.router)
app.include_router(jobs.router)
app.include_router(submissions.router)
app.include_router(analytics.router)
app.include_router(extension.router)
app.include_router(email.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Ensure CORS headers are present even on 500 errors so the browser shows the real error."""
    origin = request.headers.get("origin", "")
    headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"} if origin else {}
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {type(exc).__name__}: {str(exc)[:300]}"},
        headers=headers,
    )


@app.get("/")
async def root():
    return {
        "app":     "Bench Sales Automation Platform",
        "version": "1.0.0",
        "status":  "running",
        "docs":    "/docs",
    }

@app.get("/health")
async def health():
    return {"status": "ok"}
