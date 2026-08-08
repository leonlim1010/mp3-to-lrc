import sys
from pathlib import Path

# Use mutagen straight up
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')
files = list(d.glob('*.mp3'))
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower():
        try:
            m = MP3(f)
            print(f'-- {f.name} --')
            print(f'Info: {m.info}')
            if m.tags:
                print('Keys:', list(m.tags.keys()))
            else:
                print('No tags found.')
        except Exception as e:
            print(f"Failed {f.name}: {e}")
