import os
import time
import json
import urllib.parse
import urllib.request
from pathlib import Path
from mutagen.id3 import ID3, ID3NoHeaderError, TIT2, TPE1, TPE2, TALB, TDRC, APIC

MUSIC_DIR = Path(r"C:\Users\User\Music")

def search_itunes(query: str):
    try:
        encoded = urllib.parse.quote(query.strip())
        url = f"https://itunes.apple.com/search?term={encoded}&media=music&entity=song&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "BulkAutoTagger/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw)
        
        results = data.get("results", [])
        if not results:
            return None
            
        item = results[0]
        year = item.get("releaseDate", "")[:4] if item.get("releaseDate") else ""
        artwork = item.get("artworkUrl100", "").replace("100x100", "500x500")
        
        return {
            "title": item.get("trackName", ""),
            "artist": item.get("artistName", ""),
            "album": item.get("collectionName", ""),
            "year": year,
            "artwork_url": artwork
        }
    except Exception as e:
        print(f"  [X] iTunes search error: {e}")
        return None

def process_files():
    files = list(MUSIC_DIR.glob("*.mp3"))
    print(f"Found {len(files)} MP3 files. Starting bulk tag & cover fetch...\n")
    
    success_count = 0
    skipped_count = 0
    
    for idx, f in enumerate(files, 1):
        try:
            try:
                audio = ID3(f)
            except ID3NoHeaderError:
                audio = ID3()
                
            # If it already has an APIC tag (cover art), we can skip it,
            # UNLESS you want to overwrite everything. We'll skip if it has cover.
            has_cover = any(k.startswith("APIC") for k in audio.keys())
            if has_cover:
                # Let's cleanly fix it to ID3v2.3 just in case it was saved in v2.4 previously
                audio.save(v2_version=3)
                skipped_count += 1
                continue
                
            print(f"[{idx}/{len(files)}] Auto-tagging: {f.name}")
            query = f.stem.replace("_", " ") # Basic query from filename
            meta = search_itunes(query)
            
            if not meta:
                print(f"  [-] No iTunes results found for '{query}'")
                continue
                
            # Assign basic tags
            audio["TIT2"] = TIT2(encoding=3, text=meta["title"])
            audio["TPE1"] = TPE1(encoding=3, text=meta["artist"])
            audio["TPE2"] = TPE2(encoding=3, text=meta["artist"]) # Mirror to Album Artist
            audio["TALB"] = TALB(encoding=3, text=meta["album"])
            audio["TDRC"] = TDRC(encoding=3, text=meta["year"])
            
            # Fetch cover art
            if meta["artwork_url"]:
                try:
                    req = urllib.request.Request(meta["artwork_url"], headers={"User-Agent": "BulkAutoTagger/1.0"})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        img_bytes = resp.read()
                        
                    audio.add(APIC(
                        encoding=0,
                        mime="image/jpeg",
                        type=3,
                        desc="Cover",
                        data=img_bytes
                    ))
                    print(f"  [+] Saved tags & cover art from: {meta['artist']} - {meta['title']}")
                    success_count += 1
                except Exception as e:
                    print(f"  [X] Failed to download artwork: {e}")
            
            # Save as ID3v2.3
            audio.save(str(f), v2_version=3)
            
            # Sleep slightly to avoid iTunes rate limiting (approx 20 requests per minute limit)
            time.sleep(1.5)
            
        except Exception as e:
            print(f"  [!] Error processing file: {e}")
            
    print(f"\nDone! Successfully auto-tagged {success_count} files.")
    print(f"Skipped {skipped_count} files that already had cover art (but ensured they are ID3v2.3 format).")

if __name__ == '__main__':
    process_files()
