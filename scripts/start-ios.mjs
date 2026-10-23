#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  fail,
  isMac,
  log,
  parseArgs,
  projectRoot,
  run,
  runCapture,
  writeState,
} from "./lib/runtime.mjs";
import {
  appId,
  parseSimulatorList,
  pickIosSimulator,
  syncCapacitor,
} from "./lib/mobile.mjs";

const { flags, options } = parseArgs();
const skipBuild =
  flags.has("skip-build") || flags.has("no-build") || process.env.HOMEORBIT_SKIP_BUILD === "1";
const requested = String(options.simulator ?? options.udid ?? process.env.HOMEORBIT_IOS_SIMULATOR ?? "");
const derivedData = path.join(projectRoot, "ios", "App", "build");
const appPath =
  process.env.HOMEORBIT_IOS_APP_PATH ??
  path.join(derivedData, "Build", "Products", "Debug-iphonesimulator", "App.app");

if (!isMac) {
  fail("iOS builds and the iOS Simulator require macOS with Xcode. Run this script on the Mac Studio.");
}

try {
  const { stdout } = await runCapture("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  const simulator = pickIosSimulator(parseSimulatorList(stdout), requested);
  if (!simulator) {
    fail("No available iOS Simulator was found. Install an iOS Simulator runtime in Xcode.");
  }

  log(`Using iOS Simulator ${simulator.name} (${simulator.udid}).`);
  await runCapture("xcrun", ["simctl", "boot", simulator.udid], { allowFailure: true });
  await run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);
  await runCapture("open", ["-a", "Simulator"], { allowFailure: true });

  if (!skipBuild) {
    await syncCapacitor("ios");
    log("Building HomeOrbit for the iOS Simulator...");
    await run(
      "xcodebuild",
      [
        "-project",
        path.join(projectRoot, "ios", "App", "App.xcodeproj"),
        "-scheme",
        "App",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${simulator.udid}`,
        "-derivedDataPath",
        derivedData,
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
      { cwd: projectRoot },
    );
  } else if (!fs.existsSync(appPath)) {
    fail(`No simulator app exists at ${appPath}. Run without --skip-build first.`);
  }

  if (!fs.existsSync(appPath)) {
    fail(`The built app was not found at ${appPath}.`);
  }

  log(`Installing ${appPath}...`);
  await run("xcrun", ["simctl", "install", simulator.udid, appPath]);
  await run("xcrun", ["simctl", "launch", simulator.udid, appId]);

  writeState("ios", {
    simulator: simulator.name,
    udid: simulator.udid,
    appPath,
    startedAt: new Date().toISOString(),
  });

  log("");
  log("HomeOrbit iOS app launched.");
  log(`Simulator: ${simulator.name} (${simulator.udid})`);
  log("Server:    start the web app with `npm run system:start`.");
  log("URL:       in the iOS Simulator, use http://127.0.0.1:3000 on first launch.");
  log("Stop:      npm run ios:stop");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
