import re, codecs
import sys

# Windows console encoding hack
sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())

content = open('static/script.js', 'r', encoding='utf-8').read()
lines = content.split('\n')
for i, l in enumerate(lines):
    if '...' in l:
        print(f"Line {i+1}: {l.strip()}")
