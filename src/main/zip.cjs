"use strict";
// Minimal zip reader/writer (stored + deflate), so mods can ship as one small file
// and be read straight from memory without unpacking to disk.
const zlib = require("node:zlib");

const MAX_ENTRY = 64 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Normalise an archive path; null when it could escape the archive. */
function cleanName(name) {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) return null;
  return parts.join("/");
}

/**
 * Index a zip held in a Buffer. Nothing is inflated until read() is called.
 * Returns { names, read(name) -> Buffer|null }.
 */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 archives are not supported");
  if (total > MAX_ENTRIES) throw new Error(`zip has too many entries (${total})`);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const raw = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (raw.endsWith("/")) continue;
    const name = cleanName(raw);
    if (name === null) throw new Error(`unsafe path in zip: ${raw}`);
    if (name === "" || name.startsWith("__MACOSX/")) continue;
    if (flags & 1) throw new Error(`encrypted zip entry: ${raw}`);
    if (usize > MAX_ENTRY) throw new Error(`zip entry too large: ${raw}`);
    entries.set(name, { method, crc, csize, usize, local });
  }
  const cache = new Map();
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (cache.has(name)) return cache.get(name);
      const o = e.local;
      if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
      const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
      const data = buf.subarray(start, start + e.csize);
      let out;
      if (e.method === 0) out = Buffer.from(data);
      else if (e.method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      else throw new Error(`unsupported compression method ${e.method} for ${name}`);
      if (out.length !== e.usize || crc32(out) !== e.crc) throw new Error(`checksum mismatch for ${name}`);
      cache.set(name, out);
      return out;
    },
  };
}

/** entries: [{ name, data: Buffer }] -> zip Buffer (fixed timestamps, so output is reproducible). */
function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // utf-8 names
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(0, 10); // 00:00:00
    head.writeUInt16LE(0x0021, 12); // 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x0021, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

module.exports = { readZip, writeZip, cleanName, crc32 };
