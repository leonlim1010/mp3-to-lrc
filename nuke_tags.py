import os
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, APIC

d = Path(r'C:\Users\User\Music')

files = list(d.glob('*.mp3'))
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            m = MP3(f)
            if m.tags is None:
                m.add_tags()
                
            # save existing metadata to reapply
            title = m.tags.get('TIT2') if m.tags else None
            artist = m.tags.get('TPE1') if m.tags else None
            album = m.tags.get('TALB') if m.tags else None
            year = m.tags.get('TDRC') if m.tags else None
            cover = m.tags.get('APIC:Cover') if m.tags else None
            if not cover:
                cover = m.tags.get('APIC:')
            
            m.tags.clear()
            
            if title: m.tags.add(TIT2(encoding=1, text=title.text))
            if artist: m.tags.add(TPE1(encoding=1, text=artist.text))
            if album: m.tags.add(TALB(encoding=1, text=album.text))
            if year: m.tags.add(TDRC(encoding=1, text=year.text))
            if cover:
                m.tags.add(APIC(
                    encoding=0,
                    mime=cover.mime,
                    type=3,
                    desc="",
                    data=cover.data
                ))
            
            # v1=2 explicitly writes ID3v1 tags. v2_version=3 writes ID3v2.3.
            m.save(v1=2, v2_version=3)
            print(f"Completely rebuilt tags for {f.name}")
        except Exception as e:
            print(f"Error on {f.name}: {e}")
