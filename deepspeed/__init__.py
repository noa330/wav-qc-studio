"""A tiny inference-only stub for packages that import deepspeed at module import time.

This project only uses Resemble Enhance for inference on Windows. The upstream package
imports deepspeed in training modules even when only inference is needed, so this stub
provides the minimal surface required for import-time compatibility.
"""

from __future__ import annotations


class DeepSpeedConfig:
    def __init__(self, config=None, *args, **kwargs):
        self.config = config
        self.args = args
        self.kwargs = kwargs



def init_distributed(*args, **kwargs):
    return None
