GPT_CODE_URL = "https://github.com/RVC-Boss/GPT-SoVITS.git"
OMNI_CODE_URL = "https://github.com/k2-fsa/OmniVoice.git"
GPT_HF_REPO_ID = "lj1995/GPT-SoVITS"
OMNI_HF_REPO_ID = "k2-fsa/OmniVoice"
MINICONDA_URL = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"
GPT_CONDA_ENV_NAME = "GPTSoVits"
OMNI_OFFICIAL_DEPS_STAMP = "omnivoice-uv-sync-v1"
GPT_REQUIREMENTS_STAMP = "gpt-sovits-official-ps1-v4"

BLOCKED_NETWORK_ENV_KEYS = {
    "ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "PIP_NO_INDEX",
}

GPT_VERSIONS = ("v1", "v2", "v3", "v4", "v2Pro", "v2ProPlus")

GPT_PRETRAINED = {
    "v1": {
        "gpt": "s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt",
        "s2g": "s2G488k.pth",
        "s2d": "s2D488k.pth",
        "s2_config": "GPT_SoVITS/configs/s2.json",
        "s2_script": "GPT_SoVITS/s2_train.py",
    },
    "v2": {
        "gpt": "gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt",
        "s2g": "gsv-v2final-pretrained/s2G2333k.pth",
        "s2d": "gsv-v2final-pretrained/s2D2333k.pth",
        "s2_config": "GPT_SoVITS/configs/s2.json",
        "s2_script": "GPT_SoVITS/s2_train.py",
    },
    "v3": {
        "gpt": "s1v3.ckpt",
        "s2g": "s2Gv3.pth",
        "s2d": "",
        "vocoder": "models--nvidia--bigvgan_v2_24khz_100band_256x/bigvgan_generator.pt",
        "vocoder_config": "models--nvidia--bigvgan_v2_24khz_100band_256x/config.json",
        "s2_config": "GPT_SoVITS/configs/s2.json",
        "s2_script": "GPT_SoVITS/s2_train_v3_lora.py",
    },
    "v4": {
        "gpt": "s1v3.ckpt",
        "s2g": "gsv-v4-pretrained/s2Gv4.pth",
        "s2d": "",
        "vocoder": "gsv-v4-pretrained/vocoder.pth",
        "s2_config": "GPT_SoVITS/configs/s2.json",
        "s2_script": "GPT_SoVITS/s2_train_v3_lora.py",
    },
    "v2Pro": {
        "gpt": "s1v3.ckpt",
        "s2g": "v2Pro/s2Gv2Pro.pth",
        "s2d": "v2Pro/s2Dv2Pro.pth",
        "s2_config": "GPT_SoVITS/configs/s2v2Pro.json",
        "s2_script": "GPT_SoVITS/s2_train.py",
    },
    "v2ProPlus": {
        "gpt": "s1v3.ckpt",
        "s2g": "v2Pro/s2Gv2ProPlus.pth",
        "s2d": "v2Pro/s2Dv2ProPlus.pth",
        "s2_config": "GPT_SoVITS/configs/s2v2ProPlus.json",
        "s2_script": "GPT_SoVITS/s2_train.py",
    },
}
