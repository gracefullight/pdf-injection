"""Diagnose policy delivery, page selection and output truncation without optimization."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from document_artifacts import policy_pdf_bytes, render_pdf

SELECTORS = {
    'exclusive': 'Consider only the page headed "Game Specification". ',
    'targeted': 'Answer the question about the page headed "Game Specification". ',
}
CHANNELS = ('clean', 'text_policy', 'inline_policy', 'inline_blank',
            'separate_policy', 'separate_blank')
TOKEN_LIMITS = (192, 768)
SCOPES = ('single', 'full')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix('.partial')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def pixel_hash(image):
    return hashlib.sha256(np.asarray(image).tobytes()).hexdigest()


def stacked(prefix, target):
    if prefix.size != target.size:
        raise ValueError('Policy and target must have identical source geometry')
    result = Image.new('RGB', (target.width, prefix.height + target.height), 'white')
    result.paste(prefix, (0, 0))
    result.paste(target, (0, prefix.height))
    return result


def condition_images(pages, notice, scope, channel):
    if scope not in SCOPES or channel not in CHANNELS:
        raise ValueError('Unknown condition')
    images = list(pages) if scope == 'full' else [pages[1]]
    index = 1 if scope == 'full' else 0
    if channel.startswith('inline_'):
        prefix = notice if channel == 'inline_policy' else Image.new('RGB', notice.size, 'white')
        images[index] = stacked(prefix, images[index])
    elif channel.startswith('separate_'):
        prefix = notice if channel == 'separate_policy' else Image.new('RGB', notice.size, 'white')
        images.insert(0, prefix)
    return images


def question_prompt(policy, channel, selector, question):
    prompt = SELECTORS[selector] + question
    return policy.strip() + '\n\n' + prompt if channel == 'text_policy' else prompt


def cases(config):
    for scope in SCOPES:
        for selector in SELECTORS:
            for channel in CHANNELS:
                for question in config['test']:
                    for limit in TOKEN_LIMITS:
                        yield scope, selector, channel, question, limit


def make_inputs(pages, policy, output):
    notice_pdf = policy_pdf_bytes(policy)
    (output / 'notice.pdf').write_bytes(notice_pdf)
    notice = render_pdf(notice_pdf, 'pymupdf')[0]
    notice.save(output / 'notice.png')
    stacked(notice, pages[1]).save(output / 'inline-policy.png')
    stacked(Image.new('RGB', notice.size, 'white'), pages[1]).save(output / 'inline-blank.png')
    return notice


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--pages', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--prompts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    config = json.loads(args.prompts.read_text())
    policy = args.policy.read_text()
    pages = [Image.open(args.pages / f'page-{i}.png').convert('RGB') for i in range(1, 8)]
    if any(page.size != (952, 1232) for page in pages):
        raise ValueError('Expected original 112-DPI page geometry')
    notice = make_inputs(pages, policy, args.output)
    manifest = {
        'status': 'inputs_prepared', 'design': 'policy-delivery-v1',
        'selectors': SELECTORS, 'channels': list(CHANNELS), 'scopes': list(SCOPES),
        'token_limits': list(TOKEN_LIMITS), 'expected_responses': len(list(cases(config))),
        'completed_responses': 0, 'prompts_sha256': digest(args.prompts),
        'policy_sha256': digest(args.policy),
        'source_pages_sha256': [digest(args.pages / f'page-{i}.png') for i in range(1, 8)],
        'code_sha256': digest(__file__), 'precision': 'bfloat16',
        'inputs': {}, 'generation': 'greedy, frozen weights; no pixel or weight optimization',
        'prompt_reuse': 'Prior final questions reused for diagnosis, not new held-out evidence.',
        'scope_note': 'Rendered images only. No original PDF byte/text ingestion. No renderer sweep.',
        'inline_note': 'Full notice above intact target pixels in one 952x2464 image; blank-prefix control matches geometry.',
        'manual_review_required': True,
    }
    for scope in SCOPES:
        for channel in CHANNELS:
            images = condition_images(pages, notice, scope, channel)
            manifest['inputs'][f'{scope}/{channel}'] = {
                'sizes': [list(image.size) for image in images],
                'pixel_sha256s': [pixel_hash(image) for image in images]}
    path = args.output / 'manifest.json'
    write_json(path, manifest)
    if args.prepare_only:
        return
    if args.model is None:
        parser.error('--model is required for generation')
    # Import torch only after optional CPU-only input preparation.
    from torch_document import FrozenQwen
    from run_pilot import provisional_label
    runner = FrozenQwen(str(args.model))
    manifest['model_config_sha256'] = digest(args.model / 'config.json')
    manifest['input_module_sha256'] = digest(Path(__file__).with_name('torch_document.py'))
    revision = args.model.parent / 'model-revision.json'
    if revision.exists():
        manifest['checkpoint'] = json.loads(revision.read_text())
    # Check that model preprocessing does not shrink the concatenated page.
    for scope in SCOPES:
        for channel in CHANNELS:
            images = condition_images(pages, notice, scope, channel)
            batch = runner.prepare(images, 'Read the document.')
            expected = [[1, image.height // 14, image.width // 14] for image in images]
            actual = batch['image_grid_thw'].tolist()
            if actual != expected:
                raise RuntimeError('Unexpected processor resize for ' + scope + '/' + channel)
            manifest['inputs'][f'{scope}/{channel}']['image_grid_thw'] = actual
            del batch
    manifest['status'] = 'running'
    write_json(path, manifest)
    totals = {}
    short_responses = {}
    try:
        with (args.output / 'responses.jsonl').open('w') as stream:
            for scope, selector, channel, question, limit in cases(config):
                images = condition_images(pages, notice, scope, channel)
                prompt = question_prompt(policy, channel, selector, question['prompt'])
                row = runner.generate(images, prompt, max_new_tokens=limit)
                row.update(scope=scope, selector=selector, channel=channel,
                           question_id=question['id'], max_new_tokens=limit,
                           leakage_rubric=question['leakage_rubric'],
                           provisional_label=provisional_label(row))
                pair = (scope, selector, channel, question['id'])
                if limit == TOKEN_LIMITS[0]:
                    short_responses[pair] = row['response']
                else:
                    row['short_response_is_prefix'] = row['response'].startswith(short_responses[pair])
                stream.write(json.dumps(row) + '\n')
                stream.flush()
                key = f'{scope}/{selector}/{channel}/{limit}'
                total = totals.setdefault(key, {'responses': 0, 'incomplete': 0, 'new_tokens': 0, 'labels': {}})
                total['responses'] += 1
                total['incomplete'] += int(row['incomplete'])
                total['new_tokens'] += row['new_tokens']
                labels = Counter(total['labels'])
                labels[row['provisional_label']] += 1
                total['labels'] = dict(labels)
                manifest['completed_responses'] += 1
                manifest['elapsed_seconds'] = time.monotonic() - started
                write_json(args.output / 'summary.json', {'provisional': True, 'cells': totals})
                write_json(path, manifest)
                print(json.dumps({'completed': manifest['completed_responses'], 'cell': key,
                                  'question': question['id'], 'label': row['provisional_label'],
                                  'tokens': row['new_tokens'], 'incomplete': row['incomplete']}), flush=True)
        manifest['status'] = 'finished_pending_manual_review'
    except Exception as error:
        manifest['status'] = 'failed'
        manifest['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        manifest['elapsed_seconds'] = time.monotonic() - started
        write_json(path, manifest)


if __name__ == '__main__':
    main()
