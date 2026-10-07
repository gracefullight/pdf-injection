"""Check actual PDF forwards, lossless embedded pixels and control wording."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import os
import sys

import numpy as np
from PIL import Image
from pypdf import PdfReader

from document_artifacts import (PAGE_PIXELS, pdf_structure, pixel_difference,
                                policy_pdf_bytes, raster_pdf_bytes, render_pdf)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixel_notice_render import render as calibrated_poppler
from pixel_notice_render import input_vjp, interpolate


def digest(data):
    return hashlib.sha256(data).hexdigest()


def image_digest(image):
    return digest(np.asarray(image).tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pages', type=Path, required=True)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    paths = [args.pages / f'page-{i}.png' for i in range(1, 8)]
    pages = [Image.open(path).convert('RGB') for path in paths]
    if any(image.size != PAGE_PIXELS for image in pages):
        raise ValueError('Unexpected input geometry')
    native = args.native.read_bytes()
    if digest(native) != '0ba974732c0c296d953a6483fc830c2ec7ae89c92dc2a857f76dc927672d08ed':
        raise ValueError('Native source hash differs from the confirmed document')
    policy = args.policy.read_text()
    files = {'clean-page-2.pdf': raster_pdf_bytes([pages[1]]),
             'clean-raster-document.pdf': raster_pdf_bytes(pages),
             'readable-policy.pdf': policy_pdf_bytes(policy)}
    structures = {name: pdf_structure(data) for name, data in files.items()}
    for name in ('clean-page-2.pdf', 'clean-raster-document.pdf'):
        if any(structures[name]['extracted_text_characters']):
            raise ValueError('Image-only control unexpectedly contains PDF text')
    reader = PdfReader(io.BytesIO(files['clean-raster-document.pdf']))
    embedded = [pixel_difference(image, page.images[0].image.convert('RGB'))
                for image, page in zip(pages, reader.pages, strict=True)]
    if not all(row['exact'] for row in embedded):
        raise ValueError('Packaging changed embedded image pixels')
    extracted_policy = ''.join(page.extract_text() for page in
                              PdfReader(io.BytesIO(files['readable-policy.pdf'])).pages)
    if ' '.join(policy.split()) != ' '.join(extracted_policy.split()):
        raise ValueError('Readable control differs from the supplied wording')
    report = {'status': 'passed_actual_forward_checks', 'dpi': 112,
              'native_sha256': digest(native), 'policy_sha256': digest(args.policy.read_bytes()),
              'input_pages': [{'filename': p.name, 'sha256': digest(p.read_bytes())} for p in paths],
              'pdf_structures': structures, 'embedded_pixels': embedded,
              'renderer_comparisons': {},
              'note': 'No differentiable-renderer parity is claimed; the optimizer uses actual forwards and identity BPDA.'}
    native_views = render_pdf(native)
    executable = os.environ.get('PDFI_PDFTOPPM', 'pdftoppm')
    version = subprocess.run([executable, '-v'], check=True, capture_output=True, text=True)
    report['poppler_version'] = (version.stdout + version.stderr).splitlines()[0]
    for renderer in ('poppler', 'pymupdf', 'pdfium'):
        rendered = render_pdf(files['clean-raster-document.pdf'], renderer)
        report['renderer_comparisons'][renderer] = [
            dict(page=i + 1, rendered_pixel_sha256=image_digest(view),
                 **pixel_difference(image, view))
            for i, (image, view) in enumerate(zip(pages, rendered, strict=True))]
        for i, image in enumerate(rendered):
            image.save(args.output / f'{renderer}-page-{i+1}.png')
    report['native_vs_clean_raster_pymupdf'] = [
        dict(page=i + 1, **pixel_difference(native_views[i], view))
        for i, view in enumerate(render_pdf(files['clean-raster-document.pdf']))]
    source = np.array(pages[1])
    rng = np.random.default_rng(17)
    noise = np.clip(source.astype(np.int16) + rng.integers(-8, 9, source.shape), 0, 255).astype(np.uint8)
    stress = rng.integers(0, 256, source.shape, dtype=np.uint8)
    report['poppler_calibration'] = []
    for name, array in (('clean', source), ('bounded_noise', noise), ('full_range_stress', stress)):
        image = Image.fromarray(array)
        actual = render_pdf(raster_pdf_bytes([image]), 'poppler')[0]
        row = dict(input=name, **pixel_difference(calibrated_poppler(image), actual))
        report['poppler_calibration'].append(row)
    # Validate the unquantized interpolation adjoint independently of byte rounding.
    x = rng.normal(size=(28, 56, 3))
    g = rng.normal(size=x.shape)
    forward_dot = float(np.sum(interpolate(x, quantize=False) * g))
    adjoint_dot = float(np.sum(x * input_vjp(g)))
    report['interpolation_adjoint_error'] = abs(forward_dot - adjoint_dot)
    if not all(row['exact'] for row in report['poppler_calibration']):
        raise ValueError('Historical interpolation surrogate does not match this Poppler configuration')
    if report['interpolation_adjoint_error'] > 1e-10:
        raise ValueError('Interpolation adjoint failed the dot-product check')
    for name, data in files.items():
        (args.output / name).write_bytes(data)
    render_pdf(files['readable-policy.pdf'])[0].save(args.output / 'readable-policy.png')
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
