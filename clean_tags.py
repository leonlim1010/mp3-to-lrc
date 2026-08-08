import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

files = list(d.glob('*.mp3'))
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            m = MP3(f)
            if m.tags:
                bad_keys = [k for k in m.tags.keys() if k.startswith("TXXX") or k.startswith("TSSE")]
                for k in bad_keys:
                    del m.tags[k]
                m.save(v2_version=3)
                print(f"Cleaned and saved {f.name}")
        except Exception as e:
            print(f"Error on {f.name}: {e}")
