"""First-order layerwise input VJP for the frozen Qwen2.5 vision tower.

Uses the installed tower's original forward and blocks. Recomputes and
materializes only each block's input, then reverses one block at a time.
"""

import json
from functools import partial

import mlx.core as mx
from mlx import nn


class RecordedBlock(nn.Module):
    def __init__(self, original):
        super().__init__()
        self.original = original

    def __call__(self, x, **kwargs):
        self.saved_input = mx.stop_gradient(x)
        self.saved_kwargs = kwargs
        mx.eval(self.saved_input)
        self.saved_output = mx.stop_gradient(self.original(self.saved_input, **kwargs))
        mx.eval(self.saved_output)
        return self.saved_output


def layerwise_vision_vjp(tower, grid, pixels, cotangent):
    original_blocks = tower.blocks
    records = [RecordedBlock(block) for block in original_blocks]
    try:
        tower.blocks = records
        recorded_output = tower(
            mx.stop_gradient(pixels), grid, output_hidden_states=False
        )
        mx.eval(recorded_output)
    finally:
        tower.blocks = original_blocks

    window_index, _ = tower.get_window_index(grid)
    reverse = mx.argsort(window_index, axis=0)
    _, (gradient,) = mx.vjp(
        lambda h: tower.merger(h)[reverse, :],
        [records[-1].saved_output],
        [cotangent],
    )
    mx.eval(gradient)
    for reverse_index, record in enumerate(reversed(records)):
        _, (gradient,) = mx.vjp(
            partial(record.original, **record.saved_kwargs),
            [record.saved_input],
            [mx.stop_gradient(gradient)],
        )
        mx.eval(gradient)
        if mx.get_active_memory() > 8 * 1024**3:
            raise RuntimeError("Layerwise vision exceeds 8 GiB MLX active-memory gate")
        if reverse_index % 8 == 0 or reverse_index + 1 == len(records):
            print(
                json.dumps(
                    {
                        "phase": "vision_backward_progress",
                        "completed_blocks": reverse_index + 1,
                        "total_blocks": len(records),
                        "mlx_active_bytes": mx.get_active_memory(),
                    }
                ),
                flush=True,
            )

    def prefix(x):
        hidden = tower.patch_embed(x)
        count = hidden.shape[0]
        return hidden.reshape(
            count // tower.spatial_merge_unit, tower.spatial_merge_unit, -1
        )[window_index, :, :].reshape(count, -1)

    _, (gradient,) = mx.vjp(prefix, [pixels], [mx.stop_gradient(gradient)])
    mx.eval(gradient)
    return gradient
