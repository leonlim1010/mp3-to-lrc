import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import TPE2

MUSIC_DIR = Path(r'C:\Users\User\Music')
files = list(MUSIC_DIR.glob('*.mp3'))

success_count = 0
skip_count = 0
error_count = 0

for f in files:
    try:
        m = MP3(f)
        if m.tags:
            # TPE1 is Contributing Artist, TPE2 is Album Artist
            tpe1 = m.tags.get('TPE1')
            if tpe1 and tpe1.text:
                artist_text = tpe1.text
                
                # Check if it's already set correctly
                tpe2 = m.tags.get('TPE2')
                if tpe2 and tpe2.text == artist_text:
                    skip_count += 1
                    continue
                    
                # Update TPE2
                m.tags.add(TPE2(encoding=3, text=artist_text))
                
                # Save while matching the safe config
                m.save(v2_version=3)
                success_count += 1
            else:
                skip_count += 1
        else:
            skip_count += 1
    except Exception as e:
        print(f"Error processing {f.name}: {e}")
        error_count += 1

print(f"Done! Updated Album Artist on {success_count} files. Skipped {skip_count}. Errors: {error_count}.")
