import os
import subprocess
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import TIT2, TPE1, TALB, APIC

d = Path(r'C:\Users\User\Music')

for f in list(d.glob('*.mp3')):
    if "cover" in f.name.lower() or "r&b" in f.name.lower() or "µ" in f.name:
        print(f"Purifying {f.name}")
        try:
            m = MP3(f)
            
            # 1. Extract existing metadata
            title = m.tags.get('TIT2') if m.tags else None
            artist = m.tags.get('TPE1') if m.tags else None
            album = m.tags.get('TALB') if m.tags else None
            cover = m.tags.get('APIC:Cover') if m.tags else None
            if m.tags and not cover:
                cover = m.tags.get('APIC:')
            
            # 2. Remux using ffmpeg strictly stripping all metadata
            temp_name = f.with_name(f.stem + "_pure.mp3")
            cmd = [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(f),
                "-map", "0:a",
                "-c:a", "copy",
                "-map_metadata", "-1",  # drop all metadata
                "-fflags", "+bitexact", # drop informational headers
                str(temp_name)
            ]
            res = subprocess.run(cmd)
            if res.returncode != 0:
                print(f"  [-] Error remuxing {f.name}")
                continue
                
            # 3. Apply standard Mutagen tags to the pure file
            m_pure = MP3(temp_name)
            if m_pure.tags is None:
                m_pure.add_tags()
            else:
                m_pure.tags.clear()
            
            if title: m_pure.tags.add(TIT2(encoding=3, text=title.text))
            if artist: m_pure.tags.add(TPE1(encoding=3, text=artist.text))
            if album: m_pure.tags.add(TALB(encoding=3, text=album.text))
            if cover:
                m_pure.tags.add(APIC(
                    encoding=3,
                    mime=cover.mime,
                    type=3,
                    desc="Cover",
                    data=cover.data
                ))
                
            m_pure.save(v2_version=3)
            
            # 4. Replace original file
            f.unlink()
            temp_name.rename(f)
            print(f"  [+] Successfully purified and tagged {f.name}")
        except Exception as e:
            print(f"  [-] Error on {f.name}: {e}")
            if 'temp_name' in locals() and temp_name.exists():
                temp_name.unlink()
