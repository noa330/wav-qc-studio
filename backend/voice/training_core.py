import json
import contextlib
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


LogFn = Callable[[str], None]


VOICE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = VOICE_DIR.parent
APP_ROOT = BACKEND_DIR.parent
PROJECT_ROOT = APP_ROOT / "training"
VENDOR_DIR = PROJECT_ROOT / "vendor"
REPOS_DIR = VENDOR_DIR / "repos"
HF_DIR = VENDOR_DIR / "hf"
RUNTIME_DIR = PROJECT_ROOT / "runtime"
CACHE_DIR = PROJECT_ROOT / "cache"
WORK_DIR = PROJECT_ROOT / "work"

GPT_REPO = REPOS_DIR / "GPT-SoVITS"
OMNI_REPO = REPOS_DIR / "OmniVoice"
GPT_HF = HF_DIR / "GPT-SoVITS"
OMNI_HF = HF_DIR / "OmniVoice"

if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from backend.console_ui_core import LiveConsoleLine, prepare_for_regular_output
from backend.downloads import download_url_to_path, is_download_complete
from backend.training.checkpoints import checkpoint_number, checkpoints, newest_file
from backend.training.config import (
    BLOCKED_NETWORK_ENV_KEYS,
    GPT_CODE_URL,
    GPT_CONDA_ENV_NAME,
    GPT_HF_REPO_ID,
    GPT_PRETRAINED,
    GPT_REQUIREMENTS_STAMP,
    GPT_VERSIONS,
    MINICONDA_URL,
    OMNI_CODE_URL,
    OMNI_HF_REPO_ID,
    OMNI_OFFICIAL_DEPS_STAMP,
)
from backend.training.datasets import (
    infer_gsv_wav_dir,
    normalize_gsv_list_file,
    normalize_omnivoice_jsonl_file,
    parse_gsv_list as parse_gsv_list_file,
    prepare_omnivoice_input_file,
    resolve_input_file as resolve_input_file_from_path,
    write_omnivoice_jsonl_from_gsv,
)
from backend.training.errors import ToolError
from backend.training.gpt_configs import (
    apply_gpt_train_options_config,
    gpt_model_path_for,
    write_gpt_config_file,
    write_sovits_config_file,
)
from backend.training.omnivoice_checkpoints import (
    count_webdataset_manifest_shards,
    finalize_omnivoice_model_checkpoint_for,
    omnivoice_checkpoint_dirs_for,
    omnivoice_checkpoint_written_after_for,
    relative_arg,
    rewrite_webdataset_manifest_for_windows_file,
    valid_omnivoice_weight_file_for,
)
from backend.training.omnivoice_configs import default_omnivoice_train_options, write_omnivoice_train_configs_file

DEFAULT_LIST = ""
DEFAULT_OMNI_JSONL = ""

GPT_RUNTIME_SCRIPT = PROJECT_ROOT / "install_gpt_sovits_runtime.ps1"
GPT_RUNTIME_MARKER = GPT_REPO / ".gpt_sovits_runtime.json"


def configure_tool_root(tool_root: Path | str) -> None:
    global PROJECT_ROOT, VENDOR_DIR, REPOS_DIR, HF_DIR, RUNTIME_DIR, CACHE_DIR, WORK_DIR
    global GPT_REPO, OMNI_REPO, GPT_HF, OMNI_HF, GPT_RUNTIME_SCRIPT, GPT_RUNTIME_MARKER

    PROJECT_ROOT = Path(tool_root).resolve()
    VENDOR_DIR = PROJECT_ROOT / "vendor"
    REPOS_DIR = VENDOR_DIR / "repos"
    HF_DIR = VENDOR_DIR / "hf"
    RUNTIME_DIR = PROJECT_ROOT / "runtime"
    CACHE_DIR = PROJECT_ROOT / "cache"
    WORK_DIR = PROJECT_ROOT / "work"
    GPT_REPO = REPOS_DIR / "GPT-SoVITS"
    OMNI_REPO = REPOS_DIR / "OmniVoice"
    GPT_HF = HF_DIR / "GPT-SoVITS"
    OMNI_HF = HF_DIR / "OmniVoice"
    GPT_RUNTIME_SCRIPT = PROJECT_ROOT / "install_gpt_sovits_runtime.ps1"
    GPT_RUNTIME_MARKER = GPT_REPO / ".gpt_sovits_runtime.json"

@dataclass
class GptRunResult:
    exp_dir: Path
    semantic_path: Path
    name2text_path: Path
    gpt_checkpoints: list[Path]
    sovits_checkpoints: list[Path]


def log_print(message: str) -> None:
    print(message, flush=True)


def ensure_project_dirs() -> None:
    for path in (VENDOR_DIR, REPOS_DIR, HF_DIR, RUNTIME_DIR, CACHE_DIR, WORK_DIR):
        path.mkdir(parents=True, exist_ok=True)


def gpt_sovits_nltk_data_dir(py: Optional[Path] = None) -> Path:
    if py is not None and py.exists():
        return python_sys_prefix(py) / "nltk_data"
    env_prefix = gpt_conda_env_prefix_if_exists()
    if env_prefix is not None:
        return env_prefix / "nltk_data"
    return CACHE_DIR / "nltk_data"


def gpt_miniconda_dir() -> Path:
    return GPT_REPO / ".miniconda3"


def gpt_conda_exe() -> Path:
    if os.name == "nt":
        return gpt_miniconda_dir() / "Scripts" / "conda.exe"
    return gpt_miniconda_dir() / "bin" / "conda"


def gpt_conda_env_prefix() -> Path:
    return GPT_REPO / ".conda"


def gpt_conda_python_path() -> Path:
    return gpt_conda_env_prefix() / ("python.exe" if os.name == "nt" else "bin/python")


def gpt_conda_env_prefix_if_exists() -> Optional[Path]:
    env_dir = gpt_conda_env_prefix()
    py = gpt_conda_python_path()
    if py.exists():
        return env_dir
    try:
        data = json.loads(GPT_RUNTIME_MARKER.read_text(encoding="utf-8"))
        prefix = Path(str(data.get("prefix", "")))
        marker_py = prefix / ("python.exe" if os.name == "nt" else "bin/python")
        if prefix == env_dir and marker_py.exists():
            return prefix
    except Exception:
        pass
    return None


def project_env(extra: Optional[dict[str, str]] = None) -> dict[str, str]:
    ensure_project_dirs()
    env = os.environ.copy()
    cache_map = {
        "HF_HOME": CACHE_DIR / "huggingface",
        "HF_HUB_CACHE": CACHE_DIR / "huggingface" / "hub",
        "HUGGINGFACE_HUB_CACHE": CACHE_DIR / "huggingface" / "hub",
        "HF_XET_CACHE": CACHE_DIR / "huggingface" / "xet",
        "TRANSFORMERS_CACHE": CACHE_DIR / "huggingface" / "transformers",
        "TORCH_HOME": CACHE_DIR / "torch",
        "XDG_CACHE_HOME": CACHE_DIR / "xdg",
        "PIP_CACHE_DIR": CACHE_DIR / "pip",
        "UV_CACHE_DIR": CACHE_DIR / "uv",
        "NLTK_DATA": gpt_sovits_nltk_data_dir(),
    }
    for key, value in cache_map.items():
        value.mkdir(parents=True, exist_ok=True)
        env[key] = str(value)
    tmp_dir = CACHE_DIR / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    env["TMP"] = str(tmp_dir)
    env["TEMP"] = str(tmp_dir)
    for key in list(env):
        if key.upper() in BLOCKED_NETWORK_ENV_KEYS:
            env.pop(key, None)
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    env["HF_HUB_DISABLE_XET"] = "1"
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PIP_NO_CLEAN"] = "1"
    env["PIP_PROGRESS_BAR"] = "on"
    env["CONDA_PLUGINS_AUTO_ACCEPT_TOS"] = "yes"
    env["TOKENIZERS_PARALLELISM"] = "false"
    pythonpath_parts = [str(GPT_REPO / "GPT_SoVITS"), str(GPT_REPO)]
    if env.get("PYTHONPATH"):
        pythonpath_parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    path_parts = [str(GPT_REPO)]
    gpt_env_prefix = gpt_conda_env_prefix_if_exists()
    if gpt_env_prefix is not None:
        path_parts.extend([str(gpt_env_prefix), str(gpt_env_prefix / "Scripts"), str(gpt_env_prefix / "Library" / "bin")])
    path_parts.append(env.get("PATH", ""))
    env["PATH"] = os.pathsep.join(part for part in path_parts if part)
    if extra:
        env.update({k: str(v) for k, v in extra.items()})
    return env


