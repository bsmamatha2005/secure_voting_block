/**
 * Render (and some Linux hosts) ship an older glibc than many sqlite3 prebuilds.
 * Rebuilding the native addon against the host fixes: GLIBC_2.xx not found.
 */
const path = require("node:path");
const { execSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
process.chdir(appRoot);

const isLinux = process.platform === "linux";
const forceRebuild =
  process.env.FORCE_SQLITE3_REBUILD === "1" ||
  process.env.RENDER === "true" ||
  process.env.CI === "true";

if (isLinux || forceRebuild) {
  console.log("[postinstall] Rebuilding sqlite3 from source in", appRoot);
  const env = {
    ...process.env,
    npm_config_build_from_source: "true",
  };
  execSync("npm rebuild sqlite3 --build-from-source", {
    stdio: "inherit",
    shell: true,
    cwd: appRoot,
    env,
  });
}
