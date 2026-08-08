import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import TIT2, TPE1, TALB, TDRC, TCON

d = Path(r'C:\Users\User\Music')

files = list(d.glob('*.mp3'))
count = 0
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            m = MP3(f)
            if m.tags:
                # Transcode all text frames to UTF-16 (encoding=1)
                for key in list(m.tags.keys()):
                    frame = m.tags[key]
                    if hasattr(frame, 'encoding') and frame.encoding == 3:
                        # Convert UTF-8 encoded text frame to UTF-16
                        frame.encoding = 1
                m.save(v2_version=3)
                print(f"Fixed encoding and saved {f.name}")
                count += 1
        except Exception as e:
            print(f"Error on {f.name}: {e}")
print(f"Total fixed: {count}")
