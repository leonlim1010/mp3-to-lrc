"""Small Supabase REST client used by the cloud deployment.

All data requests are made with the caller's JWT so PostgreSQL RLS remains the
final authority. The service-role key is deliberately not used here.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from fastapi import HTTPException, Request


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)


@dataclass
class Identity:
    id: str
    email: str | None
    is_anonymous: bool
    token: str


def _request(path, token, method="GET", body=None, headers=None):
    if not ENABLED:
        raise HTTPException(status_code=503, detail="Account storage is not configured.")
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        **(headers or {}),
    }
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}", data=payload, method=method, headers=request_headers
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw).get("message") or json.loads(raw).get("msg")
        except (ValueError, AttributeError):
            detail = raw
        status = 401 if exc.code in (401, 403) else 429 if exc.code == 429 else 400
        raise HTTPException(status_code=status, detail=detail or "Supabase request failed.")
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"Account storage unavailable: {exc.reason}")


def identity(request: Request) -> Identity:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in or start a guest session first.")
    token = authorization.split(" ", 1)[1].strip()
    user = _request("/auth/v1/user", token)
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    return Identity(
        id=user["id"], email=user.get("email"),
        is_anonymous=bool(user.get("is_anonymous")), token=token,
    )


def reserve_transcription(who: Identity, duration_seconds: int, request_key: str):
    return _request(
        "/rest/v1/rpc/reserve_transcription", who.token, "POST",
        {"p_audio_seconds": duration_seconds, "p_request_key": request_key},
    )


def usage_status(who: Identity):
    return _request(
        "/rest/v1/rpc/get_usage_status", who.token, "POST", {}
    )


def save_lrc(who: Identity, filename: str, content: str, status="original"):
    rows = _request(
        "/rest/v1/lrc_files", who.token, "POST",
        {"user_id": who.id, "filename": filename, "lrc_content": content, "status": status},
        {"Prefer": "return=representation"},
    )
    return rows[0] if rows else None


def list_lrc(who: Identity, status=None):
    query = "?select=id,filename,status,created_at,updated_at&order=created_at.desc"
    if status:
        query += "&status=eq." + urllib.parse.quote(status)
    return _request("/rest/v1/lrc_files" + query, who.token) or []


def get_lrc(who: Identity, record_id: str):
    query = "?select=*&id=eq." + urllib.parse.quote(record_id) + "&limit=1"
    rows = _request("/rest/v1/lrc_files" + query, who.token) or []
    if not rows:
        raise HTTPException(status_code=404, detail="LRC file not found.")
    return rows[0]


def update_lrc(who: Identity, record_id: str, values: dict):
    rows = _request(
        "/rest/v1/lrc_files?id=eq." + urllib.parse.quote(record_id), who.token,
        "PATCH", values, {"Prefer": "return=representation"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="LRC file not found.")
    return rows[0]


def delete_lrc(who: Identity, record_id: str):
    _request(
        "/rest/v1/lrc_files?id=eq." + urllib.parse.quote(record_id), who.token,
        "DELETE", headers={"Prefer": "return=minimal"},
    )
