import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

out = []
files = list(d.glob('*.mp3'))
for f in files:
    if 'cover' in f.name.lower() or 'r&b' in f.name.lower() or 'µ' in f.name:
        try:
            m = MP3(f)
            out.append(f"-- {f.name} --")
            out.append(f"Tags present: {m.tags is not None}")
            if m.tags:
                out.append(f"Keys: {list(m.tags.keys())}")
                for k in m.tags.keys():
                    if k.startswith('APIC'):
                        apic = m.tags[k]
                        out.append(f"  {k}: mime={apic.mime}, type={apic.type}, desc={apic.desc}, size={len(apic.data)}")
                    else:
                        out.append(f"  {k}: {m.tags[k]}")
        except Exception as e:
            out.append(f"Error reading {f.name}: {e}")

Path('id3_debug.txt').write_text('\n'.join(out), encoding='utf-8')
