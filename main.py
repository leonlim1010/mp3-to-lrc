import os
import re
import glob
import shutil
import tempfile
import uuid
import time
import threading
import base64
import json
import subprocess
import urllib.parse
import urllib.request
import difflib
import unicodedata
import math
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, Response
import cloud_store

# mutagen – ID3 tag read/write
try:
    from mutagen.mp3 import MP3
    from mutagen.id3 import (
        ID3, ID3NoHeaderError,
        TIT2, TPE1, TALB, TDRC, TCON, APIC
    )
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    print("WARNING: mutagen not installed. Tag endpoints will be unavailable.")

# ---------------------------------------------------------------------------
# In-memory temp audio store: token -> {path, created_at}
# ---------------------------------------------------------------------------
_audio_tokens: dict = {}
_token_lock = threading.Lock()
TEMP_AUDIO_TTL = 7200  # 2 hours in seconds


def _cleanup_old_tokens():
    """Remove temp audio files older than TEMP_AUDIO_TTL."""
    now = time.time()
    with _token_lock:
        expired = [t for t, v in _audio_tokens.items() if now - v["created_at"] > TEMP_AUDIO_TTL]
        for t in expired:
            try:
                os.remove(_audio_tokens[t]["path"])
            except OSError:
                pass
            del _audio_tokens[t]


@asynccontextmanager
async def lifespan(app_: FastAPI):
    yield
    # On shutdown — clean up all temp audio files
    with _token_lock:
        for v in _audio_tokens.values():
            try:
                os.remove(v["path"])
            except OSError:
                pass
        _audio_tokens.clear()


app = FastAPI(lifespan=lifespan)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# Mount static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ---------------------------------------------------------------------------
# Dynamic Environment Setup (Local PC vs Cloud)
# ---------------------------------------------------------------------------
IS_CLOUD = bool(os.environ.get("RENDER") or os.environ.get("IS_CLOUD"))

if IS_CLOUD:
    MUSIC_DIR = Path(tempfile.gettempdir()) / "music_lrc"
    print(f"Running in CLOUD mode. Using Groq API for transcription. Output: {MUSIC_DIR}")
else:
    MUSIC_DIR = Path(r"C:\Users\User\Music")
    print(f"Running in LOCAL mode. Using local Whisper. Music directory: {MUSIC_DIR}")

MUSIC_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# FFmpeg helper
# ---------------------------------------------------------------------------
def setup_ffmpeg():
    if shutil.which("ffmpeg"):
        return
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return
    search_pattern = os.path.join(
        local_app_data, "Microsoft", "WinGet", "Packages", "*", "*", "bin", "ffmpeg.exe"
    )
    matches = glob.glob(search_pattern)
    if matches:
        ffmpeg_path = os.path.dirname(matches[0])
        print(f"Found ffmpeg at {ffmpeg_path}, adding to PATH")
        os.environ["PATH"] += os.pathsep + ffmpeg_path

setup_ffmpeg()

# ---------------------------------------------------------------------------
# Local Whisper model — lazy loaded only in LOCAL mode
# ---------------------------------------------------------------------------
_model = None
_model_size = "small"


def get_local_model():
    global _model, _model_size
    if _model is None:
        try:
            import torch
            import whisper as _whisper
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"Loading Whisper model ({_model_size}) on {device}...")
            _model = _whisper.load_model(_model_size, device=device)
            print("Whisper model loaded successfully.")
        except Exception as e:
            print(f"ERROR loading Whisper model: {e}")
            raise HTTPException(status_code=500, detail=f"Could not load AI model: {str(e)}")
    return _model


def transcribe_audio(tmp_path: str) -> list:
    """
    Unified transcription dispatcher.
    - CLOUD: uses Groq Whisper API (zero RAM, free, fast, high quality)
    - LOCAL: uses local openai-whisper model
    Returns a list of segment dicts with 'start' and 'text' keys.
    """
    if IS_CLOUD:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail=(
                    "GROQ_API_KEY environment variable is not set. "
                    "Get a free key at console.groq.com and add it to Render Environment Variables."
                )
            )
        try:
            from groq import Groq
            client = Groq(api_key=api_key)
            print("Sending audio to Groq Whisper API...")
            with open(tmp_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    file=(os.path.basename(tmp_path), audio_file),
                    model="whisper-large-v3-turbo",
                    response_format="verbose_json",
                    timestamp_granularities=["segment"]
                )
            if isinstance(transcription, dict):
                segments = transcription.get("segments", [])
            else:
                segments = getattr(transcription, "segments", None) or []
            print(f"Groq transcription complete. Got {len(segments)} segments.")

            def _get_val(obj, key):
                if isinstance(obj, dict):
                    return obj.get(key)
                return getattr(obj, key, None)

            parsed_segments = []
            for s in segments:
                start_val = _get_val(s, "start")
                text_val = _get_val(s, "text")
                if start_val is not None:
                    parsed_segments.append({
                        "start": float(start_val),
                        "text": str(text_val or "").strip()
                    })

            return parsed_segments
        except HTTPException:
            raise
        except Exception as e:
            print(f"Groq API error: {e}")
            raise HTTPException(status_code=500, detail=f"Groq transcription failed: {str(e)}")
    else:
        model = get_local_model()
        is_cuda = getattr(model, "device", None) and getattr(model.device, "type", "") == "cuda"
        result = model.transcribe(tmp_path, word_timestamps=False, fp16=is_cuda)
        return result.get("segments", [])


