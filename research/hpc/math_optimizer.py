"""Math SDPA for FP32 optimization, including checkpoint recomputation."""
from functools import wraps
from pathlib import Path

from torch.nn.attention import SDPBackend, sdpa_kernel

from diagnostic_checkpoint import checkpoint_qwen
from torch_document import sha256


def math_contexts():
    # Backward can happen after loss() has returned. Recompute must keep math SDPA.
    return sdpa_kernel(SDPBackend.MATH), sdpa_kernel(SDPBackend.MATH)


def math_loss(original):
    @wraps(original)
    def loss(*args, **kwargs):
        with sdpa_kernel(SDPBackend.MATH):
            return original(*args, **kwargs)
    return loss


def implementation_hashes():
    root = Path(__file__).parent
    return {name: sha256(root / name) for name in
            ('math_optimizer.py', 'diagnostic_checkpoint.py', 'torch_document.py')}


def enable_math_optimizer(runner):
    blocks = checkpoint_qwen(runner, context_fn=math_contexts)
    runner.loss = math_loss(runner.loss)
    return {'backend': 'math', 'checkpointed_blocks': blocks,
            'recompute_backend': 'math', 'implementation_sha256': implementation_hashes()}


def verify_math_gate(gate):
    record = gate.get('optimizer_execution', {})
    if (record.get('backend') != 'math' or record.get('recompute_backend') != 'math'
            or record.get('implementation_sha256') != implementation_hashes()):
        raise RuntimeError('Math optimizer implementation does not match numerical gate')
