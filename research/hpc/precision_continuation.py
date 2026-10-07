"""Matched FP32 E/U/X optimization with an unchanged BF16 generation evaluator."""
import argparse
import gc
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import torch

from document_artifacts import raster_pdf_bytes, render_pdf, pdf_structure
from precision_preflight import configure_precision
from math_optimizer import enable_math_optimizer, verify_math_gate
from run_pilot import FINAL_TRANSFORMS, optimize, select, linear_mix, crossover, provisional_label
from torch_document import FrozenQwen, bounds, metrics, sha256, transform_bytes, write_json, exact_short_answer


class SplitPrecisionRunner:
    def __init__(self,optimizer,evaluator):
        self.optimizer=optimizer;self.evaluator=evaluator;self.device=optimizer.device
    def state(self,*args,**kwargs):return self.optimizer.state(*args,**kwargs)
    def loss(self,*args,**kwargs):return self.optimizer.loss(*args,**kwargs)
    def generate(self,*args,**kwargs):return self.evaluator.generate(*args,**kwargs)


def validate_inputs(args):
    gate=json.loads(args.preflight.read_text());previous=json.loads((args.previous_pilot/'manifest.json').read_text())
    prior_gate=json.loads(args.previous_preflight.read_text())
    if gate['status']!='passed' or not gate['reference_passed']:raise RuntimeError('Numerical reference failed')
    if gate.get('protocol') in ('math-sign-v1', 'math-sign-ulp-v1'):
        verify_math_gate(gate)
    for record in (gate,previous):
        if record['input_sha256']!=sha256(args.pages/'page-2.png') or record['prompts_sha256']!=sha256(args.prompts):
            raise RuntimeError('Input or prompt configuration mismatch')
    if prior_gate['model_config_sha256']!=gate['model_config_sha256'] or gate['model_config_sha256']!=sha256(args.model/'config.json'):
        raise RuntimeError('Model configuration mismatch')
    if prior_gate['input_module_sha256']!=sha256(Path(__file__).with_name('torch_document.py')):
        raise RuntimeError('Historical BF16 input implementation changed')
    if sha256(args.previous_preflight)!=previous['preflight_sha256']:raise RuntimeError('Previous preflight hash mismatch')
    return gate,previous


def evaluate_condition(runner,images,config,cache,condition,raw):
    hashes=[hashlib.sha256(np.asarray(im).tobytes()).hexdigest() for im in images]
    selector='Consider only the page headed "Game Specification". ' if len(images)>1 else ''
    rows=[];short={}
    for limit in (192,768,64):
        kind='utility' if limit==64 else 'task'
        for item in config['utility_test'] if kind=='utility' else config['test']:
            prompt=selector+item['prompt'];key=hashlib.sha256(json.dumps([hashes,prompt,limit]).encode()).hexdigest()
            file=cache/(key+'.json');reused=file.exists()
            if reused:row=json.loads(file.read_text())
            else:
                row=runner.generate(images,prompt,max_new_tokens=limit);write_json(file,row)
            row.update(condition=condition,kind=kind,question_id=item['id'],max_new_tokens=limit,
                       image_pixel_sha256s=hashes,response_cache_key=key,reused_identical_input_response=reused)
            if kind=='task':
                row.update(label=provisional_label(row),leakage_rubric=item['leakage_rubric'])
                if limit==192:short[item['id']]=row['response']
                else:row['short_response_is_prefix']=row['response'].startswith(short[item['id']])
            else:row.update(expected=item['target'],utility_match=not row['incomplete'] and exact_short_answer(row['response'],item['target']))
            raw.write(json.dumps(row,ensure_ascii=False)+'\n');raw.flush();rows.append(row)
    return rows


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('model','pages','native','prompts','previous-pilot','previous-preflight','preflight','output'):
        p.add_argument('--'+name,type=Path,required=True)
    args=p.parse_args();gate,previous=validate_inputs(args)
    if sha256(args.native)!='0ba974732c0c296d953a6483fc830c2ec7ae89c92dc2a857f76dc927672d08ed':raise RuntimeError('Native source changed')
    args.output.mkdir(parents=True,exist_ok=False)
    config=json.loads(args.prompts.read_text());pages=[Image.open(args.pages/f'page-{i}.png').convert('RGB') for i in range(1,8)]
    source=np.array(pages[1]);_,_,protected=bounds(source)
    report={'status':'optimizing','optimization_precision':'float32','generation_precision':'bfloat16',
            'seed':17,'iterations_per_arm':36,'epsilon_bytes':8,'selected':[],'response_rows':0,
            'input_sha256':sha256(args.pages/'page-2.png'),'prompts_sha256':sha256(args.prompts),
            'preflight_sha256':sha256(args.preflight),'previous_manifest_sha256':sha256(args.previous_pilot/'manifest.json'),
            'model_config_sha256':gate['model_config_sha256'],
            'evaluation_scope':'Reused diagnostic questions, not fresh held-out evidence. No added policy instructions.',
            'budget':{'updates':72,'policy_updates':60,'utility_updates':12,'parent_dev_candidates':14,'crossover_dev_candidates':15,'generations_per_dev_candidate':8},
            'conditions':[],'artifacts':[]}
    write_json(args.output/'manifest.json',report)
    optimizer=FrozenQwen(str(args.model));report['optimizer_dtypes']=configure_precision(optimizer,'float32')
    if gate.get('protocol') in ('math-sign-v1', 'math-sign-ulp-v1'):
        report['optimizer_execution'] = enable_math_optimizer(optimizer)
        report['comparison'] = 'Historical BF16/default SDPA versus FP32/math SDPA; precision and backend jointly changed.'
    write_json(args.output/'manifest.json',report)
    evaluator=FrozenQwen(str(args.model));report['evaluator_dtypes']=configure_precision(evaluator,'bfloat16')
    runner=SplitPrecisionRunner(optimizer,evaluator);parents={};selected=[]
    for arm in ('E','U'):
        name,pixels=optimize(runner,source,config,17,arm,args.output/f'{arm}-s17',36)
        parents[arm]=pixels;selected.append((f'FP32-{arm}-s17',pixels))
        report['selected'].append({'arm':arm,'checkpoint':name});write_json(args.output/'manifest.json',report)
    # Selection remains on the original BF16 evaluator, including crossover.
    directory=args.output/'X-s17';directory.mkdir();bank=[]
    for fraction in (.25,.5,.75):
        bank.append((f'linear-f{fraction}',linear_mix(parents['E'],parents['U'],fraction)))
        for seed in (17,29):
            for patch in (None,28):
                bank.append((f'patch{patch}-f{fraction}-s{seed}',crossover(parents['E'],parents['U'],fraction,seed=seed,patch_size=patch)))
    for name,pixels in bank:Image.fromarray(pixels).save(directory/(name+'.png'))
    name,pixels=select(evaluator,bank,config,directory);selected.append(('FP32-X-s17',pixels))
    report['selected'].append({'arm':'X','checkpoint':name});report['selection_frozen']=True
    report['peak_optimization_cuda_bytes']=torch.cuda.max_memory_allocated()
    del runner,optimizer;gc.collect();torch.cuda.empty_cache()
    final=args.output/'final';final.mkdir();cache=args.output/'cache';cache.mkdir();pdf=args.output/'pdf';pdf.mkdir()
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


if __name__=='__main__':main()
