import os
import io
import urllib.request
import json
import base64
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, APIC

MUSIC_DIR = Path(r'C:\Users\User\Music')

def search_itunes(query: str):
    import urllib.parse
    url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&media=music&limit=1"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            if data["resultCount"] > 0:
                track = data["results"][0]
                art_url = track.get("artworkUrl100", "").replace("100x100bb", "500x500bb")
                if art_url:
                    img_resp = urllib.request.urlopen(art_url, timeout=10)
                    track["cover_bytes"] = img_resp.read()
                return track
    except Exception as e:
        print(f"  [x] iTunes search error: {e}")
    return None

files = list(MUSIC_DIR.glob('*.mp3'))
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            print(f"Restoring: {f.name}")
            track = search_itunes(f.stem)
            if not track:
                print(f"  [-] Could not find iTunes metadata for {f.stem}")
                continue
                
            m = MP3(f)
            m.delete() # start completely fresh
            m.save()
            
            m = MP3(f)
            m.add_tags()
            
            m.tags.add(TIT2(encoding=3, text=track.get("trackName", f.stem)))
            m.tags.add(TPE1(encoding=3, text=track.get("artistName", "Unknown Artist")))
            m.tags.add(TALB(encoding=3, text=track.get("collectionName", "")))
            if "releaseDate" in track:
                m.tags.add(TDRC(encoding=3, text=track["releaseDate"][:4]))
            if "genreName" in track:
                m.tags.add(TCON(encoding=3, text=track["genreName"]))
                
            if "cover_bytes" in track:
                m.tags.add(APIC(
                    encoding=3,
                    mime="image/jpeg",
                    type=3,
                    desc="Cover",
                    data=track["cover_bytes"]
                ))
            
            m.save(v2_version=3)
            print("  [+] Successfully restored tags & cover photo!")
        except Exception as e:
            print(f"  [x] Error restoring {f.name}: {e}")
