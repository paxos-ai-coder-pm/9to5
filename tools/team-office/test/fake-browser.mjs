#!/usr/bin/env node
// Stands in for headless Chrome in the screenshot tests. Like the real one it starts a helper process (which stays in
// its process group), and records {pid, helper, profile} in FAKE_BROWSER_LOG. FAKE_BROWSER=hang never finishes;
// otherwise it loads the page (FAKE_BROWSER=slow: after 1.5 s), writes a picture if the page answered, and exits,
// leaving the helper running — the office has to clean up after it. FAKE_BROWSER=linger writes the picture and then
// doesn't quit (like Chrome on macOS).
import fs from "node:fs";
import { spawn } from "node:child_process";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify({ pid: process.pid, helper: helper.pid, profile: arg("user-data-dir") }));
if (process.env.FAKE_BROWSER === "hang") setInterval(() => {}, 1000);
else
  setTimeout(async () => {
    const page = await fetch(process.argv.at(-1)).catch(() => null);
    if (!page?.ok) {
      console.error(`net::ERR_CONNECTION_REFUSED ${process.argv.at(-1)}`);
      process.exit(1);
    }
    // a 1×1 PNG
    fs.writeFileSync(arg("screenshot"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    if (process.env.FAKE_BROWSER === "linger") setInterval(() => {}, 1000);
    else process.exit(0);
  }, process.env.FAKE_BROWSER === "slow" ? 1500 : 0);
