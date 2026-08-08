import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3

d = Path(r'C:\Users\User\Music')
for f in d.glob('*.mp3'):
    try:
        MP3(f)
    except Exception:
        print(f"Fixing {f.name}...")
        try:
            id3 = ID3(f)
            id3.delete(f)
            print(f"  -> Removed incorrect ID3 tag from {f.name}")
        except Exception as e:
            print(f"  -> Could not remove ID3 from {f.name}: {e}")
