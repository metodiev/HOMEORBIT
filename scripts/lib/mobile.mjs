import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  capacitorCli,
  ensureRuntimeDir,
  executable,
  isWindows,
  log,
  logPath,
  projectRoot,
  run,
  runCapture,
  sleep,
  tailFile,
  terminateProcessTree,
} from "./runtime.mjs";

export const appId = "com.homeorbit.family";

function unescapeGradlePath(value) {
  return value
    .trim()
    .replace(/\\\\/g, "\\")
    .replace(/\\:/g, ":")
    .replace(/\\(.)/g, "$1");
}

function sdkFromLocalProperties() {
  const file = path.join(projectRoot, "android", "local.properties");
  try {
    const content = fs.readFileSync(file, "utf8");
    const match = /^sdk\.dir=(.+)$/m.exec(content);
    return match ? unescapeGradlePath(match[1]) : null;
  } catch {
    return null;
  }
}

export function findAndroidSdk() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    sdkFromLocalProperties(),
    isWindows ? path.join(localAppData, "Android", "Sdk") : null,
    isWindows ? "C:\\Android\\Sdk" : null,
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const adb = path.join(candidate, "platform-tools", `adb${executable}`);
    if (fs.existsSync(adb)) return candidate;
  }
  return null;
}

export function androidTools() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    throw new Error(
      "Android SDK not found. Set ANDROID_HOME/ANDROID_SDK_ROOT or create android/local.properties.",
    );
  }

  const adb = path.join(sdk, "platform-tools", `adb${executable}`);
  const emulator = path.join(sdk, "emulator", `emulator${executable}`);
  const gradle = path.join(projectRoot, "android", isWindows ? "gradlew.bat" : "gradlew");
  const apk = path.join(projectRoot, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

  return { sdk, adb, emulator, gradle, apk };
}

export async function listAdbDevices(adb) {
  const { stdout } = await runCapture(adb, ["devices"]);
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*"))
    .map((line) => {
      const [serial, state] = line.split(/\s+/, 2);
      return { serial, state };
    })
    .filter((device) => device.serial && device.state === "device");
}

export function pickAndroidDevice(devices) {
  return devices.find((device) => device.serial.startsWith("emulator-")) ?? devices[0] ?? null;
}

export async function listAvds(emulator) {
  if (!fs.existsSync(emulator)) {
    throw new Error(`Android emulator executable not found at ${emulator}. Install an emulator image in Android Studio.`);
  }
  const { stdout } = await runCapture(emulator, ["-list-avds"]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function waitForAndroidBoot(adb, serial, options = {}) {
  const { timeoutMs = 180_000, intervalMs = 2_000 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { stdout } = await runCapture(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"], {
      allowFailure: true,
    });
    if (stdout.trim() === "1") return;
    await sleep(intervalMs);
  }

  throw new Error(`Android device ${serial} did not finish booting within ${Math.round(timeoutMs / 1000)} seconds.`);
}

export async function startAndroidEmulator(adb, emulator, avd, options = {}) {
  const args = ["-avd", avd, "-no-boot-anim", "-netdelay", "none", "-netspeed", "full"];
  if (options.headless) {
    args.push("-no-window", "-gpu", "swiftshader_indirect");
  }

  ensureRuntimeDir();
  const logFile = logPath("android-emulator");
  const logFd = fs.openSync(logFile, "a");
  fs.writeSync(logFd, `\n=== Android emulator start ${new Date().toISOString()} (${avd}) ===\n`);

  log(`Starting Android emulator ${avd}...`);
  const sdk = path.dirname(path.dirname(emulator));
  const child = spawn(emulator, args, {
    cwd: projectRoot,
    env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: false,
  });
  fs.closeSync(logFd);
  child.unref();

  let exitCode = null;
  child.once("exit", (code) => {
    exitCode = code;
  });

  const deadline = Date.now() + 240_000;
  try {
    while (Date.now() < deadline) {
      const devices = await listAdbDevices(adb);
      const emulatorDevice = devices.find((device) => device.serial.startsWith("emulator-"));
      if (emulatorDevice) {
        await waitForAndroidBoot(adb, emulatorDevice.serial);
        return emulatorDevice.serial;
      }
      if (exitCode !== null) {
        throw new Error(
          `Android emulator ${avd} exited during startup (code ${exitCode}). See ${path.relative(
            projectRoot,
            logFile,
          )}.`,
        );
      }
      await sleep(2_000);
    }
  } catch (error) {
    await terminateProcessTree(child.pid);
    const output = tailFile(logFile, 30);
    if (output) console.error(`\nLast emulator log lines:\n${output}`);
    throw error;
  }

  await terminateProcessTree(child.pid);
  throw new Error(`Android emulator ${avd} did not appear in adb within 240 seconds. See ${path.relative(projectRoot, logFile)}.`);
}

export async function syncCapacitor(platform) {
  if (!fs.existsSync(capacitorCli)) {
    throw new Error("Capacitor CLI is not installed. Run `npm install` first.");
  }
  log(`Syncing Capacitor ${platform} assets...`);
  await run(process.execPath, [capacitorCli, "sync", platform], { cwd: projectRoot });
}

export async function buildAndroidDebug() {
  const tools = androidTools();
  const env = { ...process.env, ANDROID_HOME: tools.sdk, ANDROID_SDK_ROOT: tools.sdk };
  if (!isWindows) {
    try {
      fs.chmodSync(tools.gradle, 0o755);
    } catch {
      // The wrapper may already be executable.
    }
  }

  log("Building Android debug APK...");
  await run(tools.gradle, ["assembleDebug"], {
    cwd: path.join(projectRoot, "android"),
    env,
    shell: isWindows,
  });
  return tools;
}

export function parseSimulatorList(stdout) {
  const parsed = JSON.parse(stdout);
  return Object.values(parsed.devices ?? {})
    .flat()
    .filter((device) => device.isAvailable !== false);
}

export function pickIosSimulator(devices, requested) {
  if (requested) {
    const match = devices.find(
      (device) => device.udid === requested || device.name.toLowerCase() === requested.toLowerCase(),
    );
    if (!match) throw new Error(`iOS simulator "${requested}" was not found.`);
    return match;
  }

  return (
    devices.find((device) => device.state === "Booted" && device.name.startsWith("iPhone")) ??
    devices.find((device) => device.name.startsWith("iPhone")) ??
    devices.find((device) => device.state === "Booted") ??
    devices[0] ??
    null
  );
}
