import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')
for f in d.glob('*.mp3'):
    try:
        MP3(f)
    except Exception:
        with open(f, 'rb') as file:
            header = file.read(64)
            print(f'{f.name} -> {header[:16].hex()}')
            # Also try to print some ascii to see if there's ftyp or similar
            ascii_repr = "".join(chr(b) if 32 <= b <= 126 else '.' for b in header)
            print(f'   ASCII: {ascii_repr}')
