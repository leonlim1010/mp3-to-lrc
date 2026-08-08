import re
with open('static/script.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r"(Transcribing\.\.\.|Loading\.\.\.|Saving\.\.\.|Searching\.\.\.|Fetching\.\.\.)(?!\'|\x22)(\)|\s*;|\s*\n|\s*,)", r"\1'\2", content)

with open('static/script.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
