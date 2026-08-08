import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')
bad_files = []
for f in d.glob('*.mp3'):
    try:
        audio = MP3(f)
    except Exception as e:
        bad_files.append((f.name, str(e)))

print(f"Found {len(bad_files)} problematic files:")
for bf in bad_files:
    print(f" - {bf[0]}: {bf[1]}")
