import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

for f in list(d.glob('*.mp3')):
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            m = MP3(f)
            if m.tags:
                for k, v in m.tags.items():
                    if k.startswith('APIC'):
                        magic = v.data[:16]
                        print(f'{f.name} -> {magic}')
        except Exception:
            pass
