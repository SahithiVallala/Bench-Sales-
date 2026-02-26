# Bench Sales Automation Platform

A full-stack web platform for staffing companies to manage bench candidates, search for matching jobs across multiple platforms, track resume submissions, and manage the full placement pipeline — with AI-powered resume parsing and job matching.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Backend | Python FastAPI, Uvicorn |
| Database | Supabase (PostgreSQL + Storage) |
| AI | Google Gemini 1.5 Flash |
| Job APIs | Google CSE, JSearch (RapidAPI), Remotive |

---

## Project Structure

```
bench-sales-platform/
├── backend/                  # FastAPI Python backend
│   ├── main.py               # App entry point, CORS, routes
│   ├── requirements.txt      # Python dependencies
│   ├── .env.example          # Copy to .env and fill in your keys
│   ├── routes/
│   │   ├── resumes.py        # POST/GET/DELETE /api/resumes
│   │   ├── jobs.py           # GET /api/jobs/search
│   │   ├── submissions.py    # CRUD /api/submissions
│   │   ├── vendors.py        # CRUD /api/vendors
│   │   └── analytics.py      # GET /api/analytics/dashboard
│   └── services/
│       ├── supabase_client.py  # Supabase connection
│       ├── gemini_service.py   # AI: resume parsing, job scoring, email gen
│       ├── resume_parser.py    # PDF/DOCX text extraction (pdfplumber + pypdf)
│       └── job_search/         # Multi-platform job search (Google CSE, JSearch, Remotive)
├── frontend/                 # Next.js frontend
│   └── app/
│       ├── dashboard/        # KPI cards + pipeline funnel
│       ├── resumes/          # Candidate list + upload + profile
│       ├── search/           # Job search + AI match scores
│       ├── submissions/      # Submission tracker + detail view
│       └── vendors/          # Vendor management
└── supabase/
    └── schema.sql            # Full DB schema — run this once in Supabase SQL Editor
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/resumes` | Upload PDF/DOCX, AI parses it, saves to DB |
| GET | `/api/resumes` | List all bench candidates |
| GET | `/api/resumes/{id}` | Get full candidate profile |
| DELETE | `/api/resumes/{id}` | Delete candidate |
| GET | `/api/jobs/search` | Search jobs across Google CSE + JSearch + Remotive with AI scoring |
| POST | `/api/submissions` | Create a new submission |
| GET | `/api/submissions` | List all submissions |
| GET | `/api/submissions/{id}` | Get submission detail |
| PATCH | `/api/submissions/{id}/status` | Update submission status |
| POST | `/api/submissions/{id}/regenerate-note` | Regenerate AI submission email |
| GET | `/api/vendors` | List all vendors |
| POST | `/api/vendors` | Add a vendor |
| PATCH | `/api/vendors/{id}` | Update vendor |
| DELETE | `/api/vendors/{id}` | Delete vendor |
| GET | `/api/analytics/dashboard` | KPI stats + pipeline counts |

---

## Setup Instructions (for teammates)

### Prerequisites
- Python 3.11+
- Node.js 18+
- A Supabase account (free at supabase.com)
- A Google Gemini API key (free at aistudio.google.com)

---

### Step 1 — Supabase Setup (one-time)

1. Go to [supabase.com](https://supabase.com) → create a new project
2. In the SQL Editor, run the entire contents of `supabase/schema.sql`
3. Go to **Storage** → create a bucket named `resumes` → set it to **Public**
4. Go to **Settings → API** → copy:
   - `Project URL` → this is your `SUPABASE_URL`
   - `service_role` key → this is your `SUPABASE_SERVICE_KEY`

> **Important:** If you are in India or facing connectivity issues, install [Cloudflare WARP](https://one.one.one.one) (free) and keep it ON while running the backend. Some ISPs block `supabase.co` API calls from non-browser apps.

---

### Step 2 — Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file from example
copy .env.example .env      # Windows
# cp .env.example .env      # Mac/Linux

# Fill in your keys in .env (open in any text editor)
# Required: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
# Optional: GOOGLE_CSE_API_KEY, GOOGLE_CSE_ID, JSEARCH_API_KEY

# Start the backend
python -m uvicorn main:app --reload
# Runs at http://localhost:8000
# API docs at http://localhost:8000/docs
```

---

### Step 3 — Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

# Start the frontend
npm run dev
# Runs at http://localhost:3000
```

---

### Step 4 — Open the App

With both servers running, open: **http://localhost:3000**

| Page | URL |
|---|---|
| Dashboard | http://localhost:3000/dashboard |
| Add Candidate | http://localhost:3000/resumes/new |
| Search Jobs | http://localhost:3000/search |
| Submissions | http://localhost:3000/submissions |
| Vendors | http://localhost:3000/vendors |

---

## API Keys Quick Reference

| Key | Where to get it | Free tier |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | supabase.com → Settings → API | 500MB DB, 1GB storage |
| `GEMINI_API_KEY` | aistudio.google.com/app/apikey | 1M tokens/day |
| `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` | programmablesearchengine.google.com | 100 queries/day |
| `JSEARCH_API_KEY` | rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch | 500 req/month |

---

## Notes

- The backend uses a **sync Supabase client** — always run inside the venv
- Job search calls all platforms **in parallel** (asyncio.gather) for speed
- AI scoring uses a **semaphore(5)** to limit concurrent Gemini calls
- Resume submissions have a full **stage_history JSONB audit trail**
- The `submissions_detail` DB view joins resumes + vendors automatically
