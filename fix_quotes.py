import re
with open('static/script.js', 'r', encoding='utf-8') as f:
    c = f.read()

c = re.sub(r"(Uploading MP3\.\.\.|Loading LRC\.\.\.|Loading tags\.\.\.|Contacting yt-dlp\.\.\.)(?!\'|\x22)(\)|\s*;|\s*\n|\s*,)", r"\1'\2", c)

with open('static/script.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Fixed quotes')
