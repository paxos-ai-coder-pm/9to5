#!/usr/bin/env node
// Stands in for headless Chrome in the screenshot tests. Like the real one it starts a helper process (which stays in
// its process group), and records {pid, helper, profile} in FAKE_BROWSER_LOG. FAKE_BROWSER=hang never finishes;
// otherwise it writes a picture and exits, leaving the helper running — the office has to clean up after it.
import fs from "node:fs";
import { spawn } from "node:child_process";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify({ pid: process.pid, helper: helper.pid, profile: arg("user-data-dir") }));
if (process.env.FAKE_BROWSER === "hang") setInterval(() => {}, 1000);
else {
  // a 1×1 PNG
  fs.writeFileSync(arg("screenshot"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  process.exit(0);
}
