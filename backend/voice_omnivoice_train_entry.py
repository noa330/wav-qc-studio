from __future__ import annotations

import os
import shutil

from voice_omnivoice_worker_patch import sample_length


_SAVED_MODEL_STEPS: set[int] = set()


def patch_windows_length_grouping() -> None:
    if os.name != "nt":
        return

    from omnivoice.data import batching

    original_init = batching.StreamLengthGroupDataset.__init__
    if getattr(original_init, "_speedpatch_wrapped", False):
        return

    def patched_init(self, *args, **kwargs):
        length_fn = kwargs.get("length_fn")
        if length_fn is not None and getattr(length_fn, "__name__", "") == "<lambda>":
            kwargs["length_fn"] = sample_length
        original_init(self, *args, **kwargs)

    patched_init._speedpatch_wrapped = True  # type: ignore[attr-defined]
    batching.StreamLengthGroupDataset.__init__ = patched_init


def patch_model_only_checkpoint_save() -> None:
    from omnivoice.training import checkpoint as checkpoint_module

    def save_model_only_checkpoint(accelerator, model, tokenizer, output_dir: str, step: int, keep_last_n: int = 3):
        checkpoint_dir = os.path.join(output_dir, f"checkpoint-{step}")
        os.makedirs(checkpoint_dir, exist_ok=True)

        if step not in _SAVED_MODEL_STEPS:
            unwrap_model = accelerator.unwrap_model(model)
            unwrap_model.save_pretrained(
                checkpoint_dir,
                is_main_process=accelerator.is_main_process,
                save_function=accelerator.save,
            )
            _SAVED_MODEL_STEPS.add(step)

        if accelerator.is_main_process:
            tokenizer.save_pretrained(checkpoint_dir)
            checkpoints = [
                name
                for name in os.listdir(output_dir)
                if name.startswith("checkpoint-") and os.path.isdir(os.path.join(output_dir, name))
            ]
            checkpoints.sort(key=lambda name: int(name.split("-")[-1]))
            if keep_last_n > 0 and len(checkpoints) > keep_last_n:
                for name in checkpoints[:-keep_last_n]:
                    shutil.rmtree(os.path.join(output_dir, name), ignore_errors=True)

    checkpoint_module.save_checkpoint = save_model_only_checkpoint


def main() -> None:
    patch_windows_length_grouping()
    if os.environ.get("OMNIVOICE_MODEL_ONLY_CHECKPOINT", "").strip().lower() in {"1", "true", "yes", "on"}:
        patch_model_only_checkpoint_save()
    from omnivoice.cli.train import main as train_main

    train_main()


if __name__ == "__main__":
    main()
