"""Recompute frozen evaluation blocks to bound diagnostic activation memory."""
from functools import wraps

import torch
from torch.utils.checkpoint import checkpoint


def checkpoint_block(block, *, context_fn=None):
    """Keep eval mode and weights unchanged; recompute activations in backward."""
    original = block.forward

    @wraps(original)
    def forward(*args, **kwargs):
        if not torch.is_grad_enabled():
            return original(*args, **kwargs)
        options = {} if context_fn is None else {'context_fn': context_fn}
        return checkpoint(original, *args, use_reentrant=False, **options, **kwargs)

    block.forward = forward


def checkpoint_qwen(runner, *, context_fn=None):
    blocks = list(runner.model.visual.blocks) + list(runner.model.model.layers)
    if any(block.training for block in blocks):
        raise ValueError('Diagnostic checkpointing requires evaluation mode')
    for block in blocks:
        checkpoint_block(block, context_fn=context_fn)
    return len(blocks)
