"""Provenance guards shared by FP64 optimization and fresh-process BF16 evaluation."""
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_reference(gate):
    if (gate.get('status') != 'audited_full_fp64_reference_passed'
            or not gate.get('reference_passed') or gate.get('scalar_checks_recomputed') != 96
            or gate.get('tensor_projections_reconstructed') != 12):
        raise ValueError('A fully audited FP64 reference is required')
    expected = {(s, p, n) for s in ('clean_interior', 'crossover_interior') for p in (0, 1)
                for n in ('all', 'even_tiles', 'odd_tiles')}
    seen = set()
    for shard in gate['shards']:
        report = shard['report']
        if shard['exit_status'] != 0 or not report['shard_passed']:
            raise ValueError('Incomplete FP64 shard')
        for row in report['checks']:
            key = (row['state'], row['train_prompt_index'], row['direction'])
            if key in seen or len(row['checks']) != 8 or not row['stable_agreement']:
                raise ValueError('Missing, duplicate or failed reference direction')
            seen.add(key)
    if seen != expected:
        raise ValueError('Reference grid is incomplete')


def validate_inputs(args):
    gate = json.loads(args.reference.read_text())
    validate_reference(gate)
    root = Path(__file__).parent
    for name, sha in gate['source_manifest'].items():
        if digest(root / name) != sha:
            raise ValueError('Reference source changed: ' + name)
    if digest(args.model / 'config.json') != gate['model_config_sha256']:
        raise ValueError('Model configuration changed')
    for shard in gate['shards']:
        report = shard['report']
        if report['input_sha256'] != digest(args.image) or report['prompts_sha256'] != digest(args.prompts):
            raise ValueError('Image or prompt fixture changed')
    return gate


def implementation_hashes():
    root = Path(__file__).parent
    names = ('fp64_behavior_common.py', 'optimize_fp64_behavior.py', 'evaluate_fp64_behavior.py',
             'run_pilot.py', 'torch_document.py', 'document_artifacts.py', 'precision_continuation.py',
             'crossover_document_perturbations.py', 'pixel_notice_render.py')
    # Historical helper files are staged beside the HPC runners.
    result = {}
    for name in names:
        path = root / name
        if not path.exists():
            path = root.parent / name
        result[name] = digest(path)
    return result
