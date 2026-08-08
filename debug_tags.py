import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, APIC

d = Path(r'C:\Users\User\Music')
files = list(d.glob('*.mp3'))
test_file = None
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        test_file = f
        break

if test_file:
    print(f'Stripping {test_file.name}')
    m = MP3(test_file)
    m.delete() # completely remove all tags
    m.save()
    
    m = MP3(test_file)
    m.add_tags()
    m.tags.add(TIT2(encoding=1, text='Test Windows Explorer'))
    m.tags.add(TPE1(encoding=1, text='Test Artist'))
    m.save(v1=2, v2_version=3)
    print('Saved pristine tags.')
    with open(test_file, 'rb') as f:
        print(f.read(64).hex())
