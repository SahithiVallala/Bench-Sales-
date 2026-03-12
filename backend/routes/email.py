"""
JD Inbox — Outlook Email integration via Microsoft Graph API
Endpoints: OAuth flow, email sync, JD listing, candidate matching
"""
import os
import json
import re
import base64
import asyncio
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import httpx

from services.supabase_client import get_supabase
from services.gemini_service import gemini_service_instance as _gemini

router = APIRouter(prefix="/api/email", tags=["email"])

# ── Config ────────────────────────────────────────────────────────────────────

MS_CLIENT_ID     = os.getenv("MS_CLIENT_ID", "")
MS_CLIENT_SECRET = os.getenv("MS_CLIENT_SECRET", "")
MS_TENANT_ID     = os.getenv("MS_TENANT_ID", "common")
MS_REDIRECT_URI  = os.getenv("MS_REDIRECT_URI", "http://localhost:8000/api/email/callback")
MS_SCOPE         = "Mail.Read offline_access User.Read"
TOKEN_FILE       = os.path.join(os.path.dirname(__file__), "..", "email_token.json")
GRAPH_BASE       = "https://graph.microsoft.com/v1.0"


# ── Token helpers ─────────────────────────────────────────────────────────────

def _read_token_file() -> dict | None:
    try:
        with open(TOKEN_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_token_file(data: dict):
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f)


def _is_token_expired(token_data: dict) -> bool:
    expires_at = token_data.get("expires_at", 0)
    # Treat as expired 60 seconds early
    return datetime.now(timezone.utc).timestamp() >= (expires_at - 60)


async def _refresh_access_token(refresh_token: str) -> dict:
    """Exchange refresh_token for a new access_token. Returns updated token dict."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{MS_TENANT_ID or 'common'}/oauth2/v2.0/token",
            data={
                "grant_type":    "refresh_token",
                "client_id":     MS_CLIENT_ID,
                "client_secret": MS_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "scope":         MS_SCOPE,
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

    now = datetime.now(timezone.utc).timestamp()
    token_data = {
        "access_token":  data["access_token"],
        "refresh_token": data.get("refresh_token", refresh_token),
        "expires_at":    now + data.get("expires_in", 3600),
    }
    _write_token_file(token_data)
    return token_data


async def get_valid_token() -> str:
    """Read token from file, refresh if expired. Raises HTTPException if not connected."""
    token_data = _read_token_file()
    if not token_data:
        raise HTTPException(401, "Outlook not connected. Please connect via /api/email/auth-url.")

    if _is_token_expired(token_data):
        print("[Email] Token expired — refreshing...")
        token_data = await _refresh_access_token(token_data["refresh_token"])

    return token_data["access_token"]


# ── HTML stripping ─────────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    """Remove HTML tags and decode common entities."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&') \
               .replace('&lt;', '<').replace('&gt;', '>') \
               .replace('&quot;', '"').replace('&#39;', "'")
    # Collapse whitespace
    text = re.sub(r'\s{3,}', '\n\n', text)
    return text.strip()


