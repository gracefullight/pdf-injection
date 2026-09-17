"""First-order, row-chunked input adjoint for unmasked self-attention.

The forward call remains MLX's original SDPA. No weights are changed. The
custom derivative is intended only for this frozen-receiver input experiment,
not parameter training or higher-order differentiation.
"""

import mlx.core as mx
import numpy as np


def row_chunked_attention(original, q, k, v, scale, chunk_size=128, **kwargs):
    @mx.custom_function
    def forward(query, key, value):
        return original(query, key, value, scale=scale, mask=None, **kwargs)

    @forward.vjp
    def adjoint(primals, cotangent, output):
        query, key, value = primals
        # Deliberately first-order CPU scratch arithmetic. Keeping these row
        # operations in MLX retained the enclosing VJP trace and exceeded the
        # measured native-page memory gate despite per-block evaluation.
        q32, k32, v32 = (np.array(x.astype(mx.float32)) for x in primals)
        do = np.array(cotangent.astype(mx.float32))
        if mx.get_active_memory() > 8 * 1024**3:
            raise RuntimeError(
                "Attention adjoint exceeds the 8 GiB MLX active-memory gate"
            )
        dq, dk, dv = np.zeros_like(q32), np.zeros_like(k32), np.zeros_like(v32)
        for start in range(0, query.shape[-2], chunk_size):
            end = min(start + chunk_size, query.shape[-2])
            qi, doi = q32[..., start:end, :], do[..., start:end, :]
            scores = (qi @ k32.swapaxes(-1, -2)) * scale
            probability = np.exp(scores - scores.max(axis=-1, keepdims=True))
            probability /= probability.sum(axis=-1, keepdims=True)
            dp = doi @ v32.swapaxes(-1, -2)
            ds = probability * (dp - np.sum(probability * dp, axis=-1, keepdims=True))
            dq[..., start:end, :] = (ds @ k32) * scale
            dk += (ds.swapaxes(-1, -2) @ qi) * scale
            dv += probability.swapaxes(-1, -2) @ doi
        return (
            mx.array(dq).astype(query.dtype),
            mx.array(dk).astype(key.dtype),
            mx.array(dv).astype(value.dtype),
        )

    return forward(q, k, v)


def install_attention_adjoint(chunk_size=128):
    """Install only in this process; return a restore callback for the caller."""
    original = mx.fast.scaled_dot_product_attention

    def dispatch(q, k, v, *, scale, mask=None, **kwargs):
        if mask is not None or q.shape != k.shape or k.shape != v.shape or q.ndim != 4:
            return original(q, k, v, scale=scale, mask=mask, **kwargs)
        if q.shape[-2] <= 256:
            return original(q, k, v, scale=scale, mask=mask, **kwargs)
        return row_chunked_attention(original, q, k, v, scale, chunk_size, **kwargs)

    mx.fast.scaled_dot_product_attention = dispatch

    def restore():
        mx.fast.scaled_dot_product_attention = original

    return restore
