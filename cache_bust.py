import os
from pathlib import Path
from mutagen.mp3 import MP3

d = Path(r'C:\Users\User\Music')

targets = [
    "轨迹 (Cover)",
    "爱的回归线 (R&B)",
    "身后 (Cover)",
    "身后",
    "全世界陪我失眠 (Cover)",
    "轨迹 (cover)",
    "爱的回归线 (R&B版)"
]

found_count = 0
for f in list(d.glob('*.mp3')):
    for t in targets:
        if t in f.name:
            # 1. Rename the file to explicitly bust Windows Explorer's property cache
            new_name = f.stem + "_" + f.suffix
            new_path = f.with_name(new_name)
            
            f.rename(new_path)
            print(f"Renamed {f.name} to {new_path.name}")
            
            # 2. Open the file and strictly enforce known Windows Explorer compatibility standards
            m = MP3(new_path)
            if m.tags:
                for key in list(m.tags.keys()):
                    if key.startswith('TIT') or key.startswith('TPE') or key.startswith('TAL'):
                        m.tags[key].encoding = 1  # UTF-16
                    elif key.startswith('APIC'):
                        m.tags[key].encoding = 0  # Latin-1
                        m.tags[key].desc = ""     # Empty description
                
                # Resave strictly with fallback ID3v1 and standard ID3v2.3
                try:
                    m.save(v1=2, v2_version=3)
                    print(f"  [+] Resaved tags securely to {new_path.name}")
                except Exception as e:
                    print(f"  [-] Failed to save tags: {e}")
            else:
                print(f"  [-] File has no tags at all to fix!")
                
            found_count += 1
            break

print(f"Processed {found_count} targeted files.")
