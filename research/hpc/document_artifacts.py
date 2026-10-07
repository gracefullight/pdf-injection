"""Deterministic image-only PDF packaging and independently rendered controls."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

PAGE_POINTS = (612, 792)
DPI = 112
PAGE_PIXELS = (952, 1232)


def raster_pdf_bytes(images):
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=PAGE_POINTS, invariant=1, pageCompression=1)
    for image in images:
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)
        if image.mode != 'RGB' or image.size != PAGE_PIXELS:
            raise ValueError('Expected an opaque RGB Letter page at 112 DPI')
        canvas.drawImage(ImageReader(image), 0, 0, width=612, height=792)
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def render_pdf(data, renderer='pymupdf'):
    if isinstance(data, Path):
        data = data.read_bytes()
    images = []
    if renderer == 'pymupdf':
        import fitz
        with fitz.open(stream=data, filetype='pdf') as doc:
            for page in doc:
                pix = page.get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72), alpha=False)
                images.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    elif renderer == 'pdfium':
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(data)
        try:
            for page in doc:
                try:
                    bitmap = page.render(scale=DPI / 72)
                    try:
                        images.append(bitmap.to_pil().convert('RGB').copy())
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        finally:
            doc.close()
    elif renderer == 'poppler':
        executable = os.environ.get('PDFI_PDFTOPPM', 'pdftoppm')
        with tempfile.TemporaryDirectory(prefix='pdfi-render-') as temporary:
            directory = Path(temporary)
            source = directory / 'document.pdf'
            source.write_bytes(data)
            subprocess.run([executable, '-r', str(DPI), '-png', str(source),
                            str(directory / 'page')], check=True, capture_output=True)
            paths = sorted(directory.glob('page-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
            images = [Image.open(path).convert('RGB') for path in paths]
    else:
        raise ValueError(renderer)
    if not images or any(image.size != PAGE_PIXELS for image in images):
        raise ValueError('Unexpected rendered page geometry')
    return images


def policy_pdf_bytes(policy):
    """Render the supplied notice verbatim on a separate semantic-control page."""
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=PAGE_POINTS, invariant=1)
    y = 744
    for index, paragraph in enumerate(policy.strip().split('\n\n')):
        style = ParagraphStyle('notice', fontName='Helvetica-Bold' if index == 0 else 'Helvetica',
                               fontSize=15 if index == 0 else 12, leading=18)
        flow = Paragraph(escape(paragraph).replace('\n', '<br/>'), style)
        _, height = flow.wrap(516, 700)
        y -= height
        if y < 48:
            raise ValueError('Policy does not fit on one page at the declared font size')
        flow.drawOn(canvas, 48, y)
        y -= 18
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def pixel_difference(first, second):
    a, b = np.asarray(first), np.asarray(second)
    if a.shape != b.shape:
        raise ValueError('Pixel comparison requires matching geometry')
    delta = a.astype(np.int16) - b.astype(np.int16)
    return {'max_abs_bytes': int(np.abs(delta).max()),
            'mean_abs_bytes': float(np.abs(delta).mean()),
            'changed_channels': int(np.count_nonzero(delta)),
            'total_channels': int(delta.size), 'exact': bool(np.array_equal(a, b))}


def pdf_structure(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return {'sha256': hashlib.sha256(data).hexdigest(), 'pages': len(reader.pages),
            'extracted_text_characters': [len(page.extract_text()) for page in reader.pages],
            'images_per_page': [len(page.images) for page in reader.pages]}
