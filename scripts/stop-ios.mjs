#!/usr/bin/env node

import { fail, isMac, log, parseArgs, readState, removeState, runCapture } from "./lib/runtime.mjs";
import { appId, parseSimulatorList, pickIosSimulator } from "./lib/mobile.mjs";

const { options } = parseArgs();
const state = readState("ios");
const requested = String(
  options.simulator ?? options.udid ?? process.env.HOMEORBIT_IOS_SIMULATOR ?? state?.udid ?? "",
);

if (!isMac) {
  fail("The iOS Simulator requires macOS with Xcode. Run this script on the Mac Studio.");
}

try {
  let udid = requested;

  if (requested) {
    const { stdout } = await runCapture("xcrun", ["simctl", "list", "devices", "available", "--json"]);
    udid = pickIosSimulator(parseSimulatorList(stdout), requested)?.udid ?? requested;
  } else {
    const { stdout } = await runCapture("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
    const parsed = JSON.parse(stdout);
    const booted = Object.values(parsed.devices ?? {})
      .flat()
      .find((device) => device.state === "Booted" && device.name.startsWith("iPhone"));
    udid = booted?.udid ?? "";
  }

  if (!udid) {
    removeState("ios");
    log("No booted iOS Simulator was found; nothing to stop.");
    process.exit(0);
  }

  await runCapture("xcrun", ["simctl", "terminate", udid, appId], { allowFailure: true });
  await runCapture("xcrun", ["simctl", "shutdown", udid], { allowFailure: true });
  removeState("ios");
  log(`HomeOrbit iOS app stopped and simulator ${udid} shut down.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