# ---------------------------------------------------------------------------
# LRC helpers
# ---------------------------------------------------------------------------
def seconds_to_lrc_timestamp(seconds: float) -> str:
    """Convert float seconds → [mm:ss.xx] LRC timestamp."""
    minutes = int(seconds // 60)
    secs = seconds % 60
    centiseconds = int((secs % 1) * 100)
    return f"[{minutes:02d}:{int(secs):02d}.{centiseconds:02d}]"


def lrc_timestamp_to_seconds(ts: str) -> float:
    """Parse [mm:ss.xx] → float seconds."""
    m = re.match(r"\[(\d+):(\d+)\.(\d+)\]", ts)
    if not m:
        return 0.0
    minutes, secs, cs = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return minutes * 60 + secs + cs / 100


def segments_to_lrc(segments: list) -> str:
    """Convert Whisper segments list to LRC file content string."""
    lines = []
    for seg in segments:
        ts = seconds_to_lrc_timestamp(seg["start"])
        text = seg["text"].strip()
        if text:
            lines.append(f"{ts} {text}")
    return "\n".join(lines)


def parse_lrc(content: str) -> list:
    """
    Parse LRC content into a list of {timestamp_str, text} dicts.
    Supports both common layouts:
      [00:12.34] lyric text
      [00:12.34]
      lyric text
    """
    result = []
    pending_index = None
    for raw_line in content.splitlines():
        line = raw_line.strip()
        m = re.match(r"(\[\d+:\d+\.\d+\])(.*)", line)
        if m:
            result.append({
                "timestamp_str": m.group(1),
                "text": m.group(2).strip()
            })
            pending_index = len(result) - 1 if not m.group(2).strip() else None
        elif line and pending_index is not None:
            # Some LRC exporters put the lyric on the line immediately after
            # its timestamp. Attach it to that timestamp instead of discarding it.
            result[pending_index]["text"] = line
            pending_index = None
    return result


def _alignment_tokens(text: str) -> list:
    """Return comparable lyric tokens with their positions in the source text."""
    pattern = re.compile(r"[^\W_]+", re.UNICODE)
    tokens = []
    for match in pattern.finditer(text):
        raw = match.group(0)
        value = unicodedata.normalize("NFKC", raw).casefold()
        # Lyrics in Korean/CJK often contain one-character ASR differences
        # inside an otherwise matching word. Character tokens retain those
        # partial anchors; Latin text remains word-tokenized.
        def is_east_asian(char):
            return (
                "\u3400" <= char <= "\u9fff" or  # CJK
                "\u3040" <= char <= "\u30ff" or  # Hiragana/Katakana
                "\uac00" <= char <= "\ud7af"     # Hangul syllables
            )
        if any(is_east_asian(ch) for ch in value):
            for index, char in enumerate(raw):
                if char.isalnum() or is_east_asian(char):
                    tokens.append({"key": unicodedata.normalize("NFKC", char).casefold(),
                                   "start": match.start() + index, "end": match.start() + index + 1})
        else:
            tokens.append({"key": value, "start": match.start(), "end": match.end()})
    return tokens


def _map_token_boundaries(original_keys: list, reference_keys: list) -> list:
    """Map original token boundaries onto the reference while preserving order."""
    matcher = difflib.SequenceMatcher(None, original_keys, reference_keys, autojunk=False)
    mapped = [None] * (len(original_keys) + 1)
    for _tag, i1, i2, j1, j2 in matcher.get_opcodes():
        width = i2 - i1
        if width == 0:
            continue
        for offset in range(width + 1):
            mapped[i1 + offset] = round(j1 + (j2 - j1) * offset / width)
    mapped[0] = 0
    mapped[-1] = len(reference_keys)
    last = 0
    for index, value in enumerate(mapped):
        value = last if value is None else max(last, min(len(reference_keys), value))
        mapped[index] = value
        last = value
    return mapped


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.head("/health")
@app.get("/health")
async def health_check():
    return {"status": "ok", "mode": "cloud" if IS_CLOUD else "local",
            "accounts": cloud_store.ENABLED}


@app.get("/api/config")
async def public_config():
    """Browser-safe configuration; never expose server-side secrets here."""
    return {
        "cloud": IS_CLOUD,
        "accounts_enabled": cloud_store.ENABLED,
        "supabase_url": cloud_store.SUPABASE_URL if cloud_store.ENABLED else "",
        "supabase_key": cloud_store.SUPABASE_KEY if cloud_store.ENABLED else "",
        "limits": {
            "guest": {"daily": 3, "max_minutes": 10, "retention_days": 7},
            "registered": {"daily": 10, "max_minutes": 15, "retention_days": None},
            "max_file_mb": 25,
        },
    }


@app.get("/api/usage")
async def usage_status(request: Request):
    """Private per-user quota plus rounded, non-identifying service estimates."""
    if not (IS_CLOUD and cloud_store.ENABLED):
        raise HTTPException(status_code=503, detail="Usage tracking is available in cloud mode.")
    who = cloud_store.identity(request)
    usage = cloud_store.usage_status(who)
    hourly_limit = max(1, int(os.environ.get("GROQ_AUDIO_HOURLY_LIMIT", "7200")))
    daily_limit = max(1, int(os.environ.get("GROQ_AUDIO_DAILY_LIMIT", "28800")))
    hourly_percent = min(100, round(100 * usage.pop("shared_hour_seconds", 0) / hourly_limit))
    daily_percent = min(100, round(100 * usage.pop("shared_day_seconds", 0) / daily_limit))
    highest = max(hourly_percent, daily_percent)
    usage["shared_service"] = {
        "status": "Limit reached" if highest >= 100 else "Busy" if highest >= 85 else "Available",
        "hourly_percent": hourly_percent,
        "daily_percent": daily_percent,
        "estimated": True,
    }
    usage["account_type"] = "guest" if who.is_anonymous else "registered"
    usage["updated_at"] = datetime.now(timezone.utc).isoformat()
    return usage


@app.head("/")
@app.get("/")
async def read_index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail=f"index.html not found at {index_file}")
    return FileResponse(index_file)


