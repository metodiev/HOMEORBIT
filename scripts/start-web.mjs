#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ensureRuntimeDir,
  fail,
  log,
  logPath,
  nextCli,
  parseArgs,
  processExists,
  projectRoot,
  readState,
  removeState,
  run,
  statePath,
  tailFile,
  terminateProcessTree,
  waitForHttp,
  writeState,
} from "./lib/runtime.mjs";

const { flags, options } = parseArgs();
const mode = flags.has("dev") || process.env.HOMEORBIT_DEV === "1" ? "development" : "production";
const port = String(options.port ?? process.env.HOMEORBIT_PORT ?? process.env.PORT ?? "3000");
const host = String(options.host ?? process.env.HOMEORBIT_HOST ?? process.env.HOST ?? "0.0.0.0");
const forceBuild = flags.has("build") || process.env.HOMEORBIT_BUILD === "1";
const stateName = "web";
const state = readState(stateName);

if (state?.pid && processExists(state.pid)) {
  log(`HomeOrbit web server is already running (PID ${state.pid}).`);
  log(`URL:  http://localhost:${state.port ?? port}`);
  log(`Stop: npm run system:stop`);
  process.exit(0);
}

if (state) removeState(stateName);

if (!fs.existsSync(nextCli)) {
  fail("Next.js is not installed. Run `npm install` first.");
}

if (mode === "production" && (forceBuild || !fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID")))) {
  log("Building HomeOrbit for production...");
  await run(process.execPath, [nextCli, "build"], { cwd: projectRoot });
}

ensureRuntimeDir();
const logFile = logPath(stateName);
const logFd = fs.openSync(logFile, "a");
fs.writeSync(logFd, `\n=== HomeOrbit web start ${new Date().toISOString()} ===\n`);

const nextArgs = [nextCli, mode === "development" ? "dev" : "start", "-H", host, "-p", port];
const child = spawn(process.execPath, nextArgs, {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: mode,
    PORT: port,
    HOSTNAME: host,
  },
  detached: true,
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});
fs.closeSync(logFd);
child.unref();

if (!child.pid) {
  fail(`Could not start the HomeOrbit web server. See ${logFile}`);
}

writeState(stateName, {
  pid: child.pid,
  port,
  host,
  mode,
  startedAt: new Date().toISOString(),
  log: path.relative(projectRoot, logFile),
});

let exited = false;
let exitCode = null;
child.once("exit", (code) => {
  exited = true;
  exitCode = code;
});

try {
  await waitForHttp(`http://127.0.0.1:${port}/api/health`, {
    timeoutMs: mode === "development" ? 90_000 : 30_000,
  });
  if (exited) {
    throw new Error(`The server exited during startup (code ${exitCode ?? "unknown"}).`);
  }
} catch (error) {
  await terminateProcessTree(child.pid);
  removeState(stateName);
  const output = tailFile(logFile, 40);
  console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}`);
  if (output) console.error(`\nLast web log lines:\n${output}`);
  console.error(`\nFull log: ${logFile}`);
  process.exit(1);
}

const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address);
const lan = lanAddresses.map((address) => `http://${address}:${port}`);

log("");
log(`HomeOrbit web server started (${mode}).`);
log(`PID:   ${child.pid}`);
log(`Local: http://localhost:${port}`);
if (lan.length > 0) log(`LAN:   ${lan.join("  ")}`);
log(`Log:   ${path.relative(projectRoot, logFile)}`);
log(`State: ${path.relative(projectRoot, statePath(stateName))}`);
log("Stop:  npm run system:stop");
if (mode === "production" && process.env.SESSION_COOKIE_SECURE === undefined) {
  log("");
  log("Note: SESSION_COOKIE_SECURE defaults to true in production. For a plain HTTP LAN");
  log("trial set SESSION_COOKIE_SECURE=false; use HTTPS for any remote access.");
}
