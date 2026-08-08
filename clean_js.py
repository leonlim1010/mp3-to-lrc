with open('static/script.js', 'r', encoding='utf-8') as f:
    c = f.read()

replacements = {
    '.../p>': '</p>',
    '.../span>': '</span>',
    '.../em>': '</em>',
    '.../option>': '</option>',
    ' ... ': ' ? ',
    '...q=': '?q=',
    '}"...': '}"?',
    '...Saved ': '✓ Saved ',
    '...Loaded ': '✓ Loaded ',
    '...Renamed ': '✓ Renamed ',
    '...Metadata ': '✓ Metadata ',
    '...Tags saved ': '✓ Tags saved ',
    '/[<>:\"/\\\\|...*]/g': '/[<>:\"/\\\\|?*]/g'
}

for old, new in replacements.items():
    c = c.replace(old, new)

with open('static/script.js', 'w', encoding='utf-8') as f:
    f.write(c)

print('Cleaned JS')
