"""Audit page-2 reading and pixel constraints independently of the optimizer."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import unicodedata

import numpy as np
from PIL import Image, ImageFilter
from pypdf import PdfReader
from rapidfuzz.distance import Levenshtein

from document_artifacts import raster_pdf_bytes, render_pdf


def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', text).split())


def error_rates(reference, hypothesis):
    return {'cer': Levenshtein.distance(reference, hypothesis) / max(1, len(reference)),
            'wer': Levenshtein.distance(reference.split(), hypothesis.split()) / max(1, len(reference.split()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--candidates', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    reference = normalize(PdfReader(args.native).pages[1].extract_text())
    (args.output / 'reference.txt').write_text(reference + '\n')
    source = np.array(Image.open(args.source).convert('RGB'))
    protected = np.asarray(Image.fromarray((source.min(axis=2) < 250).astype(np.uint8) * 255)
                           .filter(ImageFilter.MaxFilter(5))) > 0
    rows = []
    for path in sorted(args.candidates.glob('*.png')):
        image = Image.open(path).convert('RGB')
        if np.array(image).shape != source.shape:
            raise ValueError('Candidate geometry differs from the source')
        delta = np.array(image).astype(np.int16) - source.astype(np.int16)
        for name, view in (('image', image), ('poppler', render_pdf(raster_pdf_bytes([image]), 'poppler')[0])):
            png = args.output / f'{path.stem}-{name}.png'
            view.save(png)
            result = subprocess.run(['tesseract', str(png), 'stdout', '-l', 'eng', '--psm', '3'],
                                    check=True, capture_output=True, text=True)
            (args.output / f'{path.stem}-{name}.txt').write_text(result.stdout)
            hypothesis = normalize(result.stdout)
            rows.append({'candidate': path.name, 'view': name,
                         'candidate_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                         'ocr_sha256': hashlib.sha256(result.stdout.encode()).hexdigest(),
                         'linf_bytes': int(np.abs(delta).max()),
                         'protected_changed_channels': int(np.count_nonzero(delta[protected])),
                         'changed_channels': int(np.count_nonzero(delta)),
                         'reference_characters': len(reference), 'ocr_characters': len(hypothesis),
                         **error_rates(reference, hypothesis)})
    version = subprocess.run(['tesseract', '--version'], check=True, capture_output=True, text=True)
    report = {'status': 'complete', 'scope': 'Page 2 only; raw OCR is retained separately.',
              'ocr_engine': version.stdout.splitlines()[0],
              'reference': 'NFKC-normalized native PDF text with collapsed whitespace; case and punctuation retained.',
              'reference_sha256': hashlib.sha256(reference.encode()).hexdigest(), 'rows': rows,
              'limitation': 'PDF extraction order and OCR transcription differ; these are transcription errors, not semantic answer accuracy.'}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
