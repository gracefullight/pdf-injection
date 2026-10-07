"""Check CUDA computation and gradients through a frozen model, without downloads."""

import json
import os
import socket

import torch


def main():
    if not os.environ.get("PBS_JOBID"):
        raise RuntimeError("Run inside a PBS GPU allocation, not on the login node")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in this Python environment")

    # The exclusive-node wrapper explicitly reserves both GPUs. Otherwise
    # require the scheduler to restrict visibility to the one requested GPU.
    visible_count = torch.cuda.device_count()
    expected_count = int(os.environ.get("PDFI_EXPECTED_VISIBLE_GPUS", "1"))
    print(json.dumps({
        "phase": "device_visibility",
        "cuda_visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "pbs_gpufile": os.environ.get("PBS_GPUFILE"),
        "visible_device_count": visible_count,
        "expected_visible_device_count": expected_count,
    }), flush=True)
    if visible_count != expected_count:
        raise RuntimeError(
            "Visible GPU count differs from the declared allocation; resolve "
            "mapping before running computation on a shared node"
        )

    torch.manual_seed(17)
    device = torch.device("cuda:0")
    properties = torch.cuda.get_device_properties(device)
    model = torch.nn.Linear(16, 4, bias=False).to(device)
    model.requires_grad_(False)
    pixels = torch.randn(8, 16, device=device, requires_grad=True)
    output = model(pixels)
    loss = output.square().mean()
    loss.backward()
    torch.cuda.synchronize()

    gradient = pixels.grad
    if gradient is None or not torch.isfinite(gradient).all().item():
        raise RuntimeError("Input gradient is missing or non-finite")
    if not gradient.abs().sum().item() > 0:
        raise RuntimeError("Input gradient is zero")
    if any(parameter.grad is not None for parameter in model.parameters()):
        raise RuntimeError("Frozen model unexpectedly accumulated weight gradients")
    expected = 2 * output.detach() @ model.weight.detach() / output.numel()
    torch.testing.assert_close(gradient, expected, rtol=1e-4, atol=1e-6)

    print(json.dumps({
        "status": "PASS",
        "scope": "CUDA float32 forward and input backward through a frozen linear layer",
        "pbs_job_id": os.environ["PBS_JOBID"],
        "hostname": socket.gethostname(),
        "torch_version": torch.__version__,
        "torch_cuda_version": torch.version.cuda,
        "gpu_name": properties.name,
        "gpu_memory_bytes": properties.total_memory,
        "compute_capability": list(torch.cuda.get_device_capability(device)),
        "loss": loss.item(),
        "input_gradient_abs_max": gradient.abs().max().item(),
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(device),
    }, indent=2))


if __name__ == "__main__":
    main()
