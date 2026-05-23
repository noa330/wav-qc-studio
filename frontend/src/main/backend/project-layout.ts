import { app } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function climbForMarker(startPath: string, markerRelativePath: string): string | null {
  let current = resolve(startPath);

  for (let index = 0; index < 10; index += 1) {
    if (existsSync(join(current, markerRelativePath))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

export function resolveProjectRoot(markerRelativePath = join("backend", "main.py")): string {
  const candidates = new Set<string>([
    process.env.WAV_QC_PROJECT_ROOT ?? "",
    process.resourcesPath,
    join(process.resourcesPath, "app"),
    app.getAppPath(),
    join(app.getAppPath(), ".."),
    process.cwd(),
    join(process.cwd(), ".."),
    __dirname,
    join(__dirname, ".."),
    join(__dirname, "..", ".."),
  ]);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const found = climbForMarker(candidate, markerRelativePath);
    if (found) {
      return found;
    }
  }

  return process.cwd();
}

export type BackendLayout = {
  projectRoot: string;
  pythonPath: string;
  scriptPath: string;
};

export function createBackendLayout(options: {
  markerScript: "main.py" | "slicer_main.py" | "noise_main.py" | "batch_qc_main.py" | "voice_train_main.py" | "voice_infer_main.py";
  venvFolder: ".venv" | ".venv_noise" | ".ven_slice";
}): BackendLayout {
  const markerRelativePath = join("backend", options.markerScript);
  const projectRoot = resolveProjectRoot(markerRelativePath);

  return {
    projectRoot,
    pythonPath: join(projectRoot, options.venvFolder, "Scripts", "python.exe"),
    scriptPath: join(projectRoot, "backend", options.markerScript),
  };
}
