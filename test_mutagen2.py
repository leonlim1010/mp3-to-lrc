import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')
files = list(d.glob('*.mp3'))
test_file = None
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        test_file = f
        break

if test_file:
    print(f'Testing on {test_file.name}')
    try:
        mp3 = MP3(test_file)
        print(f"Tags from MP3: {mp3.tags}")
    except Exception as e:
        print(f'Failed: {e}')
