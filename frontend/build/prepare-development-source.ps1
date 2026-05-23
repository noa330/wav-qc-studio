param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$BuildRoot = Resolve-Path -LiteralPath $PSScriptRoot
$DefaultOutputPath = Join-Path $BuildRoot.Path "development-source"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = $DefaultOutputPath
}

$ResolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$ResolvedBuildRoot = [System.IO.Path]::GetFullPath($BuildRoot.Path)

if (-not $ResolvedOutputPath.StartsWith($ResolvedBuildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Development source output must stay inside the frontend build directory: $ResolvedOutputPath"
}

$ExcludedDirectoryNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(
    ".git",
    ".model_cache",
    ".tmp",
    ".tools",
    ".venv",
    ".venv_noise",
    ".ven_slice",
    "__pycache__",
    "cache",
    "development-source",
    "node_modules",
    "out",
    "release",
    "runtime",
    "vendor",
    "work"
) | ForEach-Object { [void]$ExcludedDirectoryNames.Add($_) }

$ExcludedFilePatterns = @(
    "*.7z",
    "*.ckpt",
    "*.exe",
    "*.mp3",
    "*.onnx",
    "*.pth",
    "*.pt",
    "*.pyc",
    "*.pyo",
    "*.safetensors",
    "*.wav",
    "*.zip"
)

$SourceDirectories = @(
    "backend",
    "config",
    "deepspeed",
    "frontend/build",
    "frontend/src",
    "training"
)

$SourceFiles = @(
    ".gitignore",
    "README.md",
    "build_and_run_frontend.bat",
    "build_and_run_frontend.ps1",
    "build_installer.bat",
    "build_installer.ps1",
    "cleanup_onnxruntime_conflicts.py",
    "frontend/components.json",
    "frontend/electron-builder.yml",
    "frontend/electron.vite.config.ts",
    "frontend/package-lock.json",
    "frontend/package.json",
    "frontend/tsconfig.json",
    "frontend/tsconfig.node.json",
    "frontend/tsconfig.web.json",
    "requirements.txt",
    "requirements_noise.txt",
    "requirements_slicer.txt",
    "run_built_frontend.bat",
    "run_built_frontend.ps1",
    "setup_and_run.bat",
    "setup_and_run.ps1",
    "verify_onnx_gpu.py"
)

function Test-GeneratedName {
    param([Parameter(Mandatory = $true)][string]$Name)

    return $Name -like "*복사본*" -or $Name -like "*백업*" -or $Name -like "*버림*"
}

function Test-ExcludedFile {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    if (Test-GeneratedName -Name $File.Name) {
        return $true
    }

    foreach ($pattern in $ExcludedFilePatterns) {
        if ($File.Name -like $pattern) {
            return $true
        }
    }

    return $false
}

function Test-ExcludedDirectory {
    param([Parameter(Mandatory = $true)][System.IO.DirectoryInfo]$Directory)

    return $ExcludedDirectoryNames.Contains($Directory.Name) -or (Test-GeneratedName -Name $Directory.Name)
}

function Copy-DevelopmentTree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null

    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        $target = Join-Path $Destination $item.Name

        if ($item.PSIsContainer) {
            if (Test-ExcludedDirectory -Directory $item) {
                continue
            }

            Copy-DevelopmentTree -Source $item.FullName -Destination $target
            continue
        }

        if (Test-ExcludedFile -File $item) {
            continue
        }

        Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
}

function Copy-DevelopmentFile {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )

    $source = Join-Path $RepoRoot.Path $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        return
    }

    $target = Join-Path $DestinationRoot $RelativePath
    $targetParent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

if (Test-Path -LiteralPath $ResolvedOutputPath) {
    $resolvedExisting = Resolve-Path -LiteralPath $ResolvedOutputPath
    if (-not $resolvedExisting.Path.StartsWith($ResolvedBuildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the frontend build directory: $($resolvedExisting.Path)"
    }

    Remove-Item -LiteralPath $resolvedExisting.Path -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $ResolvedOutputPath | Out-Null

foreach ($directory in $SourceDirectories) {
    $source = Join-Path $RepoRoot.Path $directory
    if (Test-Path -LiteralPath $source -PathType Container) {
        Copy-DevelopmentTree -Source $source -Destination (Join-Path $ResolvedOutputPath $directory)
    }
}

foreach ($file in $SourceFiles) {
    Copy-DevelopmentFile -RelativePath $file -DestinationRoot $ResolvedOutputPath
}

$manifest = [ordered]@{
    name = "WAV QC Studio Development Source"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceRoot = $RepoRoot.Path
    installedFolderName = "Development"
    directories = $SourceDirectories
    files = $SourceFiles
    excludedDirectoryNames = @($ExcludedDirectoryNames)
    excludedFilePatterns = $ExcludedFilePatterns
}

$manifestPath = Join-Path $ResolvedOutputPath "DEVELOPMENT_SOURCE_MANIFEST.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$fileCount = (Get-ChildItem -LiteralPath $ResolvedOutputPath -Recurse -File -Force | Measure-Object).Count
Write-Host "Prepared development source:"
Write-Host "  $ResolvedOutputPath"
Write-Host "  Files: $fileCount"
