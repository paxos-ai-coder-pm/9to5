// "Share a copy": zip a project folder, without dependencies (zlib's raw deflate + a hand-written container).
// Leaves out what shouldn't be shared: secrets (.env), git history, the studio's own files, and heavy generated folders.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", ".venv", "venv", "__pycache__", ".next", ".nuxt", "target", ".gradle", ".dart_tool", "Pods", ".idea", ".vscode"]);
const SKIP_FILE = (name) => name === ".DS_Store" || name === "Thumbs.db" || (/^\.env(\..*)?$/.test(name) && !/\.(example|sample|template)$/.test(name));

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function listFiles(dir) {
  const out = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(abs, e.name), r);
      } else if (e.isFile() && !SKIP_FILE(e.name)) out.push(r);
    }
  })(dir, "");
  return out.sort();
}

/** Zip `dir` into a Buffer; every entry sits under `<rootName>/`. Throws if it's too big to share this way. */
export function zipDirectory(dir, { rootName = path.basename(dir), maxBytes = 300 * 1024 * 1024 } = {}) {
  const files = listFiles(dir);
  if (files.length > 65000) throw new Error("This project has too many files to zip.");
  const locals = [];
  const central = [];
  let offset = 0;
  let total = 0;
  for (const rel of files) {
    const full = path.join(dir, rel);
    const stat = fs.statSync(full);
    total += stat.size;
    if (total > maxBytes) throw new Error(`This project is over ${Math.round(maxBytes / 1048576)} MB — too big to share as a zip.`);
    const data = fs.readFileSync(full);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const name = Buffer.from(`${rootName}/${rel}`, "utf8");
    const { time, date } = dosTime(stat.mtime);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
