import os
import subprocess
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')
for f in d.glob('*.mp3'):
    try:
        MP3(f)
    except Exception:
        print(f"Checking {f.name}...")
        cmd = f'ffprobe -v error -show_format "{f}"'
        result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        print(result.stdout if result.stdout else result.stderr)
