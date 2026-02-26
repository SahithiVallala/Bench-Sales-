"""
Supabase client — single instance used across all services
"""
import os
from supabase import create_client, Client, ClientOptions
from dotenv import load_dotenv

load_dotenv()

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        _client = create_client(url, key, options=ClientOptions(postgrest_client_timeout=10))
    return _client


def get_storage_bucket() -> str:
    return os.getenv("SUPABASE_STORAGE_BUCKET", "resumes")
