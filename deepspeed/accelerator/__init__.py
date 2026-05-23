from __future__ import annotations


class _DummyAccelerator:
    def communication_backend_name(self) -> str:
        return "gloo"



def get_accelerator() -> _DummyAccelerator:
    return _DummyAccelerator()
