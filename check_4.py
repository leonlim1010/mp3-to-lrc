import os
import subprocess
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

targets = [
    "轨迹 (Cover)",
    "爱的回归线 (R&B)",
    "身后 (Cover)",
    "全世界陪我失眠 (Cover)",
    "轨迹 (cover)",
    "爱的回归线 (R&B版)",
    "身后",
]

found = []
for f in d.glob('*.mp3'):
    for t in targets:
        if t in f.name:
            found.append(f)
            break

for f in found:
    print(f"\n--- Analyzing: {f.name} ---")
    try:
        cmd = ["ffprobe", "-v", "error", "-show_format", "-show_streams", str(f)]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if res.stdout:
            print("FFPROBE OUTPUT:")
            lines = res.stdout.split('\n')
            for line in lines:
                if 'TAG' in line or 'format_name' in line or 'codec_name' in line:
                    print("  " + line)
                    
        m = MP3(f)
        if m.tags:
            print("MUTAGEN TAGS:")
            for k in m.tags.keys():
                if k.startswith('APIC'):
                    apic = m.tags[k]
                    print(f"  {k}: mime={apic.mime}, size={len(apic.data)} bytes")
                else:
                    print(f"  {k}: {m.tags[k]}")
        else:
            print("MUTAGEN TAGS: None")
    except Exception as e:
        print(f"ERROR: {e}")