@contextlib.contextmanager
def clean_network_env():
    saved: dict[str, str] = {}
    for key in list(os.environ):
        if key.upper() in BLOCKED_NETWORK_ENV_KEYS:
            saved[key] = os.environ.pop(key)
    try:
        yield
    finally:
        for key, value in saved.items():
            os.environ[key] = value


def run_stream(
    args: list[str],
    cwd: Path,
    log: LogFn = log_print,
    env: Optional[dict[str, str]] = None,
    idle_timeout: int = 900,
    visible_terminal: bool = False,
) -> None:
    log("> " + " ".join(f'"{a}"' if " " in a else a for a in args))
    if visible_terminal and os.name == "nt":
        log("[terminal] opening a separate native console for live command output")
        creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        proc = subprocess.Popen(
            args,
            cwd=str(cwd),
            env=env or project_env(),
            creationflags=creationflags,
        )
        proc.wait()
        if proc.returncode != 0:
            raise ToolError(f"Command failed with exit code {proc.returncode}: {args}")
        return

    proc = subprocess.Popen(
        args,
        cwd=str(cwd),
        env=env or project_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    output_queue: queue.Queue[Optional[str]] = queue.Queue()

    def reader() -> None:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(1)
            if chunk == "":
                break
            output_queue.put(chunk)
        output_queue.put(None)

    threading.Thread(target=reader, daemon=True).start()
    last_output = time.monotonic()
    saw_eof = False
    live_line = LiveConsoleLine()
    line_buffer = ""
    live_active = False

    def flush_regular_line() -> None:
        nonlocal line_buffer, live_active
        line = line_buffer.rstrip("\r\n")
        line_buffer = ""
        if live_active:
            live_line.finish()
            live_active = False
        if line.strip():
            prepare_for_regular_output()
            log(line)

    def update_live_line() -> None:
        nonlocal line_buffer, live_active
        line = line_buffer.rstrip("\r\n")
        line_buffer = ""
        if line.strip():
            live_line.update(line)
            live_active = True

    while True:
        try:
            item = output_queue.get(timeout=1)
        except queue.Empty:
            item = "___NO_LINE___"
        if item is None:
            saw_eof = True
            if line_buffer:
                if live_active:
                    update_live_line()
                    live_line.finish()
                    live_active = False
                else:
                    flush_regular_line()
        elif item != "___NO_LINE___":
            last_output = time.monotonic()
            if item == "\r":
                update_live_line()
            elif item == "\n":
                flush_regular_line()
            else:
                line_buffer += item
        if proc.poll() is not None and saw_eof:
            break
        if time.monotonic() - last_output > idle_timeout:
            proc.kill()
            raise ToolError(
                f"No log update for {idle_timeout} seconds; treating the run as failed."
            )
    if live_active:
        live_line.finish()
    if proc.returncode != 0:
        raise ToolError(f"Command failed with exit code {proc.returncode}: {args}")


def run_visible_terminal_sequence(
    steps: list[tuple[list[str], Path]],
    log: LogFn,
    label: str,
    env: Optional[dict[str, str]] = None,
) -> None:
    if not steps:
        return

    for args, _cwd in steps:
        log("> " + " ".join(f'"{a}"' if " " in a else a for a in args))

    if os.name != "nt":
        for args, cwd in steps:
            run_stream(args, cwd, log=log)
        return

    log(f"[terminal] opening one separate native console for {label}")
    runner = (
        "import json, os, subprocess, sys\n"
        "payload = json.loads(sys.argv[1])\n"
        "env = os.environ.copy()\n"
        "for index, step in enumerate(payload['steps'], start=1):\n"
        "    args = step['args']\n"
        "    print(f\"[{index}/{len(payload['steps'])}] \" + ' '.join(args), flush=True)\n"
        "    completed = subprocess.run(args, cwd=step['cwd'], env=env)\n"
        "    if completed.returncode:\n"
        "        print(f\"FAILED step {index} with exit code {completed.returncode}\", flush=True)\n"
        "        raise SystemExit(completed.returncode)\n"
    )
    payload = json.dumps(
        {"steps": [{"args": args, "cwd": str(cwd)} for args, cwd in steps]},
        ensure_ascii=False,
    )
    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    proc = subprocess.Popen(
        [sys.executable, "-c", runner, payload],
        cwd=str(PROJECT_ROOT),
        env=env or project_env(),
        creationflags=creationflags,
    )
    proc.wait()
    if proc.returncode != 0:
        raise ToolError(f"{label} failed with exit code {proc.returncode}")


def run_capture(args: list[str], cwd: Path, env: Optional[dict[str, str]] = None) -> str:
    proc = subprocess.run(
        args,
        cwd=str(cwd),
        env=env or project_env(),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if proc.returncode != 0:
        raise ToolError(proc.stdout)
    return proc.stdout


def find_python311() -> str:
    py = shutil.which("py")
    if py:
        try:
            out = run_capture([py, "-3.11", "-c", "import sys; print(sys.executable)"], PROJECT_ROOT)
            exe = out.strip().splitlines()[-1]
            if Path(exe).exists():
                return exe
        except Exception:
            pass
    exe = shutil.which("python")
    if exe:
        return exe
    raise ToolError("Python 3.11 or python.exe was not found.")


def find_python310() -> str:
    py = shutil.which("py")
    if py:
        try:
            out = run_capture([py, "-3.10", "-c", "import sys; print(sys.executable)"], PROJECT_ROOT)
            exe = out.strip().splitlines()[-1]
            if Path(exe).exists():
                return exe
        except Exception:
            pass
        try:
            out = run_capture([py, "-0p"], PROJECT_ROOT)
            for line in out.splitlines():
                if "3.10" not in line:
                    continue
                match = re.search(r"([A-Za-z]:\\.+?python\.exe)\s*$", line.strip(), re.IGNORECASE)
                if match and Path(match.group(1)).exists():
                    return match.group(1)
        except Exception:
            pass
    raise ToolError("Python 3.10 was not found. GPT-SoVITS official Windows setup expects Python 3.10.")


def venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def ensure_venv(
    venv_dir: Path,
    log: LogFn = log_print,
    base_python: Optional[str] = None,
    bootstrap_tools: bool = True,
) -> Path:
    py = venv_python(venv_dir)
    if py.exists():
        return py
    ensure_project_dirs()
    base_python = base_python or find_python311()
    log(f"Creating venv: {venv_dir}")
    run_stream([base_python, "-m", "venv", str(venv_dir)], PROJECT_ROOT, log=log, idle_timeout=180)
    return py


def deps_marker_ready(marker: Path, stamp: str, device: str) -> bool:
    if not marker.exists():
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return False
    return data.get("stamp") == stamp and data.get("device") == device


def write_deps_marker(marker: Path, stamp: str, device: str) -> None:
    marker.write_text(
        json.dumps(
            {
                "stamp": stamp,
                "device": device,
                "written_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def python_modules_ready(py: Path, modules: list[str]) -> bool:
    code = (
        "import importlib\n"
        f"mods = {modules!r}\n"
        "for mod in mods:\n"
        "    importlib.import_module(mod)\n"
    )
    try:
        run_capture([str(py), "-c", code], PROJECT_ROOT)
        return True
    except Exception:
        return False


def log_python_package_versions(py: Path, label: str, modules: list[str], log: LogFn) -> None:
    code = (
        "import importlib\n"
        f"mods = {modules!r}\n"
        "for mod in mods:\n"
        "    m = importlib.import_module(mod)\n"
        "    print(f'{mod}={getattr(m, \"__version__\", \"import-ok\")}')\n"
    )
    out = run_capture([str(py), "-c", code], PROJECT_ROOT)
    for line in out.splitlines():
        if line.strip():
            log(f"[{label} deps] {line.strip()}")


def log_python_dist_versions(py: Path, label: str, dists: list[str], log: LogFn) -> None:
    code = (
        "from importlib import metadata\n"
        f"dists = {dists!r}\n"
        "for dist in dists:\n"
        "    try:\n"
        "        print(f'{dist}={metadata.version(dist)}')\n"
        "    except metadata.PackageNotFoundError:\n"
        "        print(f'{dist}=not-installed')\n"
    )
    out = run_capture([str(py), "-c", code], PROJECT_ROOT)
    for line in out.splitlines():
        if line.strip():
            log(f"[{label} deps] {line.strip()}")


def python_dists_ready(py: Path, dists: list[str]) -> bool:
    code = (
        "from importlib import metadata\n"
        f"dists = {dists!r}\n"
        "for dist in dists:\n"
        "    metadata.version(dist)\n"
    )
    try:
        run_capture([str(py), "-c", code], PROJECT_ROOT)
        return True
    except Exception:
        return False


def gpt_sovits_python() -> Path:
    data = json.loads(GPT_RUNTIME_MARKER.read_text(encoding="utf-8"))
    py = Path(str(data["python"]))
    expected_py = gpt_conda_python_path()
    if py != expected_py:
        raise ToolError(f"GPT-SoVITS runtime marker points outside the bundled repo env: {py}. Expected: {expected_py}")
    if not py.exists():
        raise ToolError(f"GPT-SoVITS conda Python was not found: {py}")
    return py


def python_sys_prefix(py: Path) -> Path:
    out = run_capture([str(py), "-c", "import sys; print(sys.prefix)"], PROJECT_ROOT)
    return Path(out.strip().splitlines()[-1])


def find_conda(log: LogFn = log_print) -> Path:
    conda = gpt_conda_exe()
    if conda.exists():
        return conda
    if os.name == "nt":
        install_miniconda(log=log)
        if conda.exists():
            return conda
        raise ToolError(f"Miniconda install finished but conda was not found: {conda}")
    external_conda = shutil.which("conda.exe") or shutil.which("conda")
    if external_conda:
        return Path(external_conda)
    raise ToolError("conda was not found. Install conda before setting up GPT-SoVITS on this platform.")


def install_miniconda(log: LogFn = log_print) -> None:
    target = gpt_miniconda_dir()
    if gpt_conda_exe().exists():
        return
    installer = CACHE_DIR / "Miniconda3-latest-Windows-x86_64.exe"
    log(f"[Miniconda] downloading installer: {MINICONDA_URL}")
    download_url_to_path(MINICONDA_URL, installer, label="Miniconda", log=log, retry_label="Miniconda")
    if target.exists() and any(target.iterdir()):
        raise ToolError(f"GPT-SoVITS repo Miniconda target already exists but conda.exe is missing: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    log(f"[Miniconda] installing GPT-SoVITS repo-local Miniconda to {target}")
    run_stream([str(installer), "/S", f"/D={target}"], PROJECT_ROOT, log=log, idle_timeout=900)


def gpt_sovits_device() -> str:
    requested = os.environ.get("GPT_SOVITS_DEVICE", "").upper()
    if requested in {"CU128", "CU126", "CPU"}:
        return requested
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi is None:
        nvidia_smi_path = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
        if nvidia_smi_path.exists():
            nvidia_smi = str(nvidia_smi_path)
    return "CU128" if nvidia_smi else "CPU"


def gpt_runtime_marker_ready(marker: Path, stamp: str, device: str, py: Optional[Path] = None) -> bool:
    if not deps_marker_ready(marker, stamp, device):
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        python_path = Path(str(data.get("python", "")))
    except Exception:
        return False
    if py is not None and python_path != py:
        return False
    ready_modules = ["torch", "torchaudio", "pytorch_lightning", "transformers", "gradio"]
    if os.name == "nt":
        ready_modules.append("eunjeon")
    return python_path.exists() and python_modules_ready(python_path, ready_modules)


def write_gpt_runtime_marker(marker: Path, stamp: str, device: str, conda: Path, log: LogFn) -> Path:
    env = project_env({"PATH": str(conda.parent) + os.pathsep + project_env().get("PATH", "")})
    code = "import json, sys; print(json.dumps({'python': sys.executable, 'prefix': sys.prefix}, ensure_ascii=False))"
    out = run_capture([str(conda), "run", "-p", str(gpt_conda_env_prefix()), "python", "-c", code], PROJECT_ROOT, env=env)
    data = json.loads(out.strip().splitlines()[-1])
    py = Path(str(data["python"]))
    expected_py = gpt_conda_python_path()
    if py != expected_py:
        raise ToolError(f"GPT-SoVITS conda resolved to {py}, expected bundled env Python at {expected_py}")
    marker.write_text(
        json.dumps(
            {
                "stamp": stamp,
                "device": device,
                "python": str(py),
                "prefix": str(data["prefix"]),
                "written_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    log(f"[GPT-SoVITS runtime] python={py}")
    return py


def install_gpt_sovits_official_runtime(conda: Path, device: str, log: LogFn) -> Path:
    if not GPT_RUNTIME_SCRIPT.exists():
        raise ToolError(f"GPT-SoVITS runtime install script was not found: {GPT_RUNTIME_SCRIPT}")
    powershell = shutil.which("powershell.exe") or "powershell.exe"
    args = [
        powershell,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(GPT_RUNTIME_SCRIPT),
        "-Device",
        device,
        "-Source",
        "HF",
        "-RepoPath",
        str(GPT_REPO),
        "-EnvName",
        GPT_CONDA_ENV_NAME,
        "-EnvPrefix",
        str(gpt_conda_env_prefix()),
        "-CondaExe",
        str(conda),
        "-LogPath",
        str(GPT_REPO / ".gpt_sovits_official_install.log"),
    ]
    log(f"[GPT-SoVITS official install] device={device}, script={GPT_RUNTIME_SCRIPT}")
    run_visible_terminal_sequence(
        [(args, PROJECT_ROOT)],
        log=log,
        label="GPT-SoVITS official runtime install",
        env=project_env({"PATH": str(conda.parent) + os.pathsep + project_env().get("PATH", "")}),
    )
    return write_gpt_runtime_marker(GPT_RUNTIME_MARKER, GPT_REQUIREMENTS_STAMP, device, conda, log)


def gpt_torch_cuda_available(py: Path) -> bool:
    try:
        out = run_capture([str(py), "-c", "import torch; print(torch.cuda.is_available())"], PROJECT_ROOT)
        return out.strip().splitlines()[-1].strip().lower() == "true"
    except Exception:
        return False


def gpt_is_half_value(py: Path, gpu: str) -> str:
    if str(gpu).strip() in {"", "-1", "cpu", "CPU"}:
        return "False"
    return "True" if gpt_torch_cuda_available(py) else "False"


def ensure_gpt_sovits_official_pretrained_cache(log: LogFn = log_print) -> None:
    official_dir = GPT_REPO / "GPT_SoVITS" / "pretrained_models"
    if (official_dir / "sv").exists():
        return
    if not GPT_HF.exists():
        return
    official_dir.parent.mkdir(parents=True, exist_ok=True)
    if not official_dir.exists():
        if os.name == "nt":
            try:
                run_stream(["cmd", "/c", "mklink", "/J", str(official_dir), str(GPT_HF)], PROJECT_ROOT, log=log, idle_timeout=60)
                log(f"[GPT-SoVITS official install] linked pretrained_models to existing cache: {GPT_HF}")
                return
            except Exception as exc:
                log(f"[GPT-SoVITS official install] could not create pretrained_models junction: {exc}")
        try:
            os.symlink(GPT_HF, official_dir, target_is_directory=True)
            log(f"[GPT-SoVITS official install] linked pretrained_models to existing cache: {GPT_HF}")
            return
        except Exception as exc:
            log(f"[GPT-SoVITS official install] could not create pretrained_models symlink: {exc}")
    (official_dir / "sv").mkdir(parents=True, exist_ok=True)
    log(f"[GPT-SoVITS official install] created pretrained_models marker to skip duplicate official model zip: {official_dir / 'sv'}")


def bundled_uv_dir() -> Path:
    return RUNTIME_DIR / "uv_tool"


def bundled_uv_path() -> Path:
    return bundled_uv_dir() / ("Scripts" if os.name == "nt" else "bin") / ("uv.exe" if os.name == "nt" else "uv")


def uv_env() -> dict[str, str]:
    uv_bin = bundled_uv_path().parent
    cache_dir = CACHE_DIR / "uv"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return project_env(
        {
            "PATH": str(uv_bin) + os.pathsep + project_env().get("PATH", ""),
            "UV_CACHE_DIR": str(cache_dir),
            "UV_LINK_MODE": "copy",
        }
    )


def find_uv(log: LogFn) -> str:
    bundled = bundled_uv_path()
    if bundled.exists():
        return str(bundled)
    uv = shutil.which("uv")
    if uv:
        return uv
    install_uv(log=log)
    if bundled.exists():
        return str(bundled)
    uv = shutil.which("uv", path=uv_env().get("PATH"))
    if uv:
        return uv
    raise ToolError(f"uv install finished but uv was not found: {bundled}")


def install_uv(log: LogFn) -> None:
    target = bundled_uv_dir()
    if not venv_python(target).exists():
        log(f"[uv bootstrap] creating uv venv: {target}")
        run_stream([sys.executable, "-m", "venv", str(target)], PROJECT_ROOT, log=log, idle_timeout=180)
    log(f"[uv bootstrap] installing uv into {target}")
    run_visible_terminal_sequence(
        [([str(venv_python(target)), "-m", "pip", "install", "-U", "pip", "wheel", "setuptools<81", "uv"], PROJECT_ROOT)],
        log=log,
        label="uv bootstrap",
    )


def omnivoice_uv_python() -> Path:
    return venv_python(OMNI_REPO / ".venv")


def install_omnivoice_official_deps(log: LogFn) -> Path:
    uv = find_uv(log=log)
    log("[OmniVoice official install] cd OmniVoice && uv sync")
    run_visible_terminal_sequence(
        [([uv, "sync"], OMNI_REPO)],
        log=log,
        label="OmniVoice uv sync",
        env=uv_env(),
    )
    py = omnivoice_uv_python()
    if not py.exists():
        raise ToolError(f"uv sync finished but OmniVoice venv Python was not found: {py}")
    return py


def _remove_preclone_scaffold(dest: Path) -> bool:
    if not dest.exists() or (dest / ".git").exists():
        return False
    allowed_names = {"nltk_data"}
    try:
        children = list(dest.iterdir())
    except OSError:
        return False
    if not children or any(child.name not in allowed_names or not child.is_dir() for child in children):
        return False
    for child in children:
        if any(child.rglob("*")):
            return False
    shutil.rmtree(dest)
    return True


def ensure_clone(url: str, dest: Path, log: LogFn = log_print, lfs: bool = False) -> None:
    if (dest / ".git").exists():
        log(f"Already cloned: {dest}")
    elif _remove_preclone_scaffold(dest):
        log(f"Removed incomplete pre-clone scaffold: {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        run_stream(["git", "clone", "--progress", "--depth", "1", url, str(dest)], PROJECT_ROOT, log=log)
    elif dest.exists() and any(dest.iterdir()):
        raise ToolError(f"{dest} exists but is not a git clone.")
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        run_stream(["git", "clone", "--progress", "--depth", "1", url, str(dest)], PROJECT_ROOT, log=log)
    if lfs:
        run_stream(["git", "lfs", "install", "--local"], dest, log=log, idle_timeout=180)
        run_stream(["git", "lfs", "pull"], dest, log=log, idle_timeout=900)


def ensure_hf_snapshot(repo_id: str, dest: Path, log: LogFn = log_print, label: str | None = None) -> None:
    from huggingface_hub import HfApi, hf_hub_url

    ensure_project_dirs()
    dest.mkdir(parents=True, exist_ok=True)
    model_label = label or repo_id
    log(f"[model cache] {model_label}: {dest.resolve()}")

    with clean_network_env():
        files = HfApi().list_repo_files(repo_id=repo_id)
    selected = [file_name for file_name in files if file_name and not file_name.endswith("/")]
    if not selected:
        raise ToolError(f"No Hugging Face files found for {repo_id}.")

    for file_name in selected:
        target_path = dest / file_name
        if is_download_complete(target_path, reject_git_lfs_pointer=True):
            log(f"[model cache ready] {model_label}: {file_name}")
            continue

        log(f"[model download] {model_label}: {file_name}")
        url = hf_hub_url(repo_id=repo_id, filename=file_name)
        with clean_network_env():
            download_url_to_path(
                url,
                target_path,
                label=f"{model_label} {Path(file_name).name}",
                log=log,
                retry_label=f"{model_label}: {file_name}",
            )


def gpt_hf_cache_ready(version: str | None = None) -> bool:
    if not GPT_HF.exists():
        return False
    versions = [version] if version in GPT_PRETRAINED else list(GPT_PRETRAINED)
    required: list[str] = []
    for item in versions:
        if not item:
            continue
        spec = GPT_PRETRAINED[item]
        required.extend([spec["gpt"], spec["s2g"], spec["s2d"]])
    required.append("sv/pretrained_eres2netv2w24s4ep4.ckpt")
    return all(is_download_complete(GPT_HF / file_name, reject_git_lfs_pointer=True) for file_name in required)


def omni_hf_cache_ready() -> bool:
    required = [
        OMNI_HF / "config.json",
        OMNI_HF / "model.safetensors",
        OMNI_HF / "tokenizer.json",
        OMNI_HF / "audio_tokenizer",
    ]
    return all(path.exists() for path in required)


def ensure_gpt_sovits_assets(log: LogFn = log_print, install_deps: bool = True, version: str | None = None) -> Path:
    ensure_project_dirs()
    ensure_clone(GPT_CODE_URL, GPT_REPO, log=log, lfs=False)
    if gpt_hf_cache_ready(version):
        log(f"[model cache ready] GPT-SoVITS: {GPT_HF.resolve()}")
    else:
        ensure_hf_snapshot(GPT_HF_REPO_ID, GPT_HF, log=log, label="GPT-SoVITS")
    ensure_gpt_sovits_official_pretrained_cache(log=log)
    if install_deps:
        conda = find_conda(log=log)
        device = gpt_sovits_device()
        if gpt_runtime_marker_ready(GPT_RUNTIME_MARKER, GPT_REQUIREMENTS_STAMP, device, py=gpt_conda_python_path()):
            py = gpt_sovits_python()
        else:
            py = install_gpt_sovits_official_runtime(conda, device, log=log)
        log_modules = ["torch", "torchaudio", "pytorch_lightning", "transformers", "gradio"]
        if os.name == "nt":
            log_modules.append("eunjeon")
        log_python_package_versions(py, "GPT-SoVITS", log_modules, log)
    elif GPT_RUNTIME_MARKER.exists():
        py = gpt_sovits_python()
    else:
        raise ToolError("GPT-SoVITS runtime has not been installed yet.")
    return py


def ensure_omnivoice_assets(log: LogFn = log_print, install_deps: bool = True) -> Path:
    ensure_project_dirs()
    ensure_clone(OMNI_CODE_URL, OMNI_REPO, log=log, lfs=False)
    if omni_hf_cache_ready():
        log(f"[model cache ready] OmniVoice: {OMNI_HF.resolve()}")
    else:
        ensure_hf_snapshot(OMNI_HF_REPO_ID, OMNI_HF, log=log, label="OmniVoice")
    py = omnivoice_uv_python()
    if install_deps:
        marker = OMNI_REPO / ".venv" / ".omnivoice_uv_sync_ok"
        ready_modules = ["torch", "torchaudio", "omnivoice", "accelerate", "webdataset"]
        if not py.exists() or not deps_marker_ready(marker, OMNI_OFFICIAL_DEPS_STAMP, "uv") or not python_modules_ready(py, ready_modules):
            py = install_omnivoice_official_deps(log=log)
            log_python_package_versions(py, "OmniVoice", ready_modules, log)
            write_deps_marker(marker, OMNI_OFFICIAL_DEPS_STAMP, "uv")
        else:
            log_python_package_versions(py, "OmniVoice", ready_modules, log)
    elif not py.exists():
        raise ToolError(f"OmniVoice uv environment was not found: {py}")
    return py


def parse_gsv_list(list_path: Path) -> list[tuple[str, str, str, str]]:
    return parse_gsv_list_file(list_path)


def normalized_gsv_list(list_path: Path, exp_name: str, log: LogFn = log_print) -> Path:
    return normalize_gsv_list_file(list_path, exp_name, WORK_DIR, log)


def infer_wav_dir(list_path: Path) -> str:
    return infer_gsv_wav_dir(list_path)


def gpt_model_path(version: str, key: str) -> Path:
    return gpt_model_path_for(GPT_HF, GPT_PRETRAINED, version, key)


def validate_gpt_version(version: str) -> None:
    if version not in GPT_VERSIONS:
        raise ToolError(f"Unsupported GPT-SoVITS version: {version}")
    missing = [key for key in ("gpt", "s2g") if not gpt_model_path(version, key).exists()]
    s2d = gpt_model_path(version, "s2d")
    if not s2d.exists():
        missing.append("s2d")
    if missing:
        raise ToolError(f"Missing GPT-SoVITS {version} pretrained files: {missing}")


def run_gpt_preprocess(
    list_path: Path,
    exp_name: str,
    version: str = "v2",
    gpu: str = "0",
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> tuple[Path, Path, Path]:
    py = ensure_gpt_sovits_assets(log=log, install_deps=True, version=version)
    validate_gpt_version(version)
    input_list = normalized_gsv_list(list_path, exp_name, log=log)
    wav_dir = infer_wav_dir(input_list)
    exp_dir = GPT_REPO / "logs" / exp_name
    opt_dir = exp_dir
    opt_dir.mkdir(parents=True, exist_ok=True)
    is_half = gpt_is_half_value(py, gpu)
    base_env = project_env(
        {
            "version": version,
            "inp_text": str(input_list),
            "inp_wav_dir": wav_dir,
            "exp_name": exp_name,
            "opt_dir": str(opt_dir),
            "_CUDA_VISIBLE_DEVICES": gpu,
            "CUDA_VISIBLE_DEVICES": gpu,
            "is_half": is_half,
            "all_parts": "1",
            "i_part": "0",
        }
    )

    log("[GPT-SoVITS] 1A text/phoneme/BERT token preparation")
    env = base_env | {"bert_pretrained_dir": str(GPT_HF / "chinese-roberta-wwm-ext-large")}
    run_stream(
        [str(py), "-s", "GPT_SoVITS/prepare_datasets/1-get-text.py"],
        GPT_REPO,
        log=log,
        env=env,
        idle_timeout=idle_timeout,
    )
    part_text = opt_dir / "2-name2text-0.txt"
    final_text = opt_dir / "2-name2text.txt"
    if part_text.exists():
        final_text.write_text(part_text.read_text(encoding="utf-8"), encoding="utf-8")
        part_text.unlink()
    if not final_text.exists() or final_text.stat().st_size == 0:
        raise ToolError("GPT-SoVITS 1A produced no 2-name2text.txt")

    log("[GPT-SoVITS] 1B SSL/Hubert and 32k wav preparation")
    env = base_env | {
        "cnhubert_base_dir": str(GPT_HF / "chinese-hubert-base"),
        "sv_path": str(GPT_HF / "sv" / "pretrained_eres2netv2w24s4ep4.ckpt"),
    }
    run_stream(
        [str(py), "-s", "GPT_SoVITS/prepare_datasets/2-get-hubert-wav32k.py"],
        GPT_REPO,
        log=log,
        env=env,
        idle_timeout=idle_timeout,
    )
    if "Pro" in version:
        log("[GPT-SoVITS] 1B-Pro speaker vector preparation")
        run_stream(
            [str(py), "-s", "GPT_SoVITS/prepare_datasets/2-get-sv.py"],
            GPT_REPO,
            log=log,
            env=env,
            idle_timeout=idle_timeout,
        )

    log("[GPT-SoVITS] 1C semantic token extraction")
    s2_config = GPT_REPO / GPT_PRETRAINED[version]["s2_config"]
    env = base_env | {
        "pretrained_s2G": str(gpt_model_path(version, "s2g")),
        "s2config_path": str(s2_config),
    }
    run_stream(
        [str(py), "-s", "GPT_SoVITS/prepare_datasets/3-get-semantic.py"],
        GPT_REPO,
        log=log,
        env=env,
        idle_timeout=idle_timeout,
    )
    part_sem = opt_dir / "6-name2semantic-0.tsv"
    final_sem = opt_dir / "6-name2semantic.tsv"
    if part_sem.exists():
        body = part_sem.read_text(encoding="utf-8").strip()
        final_sem.write_text("item_name\tsemantic_audio\n" + body + "\n", encoding="utf-8")
        part_sem.unlink()
    if not final_sem.exists() or final_sem.stat().st_size < 31:
        raise ToolError("GPT-SoVITS 1C produced no semantic tokens.")
    return exp_dir, final_text, final_sem


def write_sovits_config(
    exp_name: str,
    version: str,
    batch_size: int,
    epochs: int,
    gpu: str,
    text_low_lr_rate: float = 0.4,
    if_save_latest: bool = False,
    if_save_every_weights: bool = True,
    save_every_epoch: int = 1,
    grad_ckpt: bool = False,
    lora_rank: int = 16,
    pretrained_s2g: Optional[str] = None,
    pretrained_s2d: Optional[str] = None,
) -> Path:
    return write_sovits_config_file(
        gpt_repo=GPT_REPO,
        gpt_hf=GPT_HF,
        work_dir=WORK_DIR,
        gpt_pretrained=GPT_PRETRAINED,
        exp_name=exp_name,
        version=version,
        batch_size=batch_size,
        epochs=epochs,
        gpu=gpu,
        text_low_lr_rate=text_low_lr_rate,
        if_save_latest=if_save_latest,
        if_save_every_weights=if_save_every_weights,
        save_every_epoch=save_every_epoch,
        grad_ckpt=grad_ckpt,
        lora_rank=lora_rank,
        pretrained_s2g=pretrained_s2g,
        pretrained_s2d=pretrained_s2d,
    )

def write_gpt_config(exp_name: str, version: str, batch_size: int, epochs: int, gpu: str) -> Path:
    return write_gpt_config_file(
        gpt_repo=GPT_REPO,
        work_dir=WORK_DIR,
        exp_name=exp_name,
        version=version,
        batch_size=batch_size,
        epochs=epochs,
    )

def apply_gpt_train_options(
    config_path: Path,
    version: str,
    exp_name: str,
    batch_size: int,
    epochs: int,
    save_every_epoch: int = 1,
    if_save_latest: bool = False,
    if_save_every_weights: bool = True,
    if_dpo: bool = False,
    pretrained_s1: Optional[str] = None,
) -> Path:
    return apply_gpt_train_options_config(
        config_path=config_path,
        gpt_repo=GPT_REPO,
        gpt_hf=GPT_HF,
        work_dir=WORK_DIR,
        gpt_pretrained=GPT_PRETRAINED,
        version=version,
        exp_name=exp_name,
        batch_size=batch_size,
        epochs=epochs,
        save_every_epoch=save_every_epoch,
        if_save_latest=if_save_latest,
        if_save_every_weights=if_save_every_weights,
        if_dpo=if_dpo,
        pretrained_s1=pretrained_s1,
    )

def omnivoice_checkpoint_dirs(out_dir: Path) -> list[Path]:
    return omnivoice_checkpoint_dirs_for(out_dir, OMNI_HF)


def valid_omnivoice_weight_file(path: Path) -> bool:
    return valid_omnivoice_weight_file_for(path, OMNI_HF)


def finalize_omnivoice_model_checkpoint(checkpoint_dir: Path, train_cfg: Path, log: LogFn = log_print) -> None:
    finalize_omnivoice_model_checkpoint_for(checkpoint_dir, train_cfg, OMNI_HF, log)


def omnivoice_checkpoint_written_after(checkpoint_dir: Path, timestamp: float) -> bool:
    return omnivoice_checkpoint_written_after_for(checkpoint_dir, timestamp, OMNI_HF)


def rewrite_webdataset_manifest_for_windows(manifest: Path, log: LogFn = log_print) -> None:
    rewrite_webdataset_manifest_for_windows_file(manifest, OMNI_REPO, log)

def train_sovits(
    exp_name: str,
    version: str = "v2",
    batch_size: int = 4,
    epochs: int = 8,
    gpu: str = "0",
    text_low_lr_rate: float = 0.4,
    if_save_latest: bool = True,
    if_save_every_weights: bool = True,
    save_every_epoch: int = 4,
    grad_ckpt: bool = False,
    lora_rank: int = 32,
    pretrained_s2g: Optional[str] = None,
    pretrained_s2d: Optional[str] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> list[Path]:
    py = ensure_gpt_sovits_assets(log=log, install_deps=True, version=version)
    validate_gpt_version(version)
    config = write_sovits_config(
        exp_name,
        version,
        batch_size,
        epochs,
        gpu,
        text_low_lr_rate=text_low_lr_rate,
        if_save_latest=if_save_latest,
        if_save_every_weights=if_save_every_weights,
        save_every_epoch=save_every_epoch,
        grad_ckpt=grad_ckpt,
        lora_rank=lora_rank,
        pretrained_s2g=pretrained_s2g,
        pretrained_s2d=pretrained_s2d,
    )
    script = GPT_PRETRAINED[version]["s2_script"]
    log(f"[GPT-SoVITS] SoVITS training {epochs} epoch(s)")
    run_stream(
        [str(py), "-s", script, "--config", str(config)],
        GPT_REPO,
        log=log,
        env=project_env({"CUDA_VISIBLE_DEVICES": gpu, "_CUDA_VISIBLE_DEVICES": gpu, "is_half": gpt_is_half_value(py, gpu)}),
        idle_timeout=idle_timeout,
    )
    exp_dir = GPT_REPO / "logs" / exp_name
    ckpts = checkpoints(
        [
            exp_dir / f"logs_s2_{version}" / "G_*.pth",
            exp_dir / f"logs_s2_{version}" / "D_*.pth",
            GPT_REPO / (f"SoVITS_weights_{version}" if version != "v1" else "SoVITS_weights") / "*.pth",
        ]
    )
    if not ckpts:
        raise ToolError("SoVITS training finished but no checkpoint was found.")
    return ckpts


def train_gpt(
    exp_name: str,
    version: str = "v2",
    batch_size: int = 4,
    epochs: int = 15,
    gpu: str = "0",
    save_every_epoch: int = 5,
    if_save_latest: bool = True,
    if_save_every_weights: bool = True,
    if_dpo: bool = False,
    pretrained_s1: Optional[str] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> list[Path]:
    py = ensure_gpt_sovits_assets(log=log, install_deps=True, version=version)
    validate_gpt_version(version)
    config = WORK_DIR / "gpt_sovits" / exp_name / f"tmp_s1_{version}.yaml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config = apply_gpt_train_options(
        config,
        version,
        exp_name,
        batch_size,
        epochs,
        save_every_epoch=save_every_epoch,
        if_save_latest=if_save_latest,
        if_save_every_weights=if_save_every_weights,
        if_dpo=if_dpo,
        pretrained_s1=pretrained_s1,
    )
    log(f"[GPT-SoVITS] GPT training {epochs} epoch(s)")
    run_stream(
        [str(py), "-s", "GPT_SoVITS/s1_train.py", "--config_file", str(config)],
        GPT_REPO,
        log=log,
        env=project_env({"CUDA_VISIBLE_DEVICES": gpu, "_CUDA_VISIBLE_DEVICES": gpu, "hz": "25hz", "is_half": gpt_is_half_value(py, gpu)}),
        idle_timeout=idle_timeout,
    )
    exp_dir = GPT_REPO / "logs" / exp_name
    ckpts = checkpoints(
        [
            exp_dir / f"logs_s1_{version}" / "ckpt" / "*.ckpt",
            GPT_REPO / (f"GPT_weights_{version}" if version != "v1" else "GPT_weights") / "*.ckpt",
        ]
    )
    if not ckpts:
        raise ToolError("GPT training finished but no checkpoint was found.")
    return ckpts


def require_gpt_resume_state(exp_name: str, version: str, resume_sovits_path: Optional[Path] = None, resume_gpt_path: Optional[Path] = None) -> None:
    exp_dir = GPT_REPO / "logs" / exp_name
    s2_dir = exp_dir / f"logs_s2_{version}"
    s1_dir = exp_dir / f"logs_s1_{version}" / "ckpt"
    missing = []
    if resume_sovits_path is not None:
        if not resume_sovits_path.exists() or not resume_sovits_path.is_file():
            missing.append(str(resume_sovits_path))
    elif not newest_file([s2_dir / "G_*.pth"]):
        missing.append(str(s2_dir / "G_*.pth"))
    if resume_sovits_path is None and not newest_file([s2_dir / "D_*.pth"]):
        missing.append(str(s2_dir / "D_*.pth"))
    if resume_gpt_path is not None:
        if not resume_gpt_path.exists() or not resume_gpt_path.is_file():
            missing.append(str(resume_gpt_path))
    elif not newest_file([s1_dir / "*.ckpt"]):
        missing.append(str(s1_dir / "*.ckpt"))
    if missing:
        raise ToolError("No existing GPT-SoVITS checkpoint to resume from: " + "; ".join(missing))


def resume_gpt_to_epoch(
    exp_name: str = "speaker_unknown_smoke",
    version: str = "v2",
    target_epoch: int = 2,
    gpu: str = "0",
    sovits_options: Optional[dict] = None,
    gpt_options: Optional[dict] = None,
    resume_sovits_path: Optional[str | Path] = None,
    resume_gpt_path: Optional[str | Path] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> GptRunResult:
    selected_sovits = Path(resume_sovits_path) if resume_sovits_path else None
    selected_gpt = Path(resume_gpt_path) if resume_gpt_path else None
    require_gpt_resume_state(exp_name, version, selected_sovits, selected_gpt)
    exp_dir = GPT_REPO / "logs" / exp_name
    name2text = exp_dir / "2-name2text.txt"
    semantic = exp_dir / "6-name2semantic.tsv"
    if not name2text.exists() or not semantic.exists():
        raise ToolError(f"GPT-SoVITS preprocessed files are missing in {exp_dir}")
    s2_opts = dict(sovits_options or {})
    s2_opts["epochs"] = int(target_epoch)
    if selected_sovits is not None:
        s2_opts["pretrained_s2g"] = str(selected_sovits)
    s1_opts = dict(gpt_options or {})
    s1_opts["epochs"] = int(target_epoch)
    if selected_gpt is not None:
        s1_opts["pretrained_s1"] = str(selected_gpt)
    log(f"[GPT-SoVITS] Resuming existing checkpoints to epoch {target_epoch}")
    sovits_ckpts = train_sovits(
        exp_name=exp_name,
        version=version,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
        **s2_opts,
    )
    gpt_ckpts = train_gpt(
        exp_name=exp_name,
        version=version,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
        **s1_opts,
    )
    return GptRunResult(
        exp_dir=exp_dir,
        semantic_path=semantic,
        name2text_path=name2text,
        gpt_checkpoints=gpt_ckpts,
        sovits_checkpoints=sovits_ckpts,
    )


def run_gpt_full_smoke(
    list_path: Path,
    exp_name: str = "speaker_unknown_smoke",
    version: str = "v2",
    gpu: str = "0",
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> GptRunResult:
    exp_dir, name2text, semantic = run_gpt_preprocess(
        list_path=list_path,
        exp_name=exp_name,
        version=version,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
    )
    sovits_ckpts = train_sovits(
        exp_name=exp_name,
        version=version,
        batch_size=1,
        epochs=1,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
    )
    gpt_ckpts = train_gpt(
        exp_name=exp_name,
        version=version,
        batch_size=1,
        epochs=1,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
    )
    return GptRunResult(
        exp_dir=exp_dir,
        semantic_path=semantic,
        name2text_path=name2text,
        gpt_checkpoints=gpt_ckpts,
        sovits_checkpoints=sovits_ckpts,
    )


def gsv_to_omnivoice_jsonl(gsv_list: Path, exp_name: str, log: LogFn = log_print) -> Path:
    return write_omnivoice_jsonl_from_gsv(gsv_list, exp_name, WORK_DIR, log)


def resolve_input_file(path: Path, preferred_name: str = "train.jsonl") -> Path:
    return resolve_input_file_from_path(path, preferred_name)


def normalize_omnivoice_jsonl(jsonl_path: Path, exp_name: str, log: LogFn = log_print) -> Path:
    return normalize_omnivoice_jsonl_file(jsonl_path, exp_name, WORK_DIR, log)


def prepare_omnivoice_input(input_path: Path, exp_name: str, log: LogFn = log_print) -> Path:
    return prepare_omnivoice_input_file(input_path, exp_name, WORK_DIR, log)


def prepare_omnivoice_tokens(
    input_path: Path,
    exp_name: str = "speaker_unknown_omni",
    gpu: str = "0",
    nj_per_gpu: int = 1,
    loader_workers: int = 1,
    min_num_shards: int = 1,
    samples_per_shard: int = 1000,
    shuffle: bool = False,
    skip_errors: bool = True,
    min_length: float = 0.0,
    max_length: Optional[float] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> Path:
    py = ensure_omnivoice_assets(log=log, install_deps=True)
    input_jsonl = prepare_omnivoice_input(input_path, exp_name, log=log)
    output = WORK_DIR / "omnivoice" / exp_name / "tokens" / "train"
    output.mkdir(parents=True, exist_ok=True)
    (output / "audios").mkdir(parents=True, exist_ok=True)
    (output / "txts").mkdir(parents=True, exist_ok=True)
    tokenizer_path = OMNI_HF / "audio_tokenizer"
    if not tokenizer_path.exists():
        tokenizer_path = Path("eustlb/higgs-audio-v2-tokenizer")
    tar_pattern = relative_arg(output / "audios" / "shard-%06d.tar", OMNI_REPO)
    jsonl_pattern = relative_arg(output / "txts" / "shard-%06d.jsonl", OMNI_REPO)
    run_stream(
        [
            str(py),
            "-m",
            "omnivoice.scripts.extract_audio_tokens",
            "--input_jsonl",
            str(input_jsonl),
            "--tar_output_pattern",
            tar_pattern,
            "--jsonl_output_pattern",
            jsonl_pattern,
            "--tokenizer_path",
            str(tokenizer_path),
            "--nj_per_gpu",
            str(max(1, int(nj_per_gpu))),
            "--loader_workers",
            str(max(0, int(loader_workers))),
            "--min_num_shards",
            str(max(1, int(min_num_shards))),
            "--samples_per_shard",
            str(max(1, int(samples_per_shard))),
            "--shuffle",
            "True" if shuffle else "False",
            "--min_length",
            str(float(min_length)),
            "--max_length",
            str(float(max_length) if max_length is not None else float("inf")),
        ]
        + (["--skip_errors"] if skip_errors else []),
        OMNI_REPO,
        log=log,
        env=project_env({"CUDA_VISIBLE_DEVICES": gpu, "PYTHONPATH": str(PROJECT_ROOT) + os.pathsep + project_env().get("PYTHONPATH", "")}),
        idle_timeout=idle_timeout,
    )
    manifest = output / "data.lst"
    if not manifest.exists():
        raise ToolError("OmniVoice token extraction finished but data.lst was not created.")
    rewrite_webdataset_manifest_for_windows(manifest, log=log)
    return manifest


DEFAULT_OMNI_TRAIN_OPTIONS = default_omnivoice_train_options(OMNI_HF)


def write_omnivoice_train_configs(
    manifest: Path,
    exp_name: str,
    train_options: Optional[dict] = None,
) -> tuple[Path, Path, Path]:
    return write_omnivoice_train_configs_file(
        manifest=manifest,
        exp_name=exp_name,
        work_dir=WORK_DIR,
        omni_hf=OMNI_HF,
        default_options=DEFAULT_OMNI_TRAIN_OPTIONS,
        train_options=train_options,
    )

def train_omnivoice(
    manifest: Path,
    exp_name: str = "speaker_unknown_omni",
    steps: int = 1,
    gpu: str = "0",
    train_options: Optional[dict] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
    model_only_checkpoint: bool = False,
) -> list[Path]:
    py = ensure_omnivoice_assets(log=log, install_deps=True)
    options = dict(train_options or {})
    if "model_only_checkpoint" in options:
        model_only_checkpoint = bool(options.pop("model_only_checkpoint"))
    options["steps"] = int(options.get("steps", steps))
    shard_count = count_webdataset_manifest_shards(manifest)
    try:
        num_workers = int(options.get("num_workers") or DEFAULT_OMNI_TRAIN_OPTIONS["num_workers"])
    except (TypeError, ValueError):
        num_workers = DEFAULT_OMNI_TRAIN_OPTIONS["num_workers"]
    if shard_count > 0 and num_workers > shard_count:
        options["num_workers"] = max(1, shard_count)
        log(f"[OmniVoice] Reduced num_workers from {num_workers} to {options['num_workers']} for {shard_count} WebDataset shard(s).")
    train_cfg, data_cfg, out_dir = write_omnivoice_train_configs(manifest, exp_name, train_options=options)
    mixed_precision = str(options.get("mixed_precision") or DEFAULT_OMNI_TRAIN_OPTIONS["mixed_precision"])
    train_started_at = time.time() - 1.0
    try:
        run_stream(
            [
                str(py),
                "-m",
                "accelerate.commands.launch",
                "--gpu_ids",
                gpu,
                "--num_processes",
                "1",
                "--mixed_precision",
                mixed_precision,
                str(VOICE_DIR / "omnivoice_train_entry.py"),
                "--train_config",
                str(train_cfg),
                "--data_config",
                str(data_cfg),
                "--output_dir",
                str(out_dir),
            ],
            OMNI_REPO,
            log=log,
            env=project_env({
                "CUDA_VISIBLE_DEVICES": gpu,
                "PYTHONPATH": str(VOICE_DIR) + os.pathsep + str(BACKEND_DIR) + os.pathsep + str(PROJECT_ROOT) + os.pathsep + project_env().get("PYTHONPATH", ""),
                "OMNIVOICE_MODEL_ONLY_CHECKPOINT": "1" if model_only_checkpoint else "0",
            }),
            idle_timeout=idle_timeout,
        )
    except ToolError as exc:
        if not model_only_checkpoint:
            raise
        ckpts = [ckpt for ckpt in omnivoice_checkpoint_dirs(out_dir) if omnivoice_checkpoint_written_after(ckpt, train_started_at)]
        if not ckpts:
            raise
        for ckpt in ckpts:
            finalize_omnivoice_model_checkpoint(ckpt, train_cfg, log=log)
        log(f"[OmniVoice checkpoint] Training process exited non-zero after model weights were written; using saved model checkpoint(s): {', '.join(str(p) for p in ckpts)}")
        return ckpts
    ckpts = omnivoice_checkpoint_dirs(out_dir)
    if not ckpts:
        raise ToolError("OmniVoice training finished but no checkpoint was found.")
    for ckpt in ckpts:
        finalize_omnivoice_model_checkpoint(ckpt, train_cfg, log=log)
    return ckpts


def latest_omnivoice_checkpoint(exp_name: str, checkpoint_path: Optional[Path] = None) -> Path:
    if checkpoint_path is not None:
        checkpoint = Path(checkpoint_path)
        if not checkpoint.exists() or not checkpoint.is_dir():
            raise ToolError(f"Selected OmniVoice checkpoint was not found: {checkpoint}")
        has_config = (checkpoint / "config.json").exists()
        has_weights = any(checkpoint.glob("model*.safetensors")) or (checkpoint / "pytorch_model.bin").exists()
        if not has_config or not has_weights:
            raise ToolError(f"Selected OmniVoice checkpoint is incomplete: {checkpoint}")
        return checkpoint

    out_dir = WORK_DIR / "omnivoice" / exp_name / "exp"
    candidates = []
    for path in out_dir.glob("checkpoint-*"):
        if not path.is_dir():
            continue
        has_config = (path / "config.json").exists()
        has_weights = any(path.glob("model*.safetensors")) or (path / "pytorch_model.bin").exists()
        if has_config and has_weights:
            candidates.append(path)
    if not candidates:
        raise ToolError(f"No existing OmniVoice checkpoint to resume from in {out_dir}")
    return sorted(candidates, key=checkpoint_number)[-1]


def existing_omnivoice_manifest(exp_name: str) -> Optional[Path]:
    manifest = WORK_DIR / "omnivoice" / exp_name / "tokens" / "train" / "data.lst"
    return manifest if manifest.exists() else None


def resume_omnivoice_to_step(
    input_path: Optional[Path] = None,
    exp_name: str = "speaker_unknown_omni_smoke",
    target_step: int = 2,
    gpu: str = "0",
    train_options: Optional[dict] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
    model_only_checkpoint: bool = False,
) -> list[Path]:
    options = dict(train_options or {})
    selected_checkpoint = options.get("resume_from_checkpoint") or None
    latest = latest_omnivoice_checkpoint(exp_name, Path(selected_checkpoint) if selected_checkpoint else None)
    latest_step = checkpoint_number(latest)
    if latest_step >= int(target_step):
        log(f"[OmniVoice] Already at checkpoint step {latest_step}; target step is {target_step}.")
        return [latest]
    manifest = existing_omnivoice_manifest(exp_name)
    if manifest:
        rewrite_webdataset_manifest_for_windows(manifest, log=log)
    elif input_path is not None:
        manifest = prepare_omnivoice_tokens(
            input_path,
            exp_name=exp_name,
            gpu=gpu,
            log=log,
            idle_timeout=idle_timeout,
        )
    else:
        raise ToolError(f"OmniVoice token manifest is missing for {exp_name}; provide an input JSONL/list path.")
    options["init_from_checkpoint"] = str(latest)
    options["resume_from_checkpoint"] = str(latest)
    options["steps"] = int(target_step)
    options.setdefault("save_steps", 1)
    options.setdefault("logging_steps", 1)
    log(f"[OmniVoice] Resuming model checkpoint {latest} to step {target_step}")
    return train_omnivoice(
        manifest,
        exp_name=exp_name,
        steps=int(target_step),
        gpu=gpu,
        train_options=options,
        log=log,
        idle_timeout=idle_timeout,
        model_only_checkpoint=model_only_checkpoint,
    )


def run_omnivoice_smoke(
    input_path: Path,
    exp_name: str = "speaker_unknown_omni_smoke",
    gpu: str = "0",
    train_options: Optional[dict] = None,
    log: LogFn = log_print,
    idle_timeout: int = 900,
) -> list[Path]:
    manifest = prepare_omnivoice_tokens(
        input_path,
        exp_name=exp_name,
        gpu=gpu,
        log=log,
        idle_timeout=idle_timeout,
    )
    options = dict(train_options or {})
    options.setdefault("steps", 1)
    options.setdefault("save_steps", 1)
    options.setdefault("logging_steps", 1)
    return train_omnivoice(
        manifest,
        exp_name=exp_name,
        steps=int(options["steps"]),
        gpu=gpu,
        train_options=options,
        log=log,
        idle_timeout=idle_timeout,
        model_only_checkpoint=bool(options.get("model_only_checkpoint", False)),
    )


def main(argv: Optional[list[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="GPT-SoVITS / OmniVoice training tool CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)
    gpt = sub.add_parser("gpt-smoke")
    gpt.add_argument("--list", default=DEFAULT_LIST)
    gpt.add_argument("--exp", default="speaker_unknown_smoke")
    gpt.add_argument("--version", default="v2", choices=GPT_VERSIONS)
    gpt.add_argument("--gpu", default="0")
    gpt.add_argument("--idle-timeout", type=int, default=900)
    gpt_resume = sub.add_parser("gpt-resume-epoch")
    gpt_resume.add_argument("--exp", default="speaker_unknown_smoke")
    gpt_resume.add_argument("--version", default="v2", choices=GPT_VERSIONS)
    gpt_resume.add_argument("--target-epoch", type=int, default=2)
    gpt_resume.add_argument("--gpu", default="0")
    gpt_resume.add_argument("--idle-timeout", type=int, default=900)
    sub.add_parser("ensure-gpt")
    sub.add_parser("ensure-omni")
    omni = sub.add_parser("omni-prepare")
    omni.add_argument("--input", default=DEFAULT_OMNI_JSONL)
    omni.add_argument("--exp", default="speaker_unknown_omni")
    omni.add_argument("--gpu", default="0")
    omni_train = sub.add_parser("omni-smoke")
    omni_train.add_argument("--input", default=DEFAULT_OMNI_JSONL)
    omni_train.add_argument("--exp", default="speaker_unknown_omni_smoke")
    omni_train.add_argument("--gpu", default="0")
    omni_train.add_argument("--steps", type=int, default=1)
    omni_train.add_argument("--idle-timeout", type=int, default=900)
    omni_resume = sub.add_parser("omni-resume-step")
    omni_resume.add_argument("--input", default=DEFAULT_OMNI_JSONL)
    omni_resume.add_argument("--exp", default="speaker_unknown_omni_smoke")
    omni_resume.add_argument("--target-step", type=int, default=2)
    omni_resume.add_argument("--gpu", default="0")
    omni_resume.add_argument("--idle-timeout", type=int, default=900)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "ensure-gpt":
            ensure_gpt_sovits_assets()
        elif args.cmd == "ensure-omni":
            ensure_omnivoice_assets()
        elif args.cmd == "gpt-smoke":
            result = run_gpt_full_smoke(
                Path(args.list),
                exp_name=args.exp,
                version=args.version,
                gpu=args.gpu,
                idle_timeout=args.idle_timeout,
            )
            print("DONE")
            print(f"exp_dir={result.exp_dir}")
            print(f"name2text={result.name2text_path}")
            print(f"semantic={result.semantic_path}")
            print("gpt_checkpoints=" + ";".join(str(p) for p in result.gpt_checkpoints))
            print("sovits_checkpoints=" + ";".join(str(p) for p in result.sovits_checkpoints))
        elif args.cmd == "gpt-resume-epoch":
            result = resume_gpt_to_epoch(
                exp_name=args.exp,
                version=args.version,
                target_epoch=args.target_epoch,
                gpu=args.gpu,
                idle_timeout=args.idle_timeout,
            )
            print("DONE")
            print(f"exp_dir={result.exp_dir}")
            print("gpt_checkpoints=" + ";".join(str(p) for p in result.gpt_checkpoints))
            print("sovits_checkpoints=" + ";".join(str(p) for p in result.sovits_checkpoints))
        elif args.cmd == "omni-prepare":
            manifest = prepare_omnivoice_tokens(Path(args.input), exp_name=args.exp, gpu=args.gpu)
            print(f"manifest={manifest}")
        elif args.cmd == "omni-smoke":
            ckpts = run_omnivoice_smoke(
                Path(args.input),
                exp_name=args.exp,
                gpu=args.gpu,
                train_options={"steps": args.steps, "save_steps": 1, "logging_steps": 1},
                idle_timeout=args.idle_timeout,
            )
            print("DONE")
            print("omnivoice_checkpoints=" + ";".join(str(p) for p in ckpts))
        elif args.cmd == "omni-resume-step":
            ckpts = resume_omnivoice_to_step(
                Path(args.input),
                exp_name=args.exp,
                target_step=args.target_step,
                gpu=args.gpu,
                idle_timeout=args.idle_timeout,
            )
            print("DONE")
            print("omnivoice_checkpoints=" + ";".join(str(p) for p in ckpts))
        return 0
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
