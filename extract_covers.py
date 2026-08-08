import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

targets = ["轨迹 (cover)_", "身后_"]

for f in d.glob('*.mp3'):
    for t in targets:
        if t in f.name:
            m = MP3(f)
            found_apic = False
            if m.tags:
                for k, v in m.tags.items():
                    if k.startswith('APIC'):
                        found_apic = True
                        print(f"File {f.name}: Found {k}")
                        print(f"Mime: {v.mime}")
                        
                        out_name = f.stem + "_extracted"
                        if v.mime.endswith('png'):
                            out_name += ".png"
                        elif v.mime.endswith('webp'):
                            out_name += ".webp"
                        else:
                            out_name += ".jpg"
                            
                        # read first few bytes to guess real format
                        magic = v.data[:8]
                        print(f"Magic bytes: {magic.hex()}")
                        if magic.startswith(b'\xff\xd8\xff'):
                            print("  (Confirmed JPEG format natively)")
                        elif magic.startswith(b'\x89PNG'):
                            print("  (Confirmed PNG format natively)")
                        elif b'WEBP' in magic: # RIFF....WEBP
                            print("  (Confirmed WEBP format natively)")
                        else:
                            print("  (Unknown format format natively)")
            if not found_apic:
                print(f"File {f.name}: NO APIC TAG FOUND!")
