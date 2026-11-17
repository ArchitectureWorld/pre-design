#!/usr/bin/python3
"""Test-only converter boundary: one real PDF page; not a LibreOffice substitute."""
import sys
from pathlib import Path
out = Path(sys.argv[sys.argv.index('--outdir') + 1]) / 'preview.pdf'
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Contents 4 0 R >>', b'<< /Length 0 >>\nstream\n\nendstream']
data = b'%PDF-1.4\n'; offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(data)); data += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
xref = len(data)
data += b'xref\n0 5\n0000000000 65535 f \n' + b''.join(f'{n:010} 00000 n \n'.encode() for n in offsets[1:])
data += f'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
out.write_bytes(data)
