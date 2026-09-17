"""Calibrated surrogate for one Poppler full-page RGB rendering configuration.

Observed configuration: Poppler 26.08.0, 612x792 pt image-only page, 816x1056
RGB image, 96 DPI. This models expansion to W+1/H+1 followed by page clipping.
It is NOT a general PDF renderer, and must pass real-render parity for every
new geometry/renderer before use. No model-response behavior is implied.
"""

import numpy as np
from PIL import Image


def coordinates(length):
    # Match sequential double-precision coordinate accumulation, not i * step.
    position = np.concatenate(
        ([0.0], np.cumsum(np.full(length - 1, length / (length + 1))))
    )
    lower = position.astype(np.intp)
    return lower, np.minimum(lower + 1, length - 1), position - lower


def interpolate(values, *, quantize):
    """Separable interpolation; optional byte truncation after each axis."""
    source = np.asarray(values, dtype=np.float64)
    height, width, channels = source.shape
    if channels != 3 or height < 1 or width < 1:
        raise ValueError("Expected a nonempty HxWx3 RGB array")
    left, right, fx = coordinates(width)
    row = (
        source[:, left] * (1 - fx[None, :, None]) + source[:, right] * fx[None, :, None]
    )
    if quantize:
        row = np.floor(row)
    top, bottom, fy = coordinates(height)
    result = row[top] * (1 - fy[:, None, None]) + row[bottom] * fy[:, None, None]
    return np.floor(result) if quantize else result


def render(image):
    if image.mode != "RGB":
        raise ValueError("Use an opaque RGB image")
    return Image.fromarray(interpolate(image, quantize=True).astype(np.uint8))


def input_vjp(cotangent):
    """Exact adjoint of interpolation, STE approximation through byte truncation.

    This is NOT the derivative of the discontinuous actual byte-valued renderer.
    Any proposed candidate must still improve the actual forward objective.
    """
    gradient = np.asarray(cotangent, dtype=np.float64)
    height, width, channels = gradient.shape
    if channels != 3 or height < 1 or width < 1:
        raise ValueError("Expected a nonempty HxWx3 RGB cotangent")
    top, bottom, fy = coordinates(height)
    row_gradient = np.zeros_like(gradient)
    np.add.at(row_gradient, top, gradient * (1 - fy[:, None, None]))
    np.add.at(row_gradient, bottom, gradient * fy[:, None, None])
    left, right, fx = coordinates(width)
    transposed = np.zeros((width, height, channels), dtype=np.float64)
    np.add.at(
        transposed, left, (row_gradient * (1 - fx[None, :, None])).transpose(1, 0, 2)
    )
    np.add.at(transposed, right, (row_gradient * fx[None, :, None]).transpose(1, 0, 2))
    return transposed.transpose(1, 0, 2)
