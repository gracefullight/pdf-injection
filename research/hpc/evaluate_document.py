"""Paired single-page/full-document evaluation after candidate selection is frozen.

Qwen receives rendered images. Native PDF byte ingestion is not tested by this
model; native-document baselines are named by their rendering path explicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from document_artifacts import (pdf_structure, pixel_difference, policy_pdf_bytes,
                                raster_pdf_bytes, render_pdf)
from run_pilot import provisional_label
from torch_document import FrozenQwen, exact_short_answer, sha256, write_json

PAGE_SELECTOR = 'Consider only the page headed "Game Specification". '


def evaluate_pages(runner, images, config, cache, label, output):
    rows = []
    image_hashes = [hashlib.sha256(np.asarray(image).tobytes()).hexdigest() for image in images]
    for kind, items in (('task', config['test']), ('utility', config['utility_test'])):
        for item in items:
            prompt = PAGE_SELECTOR + item['prompt']
            token_limit = 192 if kind == 'task' else 64
            key = hashlib.sha256(json.dumps([image_hashes, prompt, token_limit]).encode()).hexdigest()
            entry = cache / (key + '.json')
            reused = entry.exists()
            if reused:
                row = json.loads(entry.read_text())
            else:
                row = runner.generate(images, prompt, max_new_tokens=token_limit)
                write_json(entry, row)
            row.update(condition=label, kind=kind, question_id=item['id'],
                       image_pixel_sha256s=image_hashes, response_cache_key=key,
                       reused_identical_input_response=reused)
            if kind == 'task':
                row.update(label=provisional_label(row), leakage_rubric=item['leakage_rubric'])
            else:
                row.update(expected=item['target'], utility_match=not row['incomplete'] and
                           exact_short_answer(row['response'], item['target']))
            rows.append(row)
            write_json(output, {'condition': label, 'status': 'running', 'rows': rows})
    result = {'condition': label, 'status': 'complete_pending_manual_review', 'rows': rows,
              'labels_require_manual_review': True}
    write_json(output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--pages', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--prompts', type=Path, required=True)
    parser.add_argument('--pilot', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    pilot = json.loads((args.pilot / 'manifest.json').read_text())
    if pilot['status'] != 'page_pilot_finished_pending_manual_review_and_document_evaluation':
        raise RuntimeError('Freeze candidate selection and finish page-level evaluation first')
    if pilot['prompts_sha256'] != sha256(args.prompts):
        raise RuntimeError('Prompt fixture changed after candidate selection')
    if sha256(args.native) != '0ba974732c0c296d953a6483fc830c2ec7ae89c92dc2a857f76dc927672d08ed':
        raise RuntimeError('Native source hash mismatch')
    args.output.mkdir(parents=True, exist_ok=False)
    cache = args.output / 'cache'
    cache.mkdir()
    pdf_dir = args.output / 'pdf'
    pdf_dir.mkdir()
    pages = [Image.open(args.pages / f'page-{i}.png').convert('RGB') for i in range(1, 8)]
    config = json.loads(args.prompts.read_text())
    runner = FrozenQwen(str(args.model))
    report = {'status': 'running', 'native_sha256': sha256(args.native),
              'policy_sha256': sha256(args.policy), 'prompts_sha256': sha256(args.prompts),
              'page_selector': PAGE_SELECTOR,
              'native_ingestion': 'Rendered pages only; no native PDF bytes or extracted text enter Qwen.',
              'notice_control': 'A separate leading raster page contains the supplied notice verbatim; compare with the same extra blank page.',
              'conditions': [], 'artifacts': [],
              'response_reuse': 'Deterministic generation cached only for identical ordered RGB pixel hashes, prompt and token limit.',
              'manual_review_required': True}
    for renderer in ('poppler', 'pymupdf'):
        label = 'native-rendered-' + renderer
        evaluate_pages(runner, render_pdf(args.native, renderer), config, cache,
                       label, args.output / (label + '.json'))
        report['conditions'].append(label)
        write_json(args.output / 'manifest.json', report)
    names = ['clean'] + [f'random-s{s}' for s in pilot['seeds']]
    names += [f'{arm}-s{seed}' for seed in pilot['seeds'] for arm in ('E', 'U', 'X')]
    for name in names:
        image_path = args.pilot / 'final' / (name + '.png')
        selected = Image.open(image_path).convert('RGB')
        candidate_pages = pages.copy()
        candidate_pages[1] = selected
        for index in (0, 2, 3, 4, 5, 6):
            assert pixel_difference(candidate_pages[index], pages[index])['exact']
        full_pdf = raster_pdf_bytes(candidate_pages)
        single_pdf = raster_pdf_bytes([selected])
        artifact = pdf_dir / (name + '.pdf')
        artifact.write_bytes(full_pdf)
        report['artifacts'].append({'filename': artifact.name, 'candidate_sha256': sha256(image_path),
                                    'changed_source_pages': [] if pixel_difference(selected, pages[1])['exact'] else [2],
                                    **pdf_structure(full_pdf)})
        for renderer in ('poppler', 'pymupdf'):
            for scope, document in (('single', single_pdf), ('full', full_pdf)):
                label = f'{name}-{scope}-{renderer}'
                evaluate_pages(runner, render_pdf(document, renderer), config, cache,
                               label, args.output / (label + '.json'))
                report['conditions'].append(label)
                write_json(args.output / 'manifest.json', report)
    notice = render_pdf(policy_pdf_bytes(args.policy.read_text()), 'pymupdf')[0]
    blank = Image.new('RGB', notice.size, 'white')
    for prefix, name in ((blank, 'blank-page-control'), (notice, 'readable-policy-control')):
        for scope, content in (('single', [pages[1]]), ('full', pages)):
            data = raster_pdf_bytes([prefix] + content)
            artifact = pdf_dir / f'{name}-{scope}.pdf'
            artifact.write_bytes(data)
            for renderer in ('poppler', 'pymupdf'):
                label = f'{name}-{scope}-{renderer}'
                evaluate_pages(runner, render_pdf(data, renderer), config, cache,
                               label, args.output / (label + '.json'))
                report['conditions'].append(label)
                write_json(args.output / 'manifest.json', report)
    report['status'] = 'finished_pending_manual_review_ocr_and_visual_checks'
    report['unique_generation_calls'] = len(list(cache.glob('*.json')))
    report['logical_response_rows'] = len(report['conditions']) * 10
    write_json(args.output / 'manifest.json', report)


if __name__ == '__main__':
    main()
