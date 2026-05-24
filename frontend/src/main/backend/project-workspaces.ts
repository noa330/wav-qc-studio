import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { CreateProjectRequest, CreateProjectResult } from "@shared/ipc";
import { resolveProjectRoot } from "./project-layout";

export const managedProjectsFolderName = "projects";
const managedProjectUsersFolderName = "users";
export const defaultManagedProjectName = "기본 프로젝트";
const maxProjectNameLength = 80;
const reservedWindowsNames = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export async function createManagedProjectFolder(request: CreateProjectRequest): Promise<CreateProjectResult> {
  const name = normalizeProjectName(request.name);
  if (!name) {
    return { ok: false, error: "프로젝트 이름을 입력하세요." };
  }

  const folderName = sanitizeProjectFolderName(name);
  if (!folderName) {
    return { ok: false, error: "폴더 이름으로 사용할 수 있는 프로젝트 이름을 입력하세요." };
  }
  if (folderName !== name) {
    return { ok: false, error: "프로젝트 이름에 폴더 이름으로 사용할 수 없는 문자가 있습니다." };
  }

  const projectsRoot = resolveManagedProjectsRoot();
  const rootPath = join(projectsRoot, folderName);

  try {
    await mkdir(projectsRoot, { recursive: true });
    await mkdir(rootPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return { ok: false, error: "같은 이름의 프로젝트 폴더가 이미 있습니다." };
    }

    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    name,
    rootPath,
  };
}

export function resolveManagedProjectsRoot(): string {
  return join(resolveProjectRoot(), managedProjectsFolderName, managedProjectUsersFolderName, currentUserProjectsFolderName());
}

function currentUserProjectsFolderName(): string {
  const identity = readCurrentUserIdentity();
  const label = sanitizeProjectFolderName(identity.username) || "user";
  const hash = createHash("sha1")
    .update(`${identity.domain}\\${identity.username}|${identity.home}`)
    .digest("hex")
    .slice(0, 10);
  return `${label}_${hash}`;
}

function readCurrentUserIdentity(): { username: string; domain: string; home: string } {
  try {
    const info = userInfo();
    return {
      username: info.username || "user",
      domain: process.env.USERDOMAIN || "",
      home: info.homedir || "",
    };
  } catch {
    return {
      username: process.env.USERNAME || process.env.USER || "user",
      domain: process.env.USERDOMAIN || "",
      home: process.env.USERPROFILE || process.env.HOME || "",
    };
  }
}

function normalizeProjectName(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, maxProjectNameLength);
}

function sanitizeProjectFolderName(value: string): string {
  const normalized = normalizeProjectName(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");
  const safeName = normalized || "";
  return reservedWindowsNames.has(safeName.toLowerCase()) ? "" : safeName;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
