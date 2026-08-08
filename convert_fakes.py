import os
import subprocess
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

fake_mp3s = []
for f in list(d.glob('*.mp3')):
    try:
        MP3(f)
    except Exception:
        fake_mp3s.append(f)

for f in fake_mp3s:
    print(f"Converting fake MP3 to real MP3: {f.name}...")
    temp_name = f.with_name(f.stem + "_temp_1234.mp3")
    
    cmd = [
        "ffmpeg", "-y", "-v", "error", 
        "-i", str(f), 
        "-f", "mp3",
        "-b:a", "192k", 
        str(temp_name)
    ]
    res = subprocess.run(cmd)
    
    if res.returncode == 0 and temp_name.exists():
        f.unlink()
        temp_name.rename(f)
        print(f"  -> Successfully converted {f.name} to MP3!")
    else:
        print(f"  -> Failed: {res.stderr}")
