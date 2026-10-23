#!/usr/bin/env node

import { fail, log, parseArgs, readState, removeState, run, runCapture } from "./lib/runtime.mjs";
import { androidTools, appId, listAdbDevices, pickAndroidDevice } from "./lib/mobile.mjs";

const { options } = parseArgs();
const state = readState("android");
const requestedSerial = String(options.serial ?? process.env.HOMEORBIT_ANDROID_SERIAL ?? state?.serial ?? "");

try {
  const tools = androidTools();
  const devices = await listAdbDevices(tools.adb);
  const device = requestedSerial
    ? devices.find((entry) => entry.serial === requestedSerial)
    : devices.find((entry) => entry.serial === state?.serial) ?? pickAndroidDevice(devices);

  if (!device) {
    removeState("android");
    log("No running Android device was found; nothing to stop.");
    process.exit(0);
  }

  log(`Stopping HomeOrbit on ${device.serial}...`);
  await runCapture(tools.adb, ["-s", device.serial, "shell", "am", "force-stop", appId], { allowFailure: true });

  if (device.serial.startsWith("emulator-")) {
    log(`Shutting down Android emulator ${device.serial}...`);
    await run(tools.adb, ["-s", device.serial, "emu", "kill"]);
  } else {
    log("The app was stopped. A physical Android device was left connected.");
  }

  removeState("android");
  log("HomeOrbit Android app stopped.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
