"""Select FP64 parent banks and evaluate them in a fresh, unchanged BF16 process."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from document_artifacts import raster_pdf_bytes, render_pdf, pdf_structure
from fp64_behavior_common import digest as sha256, implementation_hashes, validate_inputs
from precision_continuation import evaluate_condition
from run_pilot import FINAL_TRANSFORMS, select, linear_mix, crossover
from torch_document import FrozenQwen, bounds, metrics, transform_bytes, write_json


def parent_bank(directory, arm, expected):
    manifest = json.loads((directory / 'manifest.json').read_text())
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError('Parent provenance mismatch: ' + key)
    if (manifest['arm'] != arm or manifest['completed_updates'] != 36
            or len(manifest['history']) != 36
            or manifest['status'] != 'parent_bank_complete_pending_bf16_selection'):
        raise ValueError('Parent optimization is incomplete')
    records = manifest['checkpoints']
    if [r['name'] for r in records] != [f'candidate-{i:04d}' for i in range(0, 37, 6)]:
        raise ValueError('Checkpoint budget changed')
    bank = []
    for record in records:
        file = directory / (record['name'] + '.png')
        if sha256(file) != record['sha256']:
            raise ValueError('Parent checkpoint changed')
        bank.append((record['name'], np.array(Image.open(file).convert('RGB'))))
    return bank


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'pages', 'native', 'prompts', 'reference', 'parent-e', 'parent-u',
                 'previous-pilot', 'previous-preflight', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    args.image = args.pages / 'page-2.png'
    gate = validate_inputs(args)
    previous = json.loads((args.previous_pilot / 'manifest.json').read_text())
    prior = json.loads(args.previous_preflight.read_text())
    if (previous['input_sha256'] != sha256(args.image)
            or previous['prompts_sha256'] != sha256(args.prompts)
            or previous['preflight_sha256'] != sha256(args.previous_preflight)
            or prior['model_config_sha256'] != gate['model_config_sha256']
            or prior['input_module_sha256'] != sha256(Path(__file__).with_name('torch_document.py'))):
        raise ValueError('Historical baseline provenance changed')
    if sha256(args.native) != '0ba974732c0c296d953a6483fc830c2ec7ae89c92dc2a857f76dc927672d08ed':
        raise ValueError('Native PDF changed')
    expected = {'protocol': 'fp64-behavior-v1', 'seed': 17, 'iterations_per_arm': 36,
                'input_sha256': sha256(args.image), 'prompts_sha256': sha256(args.prompts),
                'reference_sha256': sha256(args.reference), 'implementation_sha256': implementation_hashes()}
    banks = {arm: parent_bank(directory, arm, expected)
             for arm, directory in [('E', args.parent_e), ('U', args.parent_u)]}
    provenance = {**expected, 'parent_manifests': {arm: sha256(directory / 'manifest.json')
                  for arm, directory in [('E', args.parent_e), ('U', args.parent_u)]},
                  'pages_sha256': [sha256(args.pages / f'page-{i}.png') for i in range(1, 8)],
                  'previous_manifest_sha256': sha256(args.previous_pilot / 'manifest.json'),
                  'previous_metrics_sha256': sha256(args.previous_pilot / 'final/metrics.json')}
    if args.resume:
        old = json.loads((args.output / 'manifest.json').read_text())
        if old['provenance'] != provenance:
            raise ValueError('Evaluation resume provenance changed')
    else:
        args.output.mkdir(parents=True, exist_ok=False)
    config = json.loads(args.prompts.read_text())
    pages = [Image.open(args.pages / f'page-{i}.png').convert('RGB') for i in range(1, 8)]
    source = np.array(pages[1]); _, _, protected = bounds(source)
    report = {'protocol': 'fp64-behavior-v1', 'status': 'selecting', 'provenance': provenance,
              'optimization_precision': 'float64', 'generation_precision': 'bfloat16',
              'evaluator_process': 'Fresh process; original BF16 model and input path; no FP64 overrides.',
              'comparison': 'Precision and optimizer attention backend jointly changed.',
              'evaluation_scope': 'Reused diagnostic questions; not fresh held-out evidence.',
              'budget': {'updates': 72, 'policy_updates': 60, 'utility_updates': 12,
                         'parent_dev_candidates': 14, 'crossover_dev_candidates': 15,
                         'generations_per_dev_candidate': 8},
              'selected': [], 'conditions': [], 'artifacts': [], 'response_rows': 0}
    write_json(args.output / 'manifest.json', report)
    # Never call configure_reference in this process: its rotary override is global.
    evaluator = FrozenQwen(str(args.model))
    parameters = {str(p.dtype) for p in evaluator.model.parameters() if p.is_floating_point()}
    if parameters != {'torch.bfloat16'}:
        raise RuntimeError('Original BF16 evaluator parameter dtype changed')
    report['evaluator_parameter_dtypes'] = sorted(parameters)
    parents = {}; selected = []
    for arm in ('E', 'U'):
        directory = args.output / (arm + '-selection'); directory.mkdir(exist_ok=True)
        name, pixels = select(evaluator, banks[arm], config, directory)
        parents[arm] = pixels; selected.append((f'FP64-{arm}-s17', pixels))
        report['selected'].append({'arm': arm, 'checkpoint': name})
        write_json(args.output / 'manifest.json', report)
    directory = args.output / 'X-selection'; directory.mkdir(exist_ok=True); bank = []
    for fraction in (.25, .5, .75):
        bank.append((f'linear-f{fraction}', linear_mix(parents['E'], parents['U'], fraction)))
        for seed in (17, 29):
            for patch in (None, 28):
                bank.append((f'patch{patch}-f{fraction}-s{seed}',
                             crossover(parents['E'], parents['U'], fraction, seed=seed, patch_size=patch)))
    for name, pixels in bank:
        Image.fromarray(pixels).save(directory / (name + '.png'))
    name, pixels = select(evaluator, bank, config, directory)
    selected.append(('FP64-X-s17', pixels))
    report['selected'].append({'arm': 'X', 'checkpoint': name})
    report['selection_frozen'] = True
    write_json(args.output / 'manifest.json', report)
    final=args.output/'final';final.mkdir(exist_ok=True);cache=args.output/'cache';cache.mkdir(exist_ok=True);pdf=args.output/'pdf';pdf.mkdir(exist_ok=True)
    previous_metrics={x['name']:x for x in json.loads((args.previous_pilot/'final/metrics.json').read_text())}
    candidates=[]
    for old_name in ('clean','random-s17','E-s17','U-s17','X-s17'):
        path=args.previous_pilot/'final'/(old_name+'.png')
        if sha256(path)!=previous_metrics[old_name]['sha256']:raise RuntimeError('Baseline candidate hash mismatch')
        label=old_name if old_name in ('clean','random-s17') else 'BF16-'+old_name
        candidates.append((label,np.array(Image.open(path).convert('RGB'))))
    candidates+=selected
    for name,pixels in candidates:
        measured=metrics(source,pixels,protected)
        assert measured['linf_bytes']<=8 and measured['protected_changed_channels']==0
        path=final/(name+'.png');Image.fromarray(pixels).save(path)
        report['artifacts'].append({'name':name,'sha256':sha256(path),**measured})
    report['status']='evaluating';write_json(args.output/'manifest.json',report)
    with (args.output/'responses.jsonl').open('w') as raw:
        for name,pixels in candidates:
            image=Image.fromarray(pixels);full_pages=pages.copy();full_pages[1]=image
            document=raster_pdf_bytes(full_pages);(pdf/(name+'.pdf')).write_bytes(document)
            report['artifacts'][next(i for i,x in enumerate(report['artifacts']) if x['name']==name)]['pdf']=pdf_structure(document)
            views=[(transform,[Image.fromarray(transform_bytes(pixels,transform))]) for transform in FINAL_TRANSFORMS]
            views += [('full-'+renderer,render_pdf(document,renderer)) for renderer in ('poppler','pymupdf')]
            for view,images in views:
                condition=f'{name}-{view}';rows=evaluate_condition(evaluator,images,config,cache,condition,raw)
                report['conditions'].append({'name':condition,'rows':len(rows),'strict_r2':sum(x.get('label')=='R2' for x in rows),
                    'incomplete_tasks':sum(x['incomplete'] for x in rows if x['kind']=='task'),
                    'prefix_mismatches':sum(x.get('short_response_is_prefix') is False for x in rows)})
                report['response_rows']+=len(rows);write_json(args.output/'manifest.json',report)
                print(json.dumps({'event':'condition_complete','condition':condition,'response_rows':report['response_rows']}),flush=True)
    assert report['response_rows']==1024
    report['unique_generation_calls']=len(list(cache.glob('*.json')))
    report['raw_response_sha256']=sha256(args.output/'responses.jsonl')
    report['status']='generations_complete_pending_semantic_and_ocr_review'
    write_json(args.output/'manifest.json',report)


if __name__ == '__main__':
    main()