@app.post("/transcribe")
async def transcribe(request: Request, audio_file: UploadFile = File(...)):
    """
    Transcribe a single MP3 file with Whisper.
    Saves the resulting LRC to MUSIC_DIR/<stem>.lrc
    Returns {filename, lrc_path, lines_count}.
    """
    if not audio_file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files are supported.")

    who = cloud_store.identity(request) if IS_CLOUD and cloud_store.ENABLED else None
    stem = Path(audio_file.filename).stem
    lrc_filename = f"{stem}.lrc"
    lrc_path = MUSIC_DIR / lrc_filename

    tmp_path = None
    try:
        # Save upload to a temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            shutil.copyfileobj(audio_file.file, tmp)
            tmp_path = tmp.name

        if IS_CLOUD and os.path.getsize(tmp_path) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="MP3 exceeds the 25 MB upload limit.")

        usage = None
        if who:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", tmp_path],
                capture_output=True, text=True, timeout=20,
            )
            if probe.returncode != 0:
                raise HTTPException(status_code=400, detail="Could not read the MP3 duration.")
            duration = max(1, math.ceil(float(probe.stdout.strip())))
            client_ip = request.client.host if request.client else "unknown"
            salt = os.environ.get("RATE_LIMIT_SALT", cloud_store.SUPABASE_URL)
            request_key = hashlib.sha256(f"{salt}:{client_ip}".encode()).hexdigest()
            usage = cloud_store.reserve_transcription(who, duration, request_key)

        print(f"Transcribing: {audio_file.filename}")
        segments = transcribe_audio(tmp_path)
        print(f"Got {len(segments)} segments.")

        lrc_content = segments_to_lrc(segments)

        record = None
        if who:
            record = cloud_store.save_lrc(who, lrc_filename, lrc_content)
            print(f"Saved private LRC record: {record['id']}")
        else:
            lrc_path.write_text(lrc_content, encoding="utf-8")
            print(f"Saved: {lrc_path}")

        return JSONResponse(content={
            "filename": lrc_filename,
            "id": record.get("id") if record else None,
            "lines_count": len(segments),
            "usage": usage,
        })

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/list_lrc")
async def list_lrc(request: Request):
    """
    Return filenames of all .lrc files in the Music folder
    that do NOT have '_modified' in their name.
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        records = cloud_store.list_lrc(who, "original")
        return JSONResponse(content={"records": records, "files": [r["filename"] for r in records]})
    files = [
        f.name for f in MUSIC_DIR.glob("*.lrc")
        if "_modified" not in f.name
    ]
    files.sort()
    return JSONResponse(content={"files": files})


@app.get("/get_lrc/{filename}")
async def get_lrc(filename: str, request: Request):
    """
    Return parsed lines ({timestamp_str, text}) for a given LRC filename.
    Only allows files without '_modified' in the name.
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        record = cloud_store.get_lrc(who, filename)
        return JSONResponse(content={"id": record["id"], "filename": record["filename"],
                                     "lines": parse_lrc(record["lrc_content"])})
    if "_modified" in filename:
        raise HTTPException(status_code=400, detail="Cannot load a _modified file.")
    lrc_path = MUSIC_DIR / filename
    if not lrc_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    content = lrc_path.read_text(encoding="utf-8")
    lines = parse_lrc(content)
    return JSONResponse(content={"filename": filename, "lines": lines})


