"""Minimal Markdown → HTML for docs/code-review/yuntay-exterior-review.md (headings, tables, fenced code,
nested lists, blockquotes, rules, inline code / bold). No dependencies.

Usage (macOS; no pandoc / Chrome needed):
  python3 scripts/md-to-pdf/md2html.py docs/code-review/yuntay-exterior-review.md > /tmp/review.html
  swift scripts/md-to-pdf/html2pdf.swift /tmp/review.html docs/code-review/yuntay-exterior-review.pdf
"""
import html, re, sys

src = open(sys.argv[1], encoding='utf-8').read().split('\n')
title = next((l[2:] for l in src if l.startswith('# ')), 'document')


def inline(s: str) -> str:
    codes: list[str] = []

    def stash(m: re.Match) -> str:
        codes.append('<code>' + html.escape(m.group(1)) + '</code>')
        return f'\x00{len(codes) - 1}\x00'

    s = re.sub(r'`([^`]+)`', stash, s)
    s = html.escape(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    return re.sub(r'\x00(\d+)\x00', lambda m: codes[int(m.group(1))], s)


def split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith('|'): line = line[1:]
    if line.endswith('|'): line = line[:-1]
    return [c.strip() for c in line.split('|')]


LIST_RE = re.compile(r'^(\s*)([-*]|\d+\.)\s+(.*)$')
body: list[str] = []
i = 0
while i < len(src):
    line = src[i]
    if line.startswith('```'):
        lang = line[3:].strip()
        i += 1
        code = []
        while i < len(src) and not src[i].startswith('```'):
            code.append(src[i]); i += 1
        i += 1
        # Padding that only aligns trailing comments in the source would wrap them in print: shrink it.
        code = [re.sub(r'(\S)[ ]{3,}(//)', r'\1  \2', l) for l in code]
        body.append(f'<pre><code class="lang-{lang}">' + html.escape('\n'.join(code)) + '</code></pre>')
        continue
    m = re.match(r'^(#{1,6})\s+(.*)$', line)
    if m:
        n = len(m.group(1)); body.append(f'<h{n}>{inline(m.group(2))}</h{n}>'); i += 1; continue
    if re.match(r'^-{3,}\s*$', line):
        body.append('<hr>'); i += 1; continue
    if line.startswith('|') and i + 1 < len(src) and re.match(r'^\|[\s:|-]+\|\s*$', src[i + 1]):
        head = split_row(line)
        aligns = []
        for c in split_row(src[i + 1]):
            aligns.append('right' if c.endswith(':') and not c.startswith(':') else 'center' if c.startswith(':') and c.endswith(':') else 'left')
        i += 2
        rows = []
        while i < len(src) and src[i].startswith('|'):
            rows.append(split_row(src[i])); i += 1
        t = ['<table><thead><tr>' + ''.join(f'<th style="text-align:{aligns[k] if k < len(aligns) else "left"}">{inline(c)}</th>' for k, c in enumerate(head)) + '</tr></thead><tbody>']
        for r in rows:
            t.append('<tr>' + ''.join(f'<td style="text-align:{aligns[k] if k < len(aligns) else "left"}">{inline(c)}</td>' for k, c in enumerate(r)) + '</tr>')
        t.append('</tbody></table>')
        body.append(''.join(t)); continue
    if line.startswith('>'):
        q = []
        while i < len(src) and src[i].startswith('>'):
            q.append(src[i].lstrip('>').strip()); i += 1
        body.append('<blockquote>' + inline(' '.join(q)) + '</blockquote>'); continue
    m = LIST_RE.match(line)
    if m:
        items = []
        while i < len(src) and (LIST_RE.match(src[i]) or (src[i].startswith('  ') and src[i].strip() and items)):
            mm = LIST_RE.match(src[i])
            if mm:
                items.append((len(mm.group(1)), mm.group(2), mm.group(3)))
            else:
                ind, mk, tx = items[-1]; items[-1] = (ind, mk, tx + ' ' + src[i].strip())
            i += 1
        out = []
        stack: list[tuple[int, str]] = []
        for ind, mk, tx in items:
            tag = 'ol' if mk[0].isdigit() else 'ul'
            while stack and stack[-1][0] > ind:
                out.append(f'</li></{stack.pop()[1]}>')
            if stack and stack[-1][0] == ind:
                out.append('</li>')
            else:
                out.append(f'<{tag}>'); stack.append((ind, tag))
            out.append(f'<li>{inline(tx)}')
        while stack:
            out.append(f'</li></{stack.pop()[1]}>')
        body.append(''.join(out)); continue
    if not line.strip():
        i += 1; continue
    para = [line]
    i += 1
    while i < len(src) and src[i].strip() and not re.match(r'^(#{1,6}\s|```|\||>|-{3,}\s*$)', src[i]) and not LIST_RE.match(src[i]):
        para.append(src[i]); i += 1
    text = ' '.join(para)
    # A paragraph that is only a bold label ("**修改前**", "**修改後**") belongs with what follows it.
    cls = ' class="label"' if re.fullmatch(r'\*\*[^*]+\*\*', text.strip()) else ''
    body.append(f'<p{cls}>' + inline(text) + '</p>')

joined = '\n'.join(body)
joined = re.sub(r'(<p class="label">.*?</p>)\n(<pre>.*?</pre>)', r'<div class="keep">\1\2</div>', joined, flags=re.S)
# Same for a heading and the paragraph / code block right after it (not tables or long lists).
joined = re.sub(r'(<h[23]>.*?</h[23]>)\n(<p>.*?</p>|<pre>.*?</pre>|<div class="keep">.*?</div>)', r'<div class="keep">\1\2</div>', joined, flags=re.S)

css = """
@page { size: A4; }
html { -webkit-print-color-adjust: exact; }
body { font-family: "PingFang TC", "Heiti TC", -apple-system, "Helvetica Neue", sans-serif; font-size: 10pt; line-height: 1.55; color: #1c1c1e; }
h1 { font-size: 19pt; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 2pt solid #2b4c3f; color: #1f3a30; }
h2 { font-size: 14pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1pt solid #b9c9c1; color: #1f3a30; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; color: #2b4c3f; break-after: avoid; }
p { margin: 4pt 0; }
p.label { break-after: avoid; margin-top: 8pt; }
ul, ol { margin: 3pt 0 3pt 15pt; padding: 0; }
li { margin: 2pt 0; }
hr { border: 0; border-top: 1pt solid #cfd8d3; margin: 14pt 0; }
blockquote { margin: 6pt 0; padding: 5pt 10pt; background: #f1f5f3; border-left: 3pt solid #2b4c3f; color: #333; break-inside: avoid; }
code { font-family: "SF Mono", Menlo, Monaco, monospace; font-size: 8.6pt; background: #eef1ef; padding: 0 2pt; border-radius: 2pt; }
pre { background: #f6f8f7; border: 0.5pt solid #d5dcd8; border-radius: 3pt; padding: 6pt 8pt; margin: 5pt 0; white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 7.9pt; line-height: 1.4; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 8.6pt; line-height: 1.4; }
th, td { border: 0.5pt solid #b9c4bf; padding: 3pt 5pt; vertical-align: top; }
th { background: #e4ece8; color: #1f3a30; }
tr { break-inside: avoid; }
.keep { break-inside: avoid; }
"""
print(f'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{css}</style></head><body>' + joined + '</body></html>')
