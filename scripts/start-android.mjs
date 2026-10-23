#!/usr/bin/env node

import fs from "node:fs";
import { fail, log, parseArgs, run, writeState } from "./lib/runtime.mjs";
import {
  androidTools,
  appId,
  buildAndroidDebug,
  listAdbDevices,
  listAvds,
  pickAndroidDevice,
  startAndroidEmulator,
  syncCapacitor,
  waitForAndroidBoot,
} from "./lib/mobile.mjs";

const { flags, options } = parseArgs();
const skipBuild =
  flags.has("skip-build") || flags.has("no-build") || process.env.HOMEORBIT_SKIP_BUILD === "1";
const headless = flags.has("headless") || process.env.HOMEORBIT_ANDROID_HEADLESS === "1";
const requestedSerial = String(options.serial ?? process.env.HOMEORBIT_ANDROID_SERIAL ?? "");
const requestedAvd = String(options.avd ?? process.env.HOMEORBIT_ANDROID_AVD ?? "");

try {
  const tools = androidTools();
  let device = requestedSerial ? { serial: requestedSerial, state: "device" } : pickAndroidDevice(await listAdbDevices(tools.adb));

  if (!device) {
    const avds = await listAvds(tools.emulator);
    if (avds.length === 0) {
      fail("No Android emulator is running and no AVD is configured. Create one in Android Studio first.");
    }
    const avd = requestedAvd || avds[0];
    if (!avds.includes(avd)) {
      fail(`AVD "${avd}" was not found. Available AVDs: ${avds.join(", ")}`);
    }
    const serial = await startAndroidEmulator(tools.adb, tools.emulator, avd, { headless });
    device = { serial, state: "device" };
  } else if (device.serial.startsWith("emulator-")) {
    await waitForAndroidBoot(tools.adb, device.serial);
  }

  log(`Using Android device ${device.serial}.`);

  if (!skipBuild) {
    await syncCapacitor("android");
    await buildAndroidDebug();
  } else if (!fs.existsSync(tools.apk)) {
    fail(`No debug APK exists at ${tools.apk}. Run without --skip-build first.`);
  }

  log(`Installing ${tools.apk}...`);
  await run(tools.adb, ["-s", device.serial, "install", "-r", tools.apk]);

  log("Launching HomeOrbit...");
  await run(tools.adb, ["-s", device.serial, "shell", "am", "start", "-n", `${appId}/.MainActivity`]);

  writeState("android", {
    serial: device.serial,
    emulator: device.serial.startsWith("emulator-"),
    startedAt: new Date().toISOString(),
  });

  log("");
  log("HomeOrbit Android app launched.");
  log(`Device: ${device.serial}`);
  log(`APK:    ${tools.apk}`);
  log("Server: start the web app with `npm run system:start`.");
  log("URL:    on the Android emulator, use http://10.0.2.2:3000 on first launch.");
  log("Stop:   npm run android:stop");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
