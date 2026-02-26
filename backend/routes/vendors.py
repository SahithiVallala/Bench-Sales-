"""Vendor management routes"""
from typing import Optional, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from models.schemas import VendorCreate
from services.supabase_client import get_supabase

class VendorPatch(BaseModel):
    is_active: Optional[bool] = None
    tier: Optional[str] = None
    notes: Optional[str] = None

router = APIRouter(prefix="/api/vendors", tags=["vendors"])


@router.get("")
async def list_vendors():
    supabase = get_supabase()
    result = supabase.table("vendors").select("*") \
        .eq("is_active", True).order("company_name").execute()
    return result.data or []


@router.post("")
async def create_vendor(body: VendorCreate):
    supabase = get_supabase()
    result = supabase.table("vendors").insert(body.model_dump()).execute()
    if not result.data:
        raise HTTPException(500, "Failed to create vendor")
    return result.data[0]


@router.patch("/{vendor_id}")
async def patch_vendor(vendor_id: str, body: VendorPatch):
    supabase = get_supabase()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(400, "No fields to update")
    result = supabase.table("vendors") \
        .update(update_data).eq("id", vendor_id).execute()
    if not result.data:
        raise HTTPException(404, "Vendor not found")
    return result.data[0]


@router.put("/{vendor_id}")
async def update_vendor(vendor_id: str, body: VendorCreate):
    supabase = get_supabase()
    result = supabase.table("vendors") \
        .update(body.model_dump()).eq("id", vendor_id).execute()
    if not result.data:
        raise HTTPException(404, "Vendor not found")
    return result.data[0]


@router.get("/{vendor_id}/submissions")
async def vendor_submissions(vendor_id: str):
    supabase = get_supabase()
    result = supabase.table("submissions_detail") \
        .select("*").eq("vendor_id", vendor_id) \
        .order("created_at", desc=True).execute()
    return result.data or []