def _extract_docx_text(raw_bytes: bytes) -> str | None:
    """Try to extract text from .docx bytes using python-docx. Falls back to None."""
    try:
        import io
        from docx import Document  # type: ignore
        doc = Document(io.BytesIO(raw_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception:
        return None


def _extract_attachment_text(name: str, content_bytes_b64: str) -> str | None:
    """Decode a Graph API attachment contentBytes and extract text."""
    try:
        raw = base64.b64decode(content_bytes_b64)
    except Exception:
        return None

    name_lower = name.lower()

    if name_lower.endswith(".txt"):
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            return None

    if name_lower.endswith(".docx"):
        text = _extract_docx_text(raw)
        if text:
            return text
        # Fallback: try to pull readable text from raw bytes (basic heuristic)
        try:
            readable = raw.decode("utf-8", errors="ignore")
            # Keep only printable ASCII-ish blocks
            parts = re.findall(r'[A-Za-z][A-Za-z0-9 ,.\-/:()]{10,}', readable)
            if parts:
                return " ".join(parts[:200])
        except Exception:
            pass

    if name_lower.endswith(".pdf"):
        # Basic: attempt to extract visible text from PDF bytes
        try:
            text = raw.decode("latin-1", errors="ignore")
            parts = re.findall(r'\(([^\)]{3,})\)', text)
            if parts:
                return " ".join(parts[:300])
        except Exception:
            pass

    return None


# ── OAuth Endpoints ───────────────────────────────────────────────────────────

@router.get("/auth-url")
async def get_auth_url():
    """Return the Microsoft OAuth authorization URL."""
    if not MS_CLIENT_ID:
        raise HTTPException(500, "MS_CLIENT_ID is not configured in environment variables.")

    params = {
        "client_id":     MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri":  MS_REDIRECT_URI,
        "scope":         MS_SCOPE,
        "response_mode": "query",
        "prompt":        "select_account",
    }
    tenant = MS_TENANT_ID or "common"
    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"
    print(f"[Email] Auth URL: {url}")
    return {"url": url}


@router.get("/callback")
async def oauth_callback(code: str = "", error: str = "", error_description: str = ""):
    """OAuth callback — exchange code for token, save to file, redirect to frontend."""
    if error:
        return RedirectResponse(
            f"http://localhost:3000/jd-inbox?error={error}&error_description={error_description}"
        )

    if not code:
        raise HTTPException(400, "No authorization code received.")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{MS_TENANT_ID or 'common'}/oauth2/v2.0/token",
            data={
                "grant_type":    "authorization_code",
                "client_id":     MS_CLIENT_ID,
                "client_secret": MS_CLIENT_SECRET,
                "code":          code,
                "redirect_uri":  MS_REDIRECT_URI,
                "scope":         MS_SCOPE,
            },
            timeout=20,
        )
        if resp.status_code != 200:
            detail = resp.json().get("error_description", resp.text)
            raise HTTPException(400, f"Token exchange failed: {detail}")

        data = resp.json()

    now = datetime.now(timezone.utc).timestamp()
    token_data = {
        "access_token":  data["access_token"],
        "refresh_token": data.get("refresh_token", ""),
        "expires_at":    now + data.get("expires_in", 3600),
    }
    _write_token_file(token_data)
    print("[Email] OAuth complete — token saved.")
    return RedirectResponse("http://localhost:3000/jd-inbox?connected=true")


@router.get("/status")
async def connection_status():
    """Check if an Outlook account is connected."""
    token_data = _read_token_file()
    if not token_data:
        return {"connected": False}
    if _is_token_expired(token_data) and not token_data.get("refresh_token"):
        return {"connected": False}
    return {"connected": True}


@router.post("/disconnect")
async def disconnect():
    """Remove saved token — disconnects Outlook."""
    import os as _os
    try:
        _os.remove(TOKEN_FILE)
    except FileNotFoundError:
        pass
    return {"disconnected": True}


# ── Email Sync ────────────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_emails():
    """
    Fetch emails from Outlook that look like job descriptions, extract JD content
    with AI, and upsert into the jd_emails table.
    """
    access_token = await get_valid_token()
    supabase = get_supabase()

    headers = {"Authorization": f"Bearer {access_token}"}

    # Fetch recent emails — Graph API doesn't support contains() in $filter for messages
    # AI will determine which ones are actual job descriptions during processing
    params = {
        "$select":  "id,subject,from,receivedDateTime,body,hasAttachments",
        "$top":     "50",
        "$orderby": "receivedDateTime desc",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{GRAPH_BASE}/me/messages", headers=headers, params=params)
        if resp.status_code == 401:
            raise HTTPException(401, "Access token expired. Please reconnect Outlook.")
        resp.raise_for_status()
        messages = resp.json().get("value", [])

    print(f"[Email Sync] Fetched {len(messages)} candidate messages from Graph API")

    synced = 0
    semaphore = asyncio.Semaphore(3)  # limit concurrent AI calls

    async def process_message(msg: dict):
        nonlocal synced
        try:
            await _process_one(msg)
        except Exception as e:
            print(f"[Email Sync] Unhandled error for msg {msg.get('id','?')}: {e}")

    async def _process_one(msg: dict):
        nonlocal synced

        email_id = msg["id"]
        subject  = msg.get("subject", "")
        sender   = msg.get("from", {}).get("emailAddress", {}).get("address", "")
        received = msg.get("receivedDateTime")

        # Extract body text
        body_content = msg.get("body", {})
        body_html = body_content.get("content", "")
        body_type = body_content.get("contentType", "text")
        body_text = _strip_html(body_html) if body_type == "html" else body_html

        # Check for attachments
        attachment_name = None
        attachment_text = None

        if msg.get("hasAttachments"):
            async with httpx.AsyncClient(timeout=20) as att_client:
                att_resp = await att_client.get(
                    f"{GRAPH_BASE}/me/messages/{email_id}/attachments",
                    headers=headers,
                )
                if att_resp.status_code == 200:
                    attachments = att_resp.json().get("value", [])
                    for att in attachments:
                        name = att.get("name", "")
                        cb64 = att.get("contentBytes", "")
                        if not cb64:
                            continue
                        # Only process document-type attachments
                        if name.lower().endswith((".txt", ".docx", ".pdf")):
                            text = _extract_attachment_text(name, cb64)
                            if text and len(text) > 100:
                                attachment_name = name
                                attachment_text = text
                                break  # Use the first valid attachment

        # Combine body + attachment for AI analysis
        raw_text = body_text
        if attachment_text:
            raw_text = f"{attachment_text}\n\n---\n\n{body_text}"

        if not raw_text or len(raw_text.strip()) < 50:
            return  # Skip near-empty messages

        # Quick keyword pre-filter — skip emails that don't look like JDs at all
        JD_KEYWORDS = [
            "job", "position", "role", "hiring", "requirement", "opening",
            "jd", "description", "skills", "experience", "candidate",
            "vacancy", "opportunity", "consultant", "contract", "c2c", "w2",
        ]
        combined_check = (subject + " " + raw_text[:500]).lower()
        if not any(kw in combined_check for kw in JD_KEYWORDS):
            print(f"[Email Sync] Skipping non-JD email: {subject[:60]}")
            return

        async with semaphore:
            extracted = await _gemini.extract_jd_info(raw_text)

        record = {
            "email_id":        email_id,
            "subject":         subject,
            "sender":          sender,
            "received_at":     received,
            "body_text":       body_text[:5000],
            "attachment_name": attachment_name,
            "jd_text":         extracted.get("jd_text", raw_text)[:8000],
            "ai_title":        extracted.get("title"),
            "ai_company":      extracted.get("company"),
            "ai_skills":       extracted.get("skills", []),
        }

        try:
            supabase.table("jd_emails").upsert(record, on_conflict="email_id").execute()
            synced += 1
        except Exception as e:
            print(f"[Email Sync] DB upsert error for {email_id}: {e}")

    await asyncio.gather(*[process_message(m) for m in messages])

    return {"synced": synced, "total": len(messages)}


# ── JD List & Match ───────────────────────────────────────────────────────────

@router.get("/jds")
async def list_jds():
    """List all ingested JDs ordered by received date."""
    supabase = get_supabase()
    result = supabase.table("jd_emails") \
        .select("id, email_id, subject, sender, received_at, ai_title, ai_company, ai_skills, created_at") \
        .order("received_at", desc=True) \
        .execute()
    return result.data or []


@router.get("/jds/{jd_id}")
async def get_jd(jd_id: str):
    """Get full JD detail including extracted text."""
    supabase = get_supabase()
    result = supabase.table("jd_emails") \
        .select("*") \
        .eq("id", jd_id) \
        .single() \
        .execute()
    if not result.data:
        raise HTTPException(404, "JD not found")
    return result.data


@router.post("/jds/{jd_id}/match")
async def match_candidates_to_jd(jd_id: str):
    """
    Match all bench candidates against a JD using Gemini.
    Returns ranked list of candidates with match scores.
    """
    supabase = get_supabase()

    # Fetch the JD
    jd_result = supabase.table("jd_emails") \
        .select("*").eq("id", jd_id).single().execute()
    if not jd_result.data:
        raise HTTPException(404, "JD not found")
    jd = jd_result.data
    jd_text = jd.get("jd_text") or jd.get("body_text") or ""

    if not jd_text.strip():
        raise HTTPException(400, "JD has no extractable text to match against.")

    # Fetch all candidates (limit 50)
    resumes_result = supabase.table("resumes") \
        .select("id, candidate_name, primary_role, primary_skills, secondary_skills, experience_years, ai_summary") \
        .order("created_at", desc=True) \
        .limit(50) \
        .execute()
    candidates = resumes_result.data or []

    if not candidates:
        return {"matches": [], "jd_id": jd_id, "total_candidates": 0}

    matches = await _gemini.match_candidates_to_jd(jd_text, candidates)

    return {
        "jd_id":             jd_id,
        "jd_title":          jd.get("ai_title"),
        "jd_company":        jd.get("ai_company"),
        "total_candidates":  len(candidates),
        "matches":           matches,
    }
