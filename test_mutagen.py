import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2

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
        try:
            audio = ID3(str(test_file))
            print("Found existing ID3 tag.")
        except Exception as e:
            print(f"No ID3 tag: {e}")
            audio = ID3()

        audio.add(TIT2(encoding=3, text='Test Title'))
        audio.save(str(test_file), v2_version=3)
        print('Successfully saved tags via ID3 object.')
        
        # Verify
        verify = ID3(str(test_file))
        print(f"Verified Title: {verify.get('TIT2')}")
        
    except Exception as e:
        print(f'Failed: {e}')
