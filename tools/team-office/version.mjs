// A fingerprint of the office's own code. The server reports the one it started with (/api/ping); the launcher
// compares it with the code on disk, so an office started before an update is noticed and restarted.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function codeVersion(dir = HERE) {
  const hash = crypto.createHash("sha1");
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === "test" || name === "node_modules" || name.startsWith(".")) continue;
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|html|css)$/.test(name)) {
        hash.update(path.relative(dir, p).split(path.sep).join("/"));
        hash.update(fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n")); // same on a checkout with Windows line endings
      }
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 12);
}
