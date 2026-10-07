"""Validate the unchanged smooth Qwen input path before FP32 pixel optimization."""
import argparse
import gc
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import torch

from numerical_protocol import STEPS, ULP_STEPS, comparison, directions, interior_states, stable_agreement, representable_pair
from torch_document import FrozenQwen, bounds, metrics, quantize, sha256, write_json


def array_hash(value):
    return hashlib.sha256(np.asarray(value,dtype=np.float32).tobytes()).hexdigest()


def configure_precision(runner, precision):
    torch.backends.cuda.matmul.allow_tf32=False
    torch.backends.cudnn.allow_tf32=False
    runner.model.to(dtype=torch.float32 if precision=='float32' else torch.bfloat16)
    runner.model.requires_grad_(False)
    return {'requested':precision,'parameter_dtypes':sorted({str(p.dtype) for p in runner.model.parameters()}),
            'tf32_matmul':torch.backends.cuda.matmul.allow_tf32,
            'tf32_cudnn':torch.backends.cudnn.allow_tf32,
            'attention_implementation':runner.model.config._attn_implementation}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('model','image','selected','prompts','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--math-optimizer', action='store_true')
    p.add_argument('--step-grid', choices=('original', 'float32-ulp'), default='original')
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=False)
    if args.step_grid == 'float32-ulp' and not args.math_optimizer:
        p.error('The ULP diagnostic requires math optimization')
    steps = ULP_STEPS if args.step_grid == 'float32-ulp' else STEPS
    config=json.loads(args.prompts.read_text());source=np.array(Image.open(args.image).convert('RGB'))
    selected=np.array(Image.open(args.selected).convert('RGB'));lo,hi,protected=bounds(source)
    states=interior_states(source,selected,lo,hi)
    np.savez_compressed(args.output/'states.npz',**states)
    report={'status':'running','input_sha256':sha256(args.image),'selected_sha256':sha256(args.selected),
            'prompts_sha256':sha256(args.prompts),'model_config_sha256':sha256(args.model/'config.json'),
            'steps':list(steps),'directions':'FP32 gradient sign: all mutable pixels, even 28px tiles, odd 28px tiles; identical saved directions reused for BF16.',
            'precision_order':['float32','bfloat16'],'checks':[],'saved_byte_probes':[],'dtype_records':[]}
    report['protocol'] = 'math-sign-v1' if args.math_optimizer else 'original-default-sdpa'
    if args.step_grid == 'float32-ulp':
        report['protocol'] = 'math-sign-ulp-v1'
        report['step_design'] = '1,2,4,8,16,32,64 FP32 ULPs on [0.5,1); every actual displacement checked exactly; unchanged acceptance tolerance.'
    write_json(args.output/'report.json',report)
    direction_bank={};saved_proposals=[]
    for precision in report['precision_order']:
        runner=FrozenQwen(str(args.model));report['dtype_records'].append(configure_precision(runner,precision))
        if args.math_optimizer and precision == 'float32':
            from math_optimizer import enable_math_optimizer
            report['optimizer_execution'] = enable_math_optimizer(runner)
        for state_name,base in states.items():
            for pi,prompt in enumerate(config['train'][:2]):
                task=runner.state(Image.fromarray(source),prompt,config['target'])
                value=torch.tensor(base,device=runner.device,requires_grad=True)
                loss=runner.loss(value,task);loss.backward();before=float(loss.detach())
                grad=value.grad.detach().float().cpu().numpy()
                if not np.isfinite(grad).all() or not np.any(grad):raise RuntimeError('Invalid input gradient')
                if any(p.grad is not None for p in runner.model.parameters()):raise RuntimeError('Model weights received gradients')
                key=(state_name,pi)
                if precision=='float32':
                    direction_bank[key]=directions(grad,protected)
                    np.savez_compressed(args.output/f'directions-{state_name}-{pi}.npz',**direction_bank[key])
                del loss,value
                for name,direction in direction_bank[key].items():
                    analytic=float(np.sum(grad.astype(np.float64)*direction))
                    checks=[]
                    with torch.no_grad():
                        for h in steps:
                            if args.step_grid == 'float32-ulp':
                                plus, minus = representable_pair(base, direction, h)
                            else:
                                plus=base+h*direction;minus=base-h*direction
                            assert np.all(plus<=hi) and np.all(plus>=lo) and np.all(minus<=hi) and np.all(minus>=lo)
                            pl=float(runner.loss(torch.tensor(plus,device=runner.device),task))
                            ml=float(runner.loss(torch.tensor(minus,device=runner.device),task))
                            checks.append(comparison(analytic,pl,ml,h))
                    row={'precision':precision,'state':state_name,'train_prompt_index':pi,
                         'direction':name,'state_sha256':array_hash(base),'direction_sha256':array_hash(direction),
                         'base_loss':before,'checks':checks,'stable_agreement':stable_agreement(checks)}
                    report['checks'].append(row);write_json(args.output/'report.json',report)
                    print(json.dumps({'event':'direction_check',**{k:row[k] for k in ('precision','state','train_prompt_index','direction','stable_agreement')},'relative_errors':[x['relative_error'] for x in checks]}),flush=True)
        if precision=='float32' and all(x['stable_agreement'] for x in report['checks']):
            for pi,prompt in enumerate(config['train'][:2]):
                task=runner.state(Image.fromarray(source),prompt,config['target'])
                value=torch.tensor(source.astype(np.float32)/255,device=runner.device,requires_grad=True)
                loss=runner.loss(value,task);loss.backward();gradient=value.grad.detach().cpu().numpy()
                for step in (1,2,4):
                    candidate=quantize(np.clip(source.astype(np.float32)/255-step/255*np.sign(gradient),lo,hi))
                    measured=metrics(source,candidate,protected)
                    assert measured['linf_bytes']<=8 and measured['protected_changed_channels']==0
                    filename=f'proposal-p{pi}-step{step}.png';Image.fromarray(candidate).save(args.output/filename)
                    saved_proposals.append((pi,step,candidate,filename,measured))
                del loss,value
        else:
            with torch.no_grad():
                for pi,step,candidate,filename,measured in saved_proposals:
                    task=runner.state(Image.fromarray(source),config['train'][pi],config['target'])
                    baseline=float(runner.loss(torch.tensor(source.astype(np.float32)/255,device=runner.device),task))
                    actual=float(runner.loss(torch.tensor(candidate.astype(np.float32)/255,device=runner.device),task))
                    report['saved_byte_probes'].append({'train_prompt_index':pi,'step_bytes':step,'filename':filename,
                        'sha256':sha256(args.output/filename),'bf16_clean_loss':baseline,'bf16_proposal_loss':actual,
                        'improved':actual<baseline,**measured})
        report.setdefault('peak_cuda_memory_bytes',{})[precision]=torch.cuda.max_memory_allocated()
        del runner,task;gc.collect();torch.cuda.empty_cache();torch.cuda.reset_peak_memory_stats()
    reference=[x for x in report['checks'] if x['precision']=='float32']
    report['reference_passed']=len(reference)==12 and all(x['stable_agreement'] for x in reference)
    report['status']='passed' if report['reference_passed'] else 'failed_numerical_reference'
    report['scope']='Smooth identity only; no derivative-accuracy claim for saved-byte, JPEG, resize or PDF BPDA. Byte-proposal improvement is an outcome, not the numerical gate.'
    write_json(args.output/'report.json',report)
    print(json.dumps({'status':report['status'],'checks':len(report['checks'])}),flush=True)
    if not report['reference_passed']:raise SystemExit(2)


if __name__=='__main__':main()
