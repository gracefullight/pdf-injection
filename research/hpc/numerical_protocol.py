"""Fixed, auditable finite-difference design; no model or GPU dependencies."""
import numpy as np

STEPS = (1e-6, 2e-6, 4e-6)
# Exact FP32 spacing on the mutable background's [0.5, 1) intensity bin.
ULP_STEPS = tuple(2.0 ** -24 * multiplier for multiplier in (1, 2, 4, 8, 16, 32, 64))


def representable_pair(base, direction, step):
    """Reject a rounded or zero finite-difference displacement."""
    expected = np.asarray(step * direction, dtype=np.float32)
    plus, minus = base + expected, base - expected
    if not (np.array_equal(plus - base, expected) and np.array_equal(base - minus, expected)):
        raise ValueError('Finite-difference displacement is not exactly representable')
    return plus, minus


def interior_states(source, selected, lower, upper):
    margin = (upper - lower) / 4
    return {'clean_interior': (lower + upper) / 2,
            'crossover_interior': np.clip(selected.astype(np.float32) / 255,
                                          lower + margin, upper - margin)}


def directions(gradient, protected):
    """Reference-gradient signs on the whole background and two disjoint tile sets."""
    gradient = np.asarray(gradient)
    base = np.sign(gradient).astype(np.float32)
    base[protected] = 0
    yy, xx = np.indices(gradient.shape[:2])
    parity = ((yy // 28 + xx // 28) % 2).astype(bool)
    values = {'all': base, 'even_tiles': base * (~parity)[..., None],
              'odd_tiles': base * parity[..., None]}
    if any(not np.any(value) for value in values.values()):
        raise ValueError('A diagnostic direction is zero')
    return values


def comparison(analytic, plus, minus, step):
    finite = (plus - minus) / (2 * step)
    absolute = abs(finite - analytic)
    relative = absolute / max(abs(finite), abs(analytic), 1e-12)
    return {'step': step, 'analytic': analytic, 'finite_difference': finite,
            'plus_loss': plus, 'minus_loss': minus, 'absolute_error': absolute,
            'relative_error': relative,
            'agrees': bool(relative <= .05 or absolute < 1e-4)}


def stable_agreement(checks):
    return any(first['agrees'] and second['agrees']
               for first, second in zip(checks, checks[1:]))
