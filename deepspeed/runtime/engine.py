from __future__ import annotations

from torch import nn


class DeepSpeedEngine(nn.Module):
    def __init__(self, *args, **kwargs):
        super().__init__()
        raise RuntimeError(
            "This bundled DeepSpeed stub only supports import-time compatibility for inference. "
            "Training is not supported in this package."
        )
