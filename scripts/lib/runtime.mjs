import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const runtimeDir = path.join(projectRoot, ".runtime");
export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const executable = isWindows ? ".exe" : "";

export const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
export const capacitorCli = path.join(projectRoot, "node_modules", "@capacitor", "cli", "bin", "capacitor");

export function log(message = "") {
  console.log(message);
}

export function fail(message, code = 1) {
  console.error(`\nERROR: ${message}`);
  process.exit(code);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

export function statePath(name) {
  return path.join(runtimeDir, `${name}.json`);
}

export function readState(name) {
  try {
    return JSON.parse(fs.readFileSync(statePath(name), "utf8"));
  } catch {
    return null;
  }
}

export function writeState(name, value) {
  ensureRuntimeDir();
  fs.writeFileSync(statePath(name), `${JSON.stringify(value, null, 2)}\n`);
}

export function removeState(name) {
  try {
    fs.unlinkSync(statePath(name));
  } catch {
    // Already removed.
  }
}

export function logPath(name) {
  return path.join(runtimeDir, `${name}.log`);
}

export function tailFile(file, lines = 30) {
  try {
    const rows = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/);
    return rows.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function run(command, args = [], options = {}) {
  const { cwd = projectRoot, env = process.env, shell = false, stdio = "inherit" } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      stdio,
      windowsHide: !shell,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ code, signal });
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function runCapture(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd ?? projectRoot,
        env: options.env ?? process.env,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && !options.allowFailure) {
          error.stdout = String(stdout ?? "");
          error.stderr = String(stderr ?? "");
          reject(error);
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code: error?.code ?? 0,
        });
      },
    );
  });
}

export async function terminateProcessTree(pid, options = {}) {
  const { graceMs = 8_000 } = options;
  if (!processExists(pid)) return false;

  if (isWindows) {
    await runCapture("taskkill", ["/PID", String(pid), "/T", "/F"], { allowFailure: true });
    return !processExists(pid);
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processExists(pid)) {
    await sleep(200);
  }

  if (processExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process exited between the check and the signal.
      }
    }
  }

  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline && processExists(pid)) {
    await sleep(100);
  }
  return !processExists(pid);
}

export async function waitForHttp(url, options = {}) {
  const { timeoutMs = 30_000, intervalMs = 500 } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      if (response.ok) {
        return await response.json().catch(() => ({}));
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url} (${lastError}).`);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      flags.add(argument);
      continue;
    }

    const [key, ...valueParts] = argument.slice(2).split("=");
    if (valueParts.length > 0) {
      options[key] = valueParts.join("=");
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { flags, options };
}
