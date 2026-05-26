const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { getRceditBundle } = require("app-builder-lib/out/toolsets/windows");

const execFileAsync = promisify(execFile);

module.exports = async function afterPackRequireAdmin(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  if (!existsSync(exePath)) {
    throw new Error(`Cannot set administrator manifest. Missing executable: ${exePath}`);
  }

  const iconPath = path.join(context.packager.info.buildResourcesDir, "icon.ico");
  if (!existsSync(iconPath)) {
    throw new Error(`Cannot set application icon. Missing icon: ${iconPath}`);
  }

  const rcedit = await getRceditBundle("1.1.0");

  await execFileAsync(rcedit.x64, [
    exePath,
    "--set-icon",
    iconPath,
    "--set-requested-execution-level",
    "requireAdministrator",
  ]);
};
