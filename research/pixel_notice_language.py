"""Layer-at-a-time input VJP for the inspected Qwen3.5 language stack."""

import json
from functools import partial

import mlx.core as mx
from pixel_notice_vision import RecordedBlock


class RecordedLanguageBlock(RecordedBlock):
    @property
    def is_linear(self):
        return self.original.is_linear

    @property
    def self_attn(self):
        return self.original.self_attn


def language_input_vjp(language, ids, features, criterion):
    blocks = language.model.layers
    records = [RecordedLanguageBlock(block) for block in blocks]
    try:
        language.model.layers = records
        output = language(ids, **features)
        value = criterion(output.logits)
        mx.eval(value)
    finally:
        language.model.layers = blocks
    if not mx.array_equal(records[0].saved_input, features["inputs_embeds"]).item():
        raise ValueError("Language prefix no longer matches inspected embedding path")

    def tail(hidden):
        normalized = language.model.norm(hidden)
        logits = (
            language.model.embed_tokens.as_linear(normalized)
            if language.args.tie_word_embeddings
            else language.lm_head(normalized)
        )
        return criterion(logits)

    checked, gradient = mx.value_and_grad(tail)(records[-1].saved_output)
    mx.eval(checked, gradient)
    if abs(checked.item() - value.item()) > 1e-5:
        raise ValueError("Language tail differs from recorded forward")
    for index, record in enumerate(reversed(records)):
        _, (gradient,) = mx.vjp(
            partial(record.original, **record.saved_kwargs),
            [record.saved_input],
            [mx.stop_gradient(gradient)],
        )
        mx.eval(gradient)
        mx.clear_cache()
        if mx.get_active_memory() > 8 * 1024**3:
            raise RuntimeError("Layerwise language exceeds 8 GiB active-memory gate")
        if index % 4 == 0 or index + 1 == len(records):
            print(
                json.dumps(
                    {
                        "phase": "language_backward_progress",
                        "completed_blocks": index + 1,
                        "total_blocks": len(records),
                        "mlx_active_bytes": mx.get_active_memory(),
                    }
                ),
                flush=True,
            )
    return value, gradient
