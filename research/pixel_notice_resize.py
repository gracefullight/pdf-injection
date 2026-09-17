"""Pillow float bicubic adjoint; byte rounding/clipping still uses a surrogate.

The actual receiver forward is never replaced. Float-mode impulse responses
recover the installed Pillow's separable interpolation operator. This is not
the derivative of the discrete uint8 receiver, nor of its clipping boundaries.
"""

from functools import lru_cache

import numpy as np
from PIL import Image


def require_bicubic_processor(processor):
    """Allow only inspected Pillow paths, not arbitrary similarly named filters."""
    cls = type(processor)
    mlx_numpy = (
        cls.__module__ == "mlx_vlm.models.qwen3_vl.processing_qwen3_vl"
        and cls.__name__ == "Qwen3VLImageProcessor"
    )
    hf_pil = "Pil" in cls.__name__ and getattr(processor, "resample", None) == 3
    if not (mlx_numpy or hf_pil):
        raise ValueError("Bicubic adjoint requires an inspected Pillow processor")


@lru_cache(maxsize=4)
def axis_matrix(source_length, destination_length):
    if not 0 < source_length <= 4096 or not 0 < destination_length <= 4096:
        raise ValueError("Research resize dimensions must be within 1..4096")
    impulses = Image.fromarray(np.eye(source_length, dtype=np.float32))
    matrix = np.asarray(
        impulses.resize((destination_length, source_length), Image.Resampling.BICUBIC)
    ).T.copy()
    matrix.setflags(write=False)
    return matrix


def bicubic_input_vjp(cotangent, input_size):
    """Transpose the float-mode resize, taking PIL-style (width, height)."""
    cotangent = np.asarray(cotangent, dtype=np.float32)
    if cotangent.ndim != 3 or not np.isfinite(cotangent).all():
        raise ValueError("Expected finite HWC cotangent")
    width, height = input_size
    ay = axis_matrix(height, cotangent.shape[0])
    ax = axis_matrix(width, cotangent.shape[1])
    return np.stack(
        [ay.T @ cotangent[:, :, c] @ ax for c in range(cotangent.shape[2])], axis=-1
    )
