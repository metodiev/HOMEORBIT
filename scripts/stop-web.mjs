#!/usr/bin/env node

import {
  fail,
  log,
  processExists,
  readState,
  removeState,
  terminateProcessTree,
} from "./lib/runtime.mjs";

const state = readState("web");
if (!state) {
  log("HomeOrbit web server is not running (no .runtime/web.json state file).");
  process.exit(0);
}

if (!state.pid || !processExists(state.pid)) {
  removeState("web");
  log("HomeOrbit web server was already stopped; removed the stale state file.");
  process.exit(0);
}

log(`Stopping HomeOrbit web server (PID ${state.pid})...`);
const stopped = await terminateProcessTree(state.pid);
removeState("web");

if (!stopped) {
  fail("The web server process could not be stopped. Check the process manually.");
}

log("HomeOrbit web server stopped.");