@app.get("/api/lrc/{record_id}/download")
async def download_private_lrc(record_id: str, request: Request):
    who = cloud_store.identity(request)
    record = cloud_store.get_lrc(who, record_id)
    safe_name = Path(record["filename"]).name.replace('"', "")
    return Response(
        record["lrc_content"], media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@app.delete("/api/lrc/{record_id}")
async def delete_private_lrc(record_id: str, request: Request):
    who = cloud_store.identity(request)
    cloud_store.delete_lrc(who, record_id)
    return Response(status_code=204)


@app.post("/save_modified")
async def save_modified(
    request: Request,
    filename: str = Form(...),
    corrected_lyrics: str = Form(...)
):
    """
    Merge correct lyrics (one line per \n) with timestamps from the original
    LRC file, save as <stem>_modified.lrc, then delete the original.
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        record = cloud_store.get_lrc(who, filename)
        original_lines = parse_lrc(record["lrc_content"])
        correct_lines = [line.strip() for line in corrected_lyrics.split("\n")]
        if len(correct_lines) != len(original_lines):
            raise HTTPException(status_code=400, detail="Line count mismatch.")
        modified_content = "\n".join(
            f"{original['timestamp_str']} {text}"
            for original, text in zip(original_lines, correct_lines)
        )
        modified_name = f"{Path(record['filename']).stem}_modified.lrc"
        updated = cloud_store.update_lrc(
            who, record["id"], {"filename": modified_name,
                                "lrc_content": modified_content, "status": "modified"},
        )
        return JSONResponse(content={"saved_as": updated["filename"], "id": updated["id"]})
    lrc_path = MUSIC_DIR / filename
    if not lrc_path.exists():
        raise HTTPException(status_code=404, detail="Original file not found.")

    # Parse original timestamps
    original_content = lrc_path.read_text(encoding="utf-8")
    original_lines = parse_lrc(original_content)

    # Split user's corrected lyrics
    correct_lines = [l.strip() for l in corrected_lyrics.split("\n")]

    if len(correct_lines) != len(original_lines):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Line count mismatch: LRC has {len(original_lines)} lines, "
                f"but you provided {len(correct_lines)} lines."
            )
        )

    # Build modified LRC
    lrc_lines = [
        f"{orig['timestamp_str']} {new_text}"
        for orig, new_text in zip(original_lines, correct_lines)
    ]
    modified_content = "\n".join(lrc_lines)

    # Save as _modified
    stem = Path(filename).stem
    modified_filename = f"{stem}_modified.lrc"
    modified_path = MUSIC_DIR / modified_filename
    modified_path.write_text(modified_content, encoding="utf-8")

    # Delete original
    lrc_path.unlink()
    print(f"Saved {modified_path}, deleted {lrc_path}")

    return JSONResponse(content={"saved_as": modified_filename})


@app.post("/align_lyrics")
async def align_lyrics(request: Request, filename: str = Form(...), reference_lyrics: str = Form(...)):
    """Return a reviewable alignment proposal without writing or changing timestamps."""
    private_record = IS_CLOUD and cloud_store.ENABLED
    if private_record:
        who = cloud_store.identity(request)
        record = cloud_store.get_lrc(who, filename)
        original_content = record["lrc_content"]
    else:
        original_content = None
    safe_name = Path(filename).name
    if not private_record and (not safe_name.lower().endswith(".lrc") or "_modified" in safe_name):
        raise HTTPException(status_code=400, detail="Select an original .lrc file.")
    lrc_path = MUSIC_DIR / safe_name
    if not private_record:
        if not lrc_path.exists():
            raise HTTPException(status_code=404, detail="LRC file not found.")
        original_content = lrc_path.read_text(encoding="utf-8")
    reference_lyrics = reference_lyrics.strip()
    if not reference_lyrics:
        raise HTTPException(status_code=400, detail="Paste the completed lyrics first.")

    original_lines = parse_lrc(original_content)
    original_tokens = _alignment_tokens("\n".join(line["text"] for line in original_lines))
    reference_tokens = _alignment_tokens(reference_lyrics)
    if not original_lines or not original_tokens or not reference_tokens:
        raise HTTPException(status_code=400, detail="Not enough lyric text to align.")

    counts, running = [0], 0
    for line in original_lines:
        running += len(_alignment_tokens(line["text"]))
        counts.append(running)
    boundary_map = _map_token_boundaries(
        [token["key"] for token in original_tokens],
        [token["key"] for token in reference_tokens],
    )
    boundaries = [boundary_map[min(count, len(original_tokens))] for count in counts]

    proposal = []
    for index, line in enumerate(original_lines):
        start_token, end_token = boundaries[index], boundaries[index + 1]
        if start_token >= len(reference_tokens) or end_token <= start_token:
            # Never erase a timestamp row when the reference has no confident
            # span for it. Keep the transcription and flag it for review.
            proposed = line["text"]
            forced_low_confidence = True
        else:
            start_char = reference_tokens[start_token]["start"]
            # Include punctuation following the last matched word, but not the
            # next word. Whitespace is normalized below.
            end_char = (reference_tokens[end_token]["start"]
                        if end_token < len(reference_tokens) else len(reference_lyrics))
            proposed = re.sub(r"\s+", " ", reference_lyrics[start_char:end_char]).strip()
            forced_low_confidence = False
        left = " ".join(t["key"] for t in _alignment_tokens(line["text"]))
        right = " ".join(t["key"] for t in _alignment_tokens(proposed))
        confidence = (0 if forced_low_confidence else round(
            difflib.SequenceMatcher(None, left, right, autojunk=False).ratio() * 100
        ))
        proposal.append({
            "timestamp_str": line["timestamp_str"], "original": line["text"],
            "proposed": proposed, "confidence": confidence,
        })

    overall = round(difflib.SequenceMatcher(
        None, [t["key"] for t in original_tokens], [t["key"] for t in reference_tokens],
        autojunk=False,
    ).ratio() * 100)
    return JSONResponse(content={"lines": proposal, "overall_confidence": overall})


# ---------------------------------------------------------------------------
# Sync Tester endpoints
# ---------------------------------------------------------------------------

@app.get("/list_modified_lrc")
async def list_modified_lrc(request: Request):
    """
    Return sorted filenames of all *_modified.lrc files in the Music folder.
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        records = cloud_store.list_lrc(who, "modified")
        return JSONResponse(content={"records": records, "files": [r["filename"] for r in records]})
    files = [
        f.name for f in MUSIC_DIR.glob("*.lrc")
        if "_modified" in f.name
    ]
    files.sort()
    return JSONResponse(content={"files": files})

@app.get("/list_mp3")
async def list_mp3():
    """
    Return sorted filenames of all .mp3 files in the Music folder.
    """
    files = [
        f.name for f in MUSIC_DIR.glob("*.mp3")
    ]
    files.sort()
    return JSONResponse(content={"files": files})


@app.get("/get_modified_lrc/{filename}")
async def get_modified_lrc(filename: str, request: Request):
    """
    Return parsed lines for a *_modified.lrc file.
    Each line: {timestamp_str, seconds, text}
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        record = cloud_store.get_lrc(who, filename)
        parsed = parse_lrc(record["lrc_content"])
        for line in parsed:
            line["seconds"] = lrc_timestamp_to_seconds(line["timestamp_str"])
        return JSONResponse(content={"id": record["id"], "filename": record["filename"], "lines": parsed})
    if "_modified" not in filename:
        raise HTTPException(status_code=400, detail="Only _modified files allowed.")
    lrc_path = MUSIC_DIR / filename
    if not lrc_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    content = lrc_path.read_text(encoding="utf-8")
    parsed = parse_lrc(content)
    # Augment each line with its float seconds value
    for line in parsed:
        line["seconds"] = lrc_timestamp_to_seconds(line["timestamp_str"])
    return JSONResponse(content={"filename": filename, "lines": parsed})


@app.post("/upload_audio")
async def upload_audio(audio_file: UploadFile = File(...)):
    """
    Accept an MP3 upload for the Sync Tester.
    Saves it to a temp file, returns a token used to stream it back.
    """
    if not audio_file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files are supported.")

    _cleanup_old_tokens()

    token = str(uuid.uuid4())
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
        shutil.copyfileobj(audio_file.file, tmp)
        tmp_path = tmp.name

    with _token_lock:
        _audio_tokens[token] = {"path": tmp_path, "created_at": time.time()}

    print(f"Audio token {token} -> {tmp_path}")
    return JSONResponse(content={"token": token})


@app.get("/stream_audio/{token}")
async def stream_audio(token: str, request: Request):
    """
    Stream a temp MP3 by token with HTTP Range support so the
    HTML5 <audio> element can seek anywhere in the file.
    """
    with _token_lock:
        entry = _audio_tokens.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail="Audio token not found or expired.")

    file_path = Path(entry["path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Temp audio file missing.")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    chunk_size = 1024 * 256  # 256 KB chunks

    if range_header:
        # Parse "bytes=start-end"
        range_val = range_header.strip().replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_range():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    data = f.read(min(chunk_size, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type="audio/mpeg",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )
    else:
        def iter_full():
            with open(file_path, "rb") as f:
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    yield data

        return StreamingResponse(
            iter_full(),
            status_code=200,
            media_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )

@app.get("/stream_local_audio/{filename}")
async def stream_local_audio(filename: str, request: Request):
    """
    Stream a local MP3 file from the Music directory.
    """
    if not filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files are allowed.")
        
    # Prevent directory traversal
    safe_name = Path(filename).name
    file_path = MUSIC_DIR / safe_name
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="MP3 file not found.")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    chunk_size = 1024 * 256  # 256 KB chunks

    if range_header:
        # Parse "bytes=start-end"
        range_val = range_header.strip().replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_range():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    data = f.read(min(chunk_size, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type="audio/mpeg",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )
    else:
        def iter_full():
            with open(file_path, "rb") as f:
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    yield data

        return StreamingResponse(
            iter_full(),
            status_code=200,
            media_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )


@app.post("/save_lrc")
async def save_lrc(
    request: Request,
    filename: str = Form(...),
    lrc_content: str = Form(...),
):
    """
    Overwrite any .lrc file in the Music folder with new content.
    Accepts both *_modified.lrc files (from the dropdown) and custom
    uploaded LRC files (any .lrc filename).
    Returns {saved_as, lines_count}.
    """
    if IS_CLOUD and cloud_store.ENABLED:
        who = cloud_store.identity(request)
        try:
            record = cloud_store.get_lrc(who, filename)
        except HTTPException as exc:
            if exc.status_code not in (400, 404):
                raise
            record = None
        if record:
            safe_name = record["filename"].replace("_modified.lrc", ".lrc")
            updated = cloud_store.update_lrc(
                who, record["id"], {"filename": safe_name,
                                    "lrc_content": lrc_content, "status": "original"},
            )
        else:
            safe_name = Path(filename).name
            if not safe_name.lower().endswith(".lrc"):
                raise HTTPException(status_code=400, detail="Only .lrc files are allowed.")
            updated = cloud_store.save_lrc(who, safe_name, lrc_content, "original")
        lines_count = len([line for line in lrc_content.splitlines()
                           if line.strip().startswith("[")])
        return JSONResponse(content={"saved_as": updated["filename"],
                                     "id": updated["id"], "lines_count": lines_count})
    # Safety: only allow .lrc extension, no path traversal
    if not filename.lower().endswith(".lrc"):
        raise HTTPException(status_code=400, detail="Only .lrc files are allowed.")
    safe_name = Path(filename).name  # strip any directory component
    
    # If the user is saving a file that has "_modified" in the name,
    # save it without "_modified" and remove the old one.
    is_modified_file = False
    original_file_path = MUSIC_DIR / safe_name

    if safe_name.endswith("_modified.lrc"):
        is_modified_file = True
        safe_name = safe_name.replace("_modified.lrc", ".lrc")
        
    save_path = MUSIC_DIR / safe_name

    try:
        save_path.write_text(lrc_content, encoding="utf-8")
        
        # Clean up the old _modified.lrc file so it doesn't clutter the directory
        if is_modified_file and original_file_path.exists() and original_file_path != save_path:
            try:
                original_file_path.unlink()
                print(f"Deleted old modified file: {original_file_path}")
            except OSError:
                pass

        lines_count = len([l for l in lrc_content.splitlines() if l.strip().startswith("[")])
        print(f"Saved (overwrite): {save_path}  ({lines_count} lines)")
        return JSONResponse(content={"saved_as": safe_name, "lines_count": lines_count})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Tag Manager helpers
# ---------------------------------------------------------------------------

def _read_tags(file_path: Path) -> dict:
    """Read ID3 tags from an MP3 file. Returns a dict with title/artist/album/year/genre/has_cover."""
    tags = {"title": "", "artist": "", "album": "", "year": "", "genre": "", "has_cover": False}
    if not MUTAGEN_AVAILABLE:
        return tags
    try:
        audio = ID3(str(file_path))
        tags["title"]  = str(audio.get("TIT2", "")).strip()
        tags["artist"] = str(audio.get("TPE1", "")).strip()
        tags["album"]  = str(audio.get("TALB", "")).strip()
        tags["year"]   = str(audio.get("TDRC", "")).strip()
        tags["genre"]  = str(audio.get("TCON", "")).strip()
        tags["has_cover"] = any(k.startswith("APIC") for k in audio.keys())
    except ID3NoHeaderError:
        pass  # File has no ID3 header — return empty tags
    except Exception:
        pass
    return tags


def _get_cover_b64(file_path: Path) -> str:
    """Return the first APIC frame as a base64 data-URL, or empty string."""
    if not MUTAGEN_AVAILABLE:
        return ""
    try:
        audio = ID3(str(file_path))
        for key in audio.keys():
            if key.startswith("APIC"):
                apic = audio[key]
                mime = apic.mime or "image/jpeg"
                data_b64 = base64.b64encode(apic.data).decode("utf-8")
                return f"data:{mime};base64,{data_b64}"
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# Tag Manager endpoints
# ---------------------------------------------------------------------------

@app.get("/list_all_mp3")
async def list_all_mp3():
    """
    Return all .mp3 files in Music dir with their basic ID3 tags.
    Response: { files: [{filename, title, artist, album}] }
    """
    results = []
    for f in sorted(MUSIC_DIR.glob("*.mp3")):
        tags = _read_tags(f)
        results.append({
            "filename": f.name,
            "title":    tags["title"],
            "artist":   tags["artist"],
            "album":    tags["album"],
        })
    return JSONResponse(content={"files": results})


@app.get("/get_tags/{filename}")
async def get_tags(filename: str):
    """Return full ID3 tags + base64 cover art for a single MP3."""
    safe_name = Path(filename).name
    if not safe_name.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files allowed.")
    file_path = MUSIC_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")

    tags = _read_tags(file_path)
    cover = _get_cover_b64(file_path)
    return JSONResponse(content={
        "filename": safe_name,
        **tags,
        "cover_data": cover,
    })


@app.post("/update_tags")
async def update_tags(
    filename:   str = Form(...),
    title:      str = Form(""),
    artist:     str = Form(""),
    album:      str = Form(""),
    year:       str = Form(""),
    genre:      str = Form(""),
    cover_data: Optional[str] = Form(None),   # optional base64 data-URL
):
    """
    Write ID3 tags back to an MP3 in the Music folder.
    cover_data is a base64 data-URL (data:image/...;base64,...), or "" to clear.
    """
    if not MUTAGEN_AVAILABLE:
        raise HTTPException(status_code=500, detail="mutagen not installed.")
    safe_name = Path(filename).name
    if not safe_name.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files allowed.")
    file_path = MUSIC_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")

    try:
        from mutagen.mp3 import MP3
        from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, TDRC, TCON, APIC
        
        audio_file = MP3(str(file_path))
        if audio_file.tags is None:
            audio_file.add_tags()
        audio = audio_file.tags
        
        # Clean out problematic tags imported by FFmpeg which crash Windows Explorer parsers
        bad_keys = [k for k in audio.keys() if k.startswith("TXXX") or k.startswith("TSSE")]
        for k in bad_keys:
            del audio[k]

        # Reverting to encoding=3 to perfectly match auto_tagger.py
        audio["TIT2"] = TIT2(encoding=3, text=title)
        audio["TPE1"] = TPE1(encoding=3, text=artist)
        audio["TPE2"] = TPE2(encoding=3, text=artist)  # Mirror to Album Artist
        audio["TALB"] = TALB(encoding=3, text=album)
        audio["TDRC"] = TDRC(encoding=3, text=year)
        audio["TCON"] = TCON(encoding=3, text=genre)

        if cover_data is not None:
            # Remove any existing cover art first
            apic_keys = [k for k in audio.keys() if k.startswith("APIC")]
            for k in apic_keys:
                del audio[k]
                
            if cover_data != "":
                # Strip data-URL prefix
                header, _, b64 = cover_data.partition(",")
                mime = "image/jpeg"
                if "image/png" in header:
                    mime = "image/png"
                elif "image/webp" in header:
                    mime = "image/webp"
                    
                import base64
                img_bytes = base64.b64decode(b64)
                audio.add(APIC(
                    encoding=3,   # UTF-8, specifically to match auto_tagger.py
                    mime=mime,
                    type=3,       # 3 = Cover (front)
                    desc="Cover",
                    data=img_bytes,
                ))

        # Save as ID3v2.3 instead of ID3v2.4 for Windows Explorer compatibility
        audio_file.save(v2_version=3)
        print(f"Tags updated: {safe_name}")
        return JSONResponse(content={"saved": safe_name})
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rename_mp3")
async def rename_mp3(
    filename: str = Form(...),
    new_name: str = Form(...),    # just the new basename (no path), e.g. "Artist - Title.mp3"
):
    """
    Rename an MP3 in the Music folder.
    Returns {old_name, new_name}.
    """
    old_safe = Path(filename).name
    new_safe = Path(new_name).name

    if not old_safe.lower().endswith(".mp3") or not new_safe.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files allowed.")

    old_path = MUSIC_DIR / old_safe
    new_path = MUSIC_DIR / new_safe

    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Source file not found.")
    if new_path.exists() and old_path != new_path:
        raise HTTPException(status_code=409, detail=f"A file named '{new_safe}' already exists.")

    old_path.rename(new_path)
    print(f"Renamed: {old_safe} → {new_safe}")
    return JSONResponse(content={"old_name": old_safe, "new_name": new_safe})


@app.get("/search_metadata")
async def search_metadata(q: str):
    """
    Search the iTunes Search API for track candidates matching the query.
    Returns up to 10 results: [{title, artist, album, year, artwork_url}]
    """
    if not q.strip():
        return JSONResponse(content={"results": []})
    try:
        encoded = urllib.parse.quote(q.strip())
        url = f"https://itunes.apple.com/search?term={encoded}&media=music&entity=song&limit=10"
        req = urllib.request.Request(url, headers={"User-Agent": "SoniScript/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw)

        results = []
        for item in data.get("results", []):
            year = ""
            release_date = item.get("releaseDate", "")
            if release_date and len(release_date) >= 4:
                year = release_date[:4]
            artwork = item.get("artworkUrl100", "")
            if artwork:
                # Get a slightly larger thumbnail (300×300)
                artwork = artwork.replace("100x100", "300x300")
            results.append({
                "title":       item.get("trackName", ""),
                "artist":      item.get("artistName", ""),
                "album":       item.get("collectionName", ""),
                "year":        year,
                "artwork_url": artwork,
            })
        return JSONResponse(content={"results": results})
    except Exception as e:
        print(f"search_metadata error: {e}")
        raise HTTPException(status_code=502, detail=f"Metadata search failed: {e}")


@app.post("/fetch_youtube_meta")
async def fetch_youtube_meta(url: str = Form(...)):
    """
    Use yt-dlp to extract metadata from a YouTube or Bilibili URL (no download).
    Returns {title, artist, album, channel, thumbnail}.
    """
    if not url.strip():
        raise HTTPException(status_code=400, detail="URL is required.")
    try:
        import sys
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--dump-json", "--no-playlist",
             "--no-warnings", url.strip()],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            stderr_lines = result.stderr.strip().splitlines()
            err = stderr_lines[-1] if stderr_lines else "yt-dlp returned an error"
            raise HTTPException(status_code=502, detail=err)

        # yt-dlp may output multiple JSON lines; take the last non-empty one
        json_lines = [l for l in result.stdout.splitlines() if l.strip()]
        if not json_lines:
            raise HTTPException(status_code=502, detail="yt-dlp returned no data.")
        info = json.loads(json_lines[-1])

        # YouTube uses 'track'/'artist'; Bilibili uses 'fulltitle'/'uploader'
        # Fall back through the chain so both sites work
        title     = (info.get("track")
                     or info.get("fulltitle")
                     or info.get("title", ""))
        artist    = (info.get("artist")
                     or info.get("creator")
                     or info.get("uploader", ""))
        album     = info.get("album", "")
        channel   = (info.get("channel")
                     or info.get("uploader", ""))
        thumbnail = info.get("thumbnail", "")
        # Extractor name so the frontend can show the source
        extractor = info.get("extractor_key", "")  # e.g. "Youtube", "BiliBili"

        return JSONResponse(content={
            "title":     title,
            "artist":    artist,
            "album":     album,
            "channel":   channel,
            "thumbnail": thumbnail,
            "extractor": extractor,
        })
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="yt-dlp timed out (>30 s). Check your URL.")
    except ModuleNotFoundError:
        raise HTTPException(status_code=500, detail="yt-dlp is not installed. Run: pip install yt-dlp")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Could not parse yt-dlp output: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
