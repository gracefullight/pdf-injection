"""Validate and summarize a completed policy-delivery diagnostic; no model calls."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path


def summarize(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest['status'] != 'finished_pending_manual_review':
        raise ValueError('Wait for a completed generation manifest')
    raw = (directory / 'responses.jsonl').read_bytes()
    rows = [json.loads(line) for line in raw.splitlines()]
    if len(rows) != manifest['expected_responses'] or len(rows) != manifest['completed_responses']:
        raise ValueError('Response count differs from the manifest')
    indexed = {}
    groups = {}
    for row in rows:
        key = (row['scope'], row['selector'], row['channel'], row['question_id'], row['max_new_tokens'])
        if key in indexed:
            raise ValueError('Duplicate response key')
        indexed[key] = row
        cell = (row['scope'], row['selector'], row['channel'], row['max_new_tokens'])
        groups.setdefault(cell, []).append(row)
    cells = []
    for key, items in groups.items():
        if len(items) != 6:
            raise ValueError('A cell does not contain six paired questions')
        cells.append(dict(zip(('scope', 'selector', 'channel', 'max_new_tokens'), key),
                          responses=len(items), incomplete=sum(r['incomplete'] for r in items),
                          labels=dict(Counter(r['provisional_label'] for r in items)),
                          total_new_tokens=sum(r['new_tokens'] for r in items)))
    lengths = []
    for key, short in indexed.items():
        if key[-1] != 192:
            continue
        long = indexed[key[:-1] + (768,)]
        lengths.append({'scope': key[0], 'selector': key[1], 'channel': key[2],
                        'question_id': key[3], 'short_incomplete': short['incomplete'],
                        'long_incomplete': long['incomplete'],
                        'short_response_is_prefix': long.get('short_response_is_prefix'),
                        'short_label': short['provisional_label'], 'long_label': long['provisional_label']})
    controls = {'text_policy': 'clean', 'inline_policy': 'inline_blank',
                'separate_policy': 'separate_blank'}
    contrasts = []
    for scope in manifest['scopes']:
        for selector in manifest['selectors']:
            for channel, control in controls.items():
                for limit in manifest['token_limits']:
                    selected = [r for k, r in indexed.items() if k[:3] == (scope, selector, channel) and k[-1] == limit]
                    reference = [indexed[(scope, selector, control, r['question_id'], limit)] for r in selected]
                    contrasts.append({'scope': scope, 'selector': selector, 'policy': channel,
                        'control': control, 'max_new_tokens': limit,
                        'policy_R2': sum(r['provisional_label'] == 'R2' for r in selected),
                        'control_R2': sum(r['provisional_label'] == 'R2' for r in reference),
                        'policy_incomplete': sum(r['incomplete'] for r in selected),
                        'control_incomplete': sum(r['incomplete'] for r in reference),
                        'paired_questions': len(selected)})
    result = {'status': 'summarized_pending_manual_review', 'responses': len(rows),
              'response_sha256': hashlib.sha256(raw).hexdigest(), 'cells': cells,
              'policy_control_contrasts': contrasts, 'length_pairs': lengths,
              'labels_are_provisional': True,
              'note': 'Paired repeated questions on one document; not independent population samples.'}
    (directory / 'analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    (directory / 'responses.jsonl.gz').write_bytes(gzip.compress(raw, mtime=0))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    result = summarize(args.directory)
    print(json.dumps({'responses': result['responses'], 'sha256': result['response_sha256']}))
