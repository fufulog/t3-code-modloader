"use strict";
// Just enough of Electron's asar format to replace one file in an archive:
//   [u32 4][u32 headerSize][u32 payloadSize][u32 jsonLength][json, padded to 4][file data...]
// File offsets in the header are relative to the end of the header, so replacing a
// file only needs a new header and the new bytes appended after the old data; no
// other file moves and nothing else is re-read.

const crypto = require("node:crypto");
const fs = require("node:fs");

const BLOCK = 4 * 1024 * 1024;

function readHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) < 16 || head.readUInt32LE(0) !== 4) throw new Error(`${file} is not an asar archive`);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    if (headerSize > 64 * 1024 * 1024 || jsonLength + 8 > headerSize) throw new Error(`${file}: unreasonable asar header`);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    return { header: JSON.parse(json.toString("utf8")), dataStart: 8 + headerSize, size: fs.fstatSync(fd).size };
  } finally {
    fs.closeSync(fd);
  }
}

function lookup(header, rel) {
  let node = header;
  for (const part of rel.split("/").filter(Boolean)) {
    node = node?.files?.[part];
    if (!node) return null;
  }
  return node;
}

function readFile(file, rel) {
  const { header, dataStart } = readHeader(file);
  const node = lookup(header, rel);
  if (!node || node.files) return null;
  if (node.unpacked) throw new Error(`${rel} is stored unpacked, not inside the archive`);
  const buf = Buffer.alloc(node.size);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset));
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function integrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK) blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + BLOCK)).digest("hex"));
  if (!blocks.length) blocks.push(crypto.createHash("sha256").digest("hex"));
  return { algorithm: "SHA256", hash: crypto.createHash("sha256").update(buf).digest("hex"), blockSize: BLOCK, blocks };
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const padded = (json.length + 3) & ~3;
  const out = Buffer.alloc(16 + padded);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(8 + padded, 4);
  out.writeUInt32LE(4 + padded, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return out;
}

/** Write `src` to `dest` with file `rel` replaced by `content`. */
function replaceFile(src, dest, rel, content) {
  const { header, dataStart, size } = readHeader(src);
  const node = lookup(header, rel);
  if (!node || node.files) throw new Error(`${rel} is not in ${src}`);
  if (node.unpacked) throw new Error(`${rel} is stored unpacked`);
  const dataLength = size - dataStart;
  node.size = content.length;
  node.offset = String(dataLength);
  if (node.integrity) node.integrity = integrity(content);
  const out = fs.openSync(dest, "w");
  const input = fs.openSync(src, "r");
  try {
    fs.writeSync(out, encodeHeader(header));
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    for (let pos = dataStart; pos < size; ) {
      const n = fs.readSync(input, chunk, 0, Math.min(chunk.length, size - pos), pos);
      if (n <= 0) throw new Error(`short read from ${src}`);
      fs.writeSync(out, chunk, 0, n);
      pos += n;
    }
    fs.writeSync(out, content);
  } finally {
    fs.closeSync(out);
    fs.closeSync(input);
  }
}

/** Test helper: build an archive from { "dir/name": Buffer }. */
function build(files) {
  const header = { files: {} };
  const parts = [];
  let offset = 0;
  for (const [rel, data] of Object.entries(files)) {
    const bits = rel.split("/");
    let dir = header;
    for (const b of bits.slice(0, -1)) dir = dir.files[b] ??= { files: {} };
    dir.files[bits.at(-1)] = { size: data.length, offset: String(offset), integrity: integrity(data) };
    parts.push(data);
    offset += data.length;
  }
  return Buffer.concat([encodeHeader(header), ...parts]);
}

module.exports = { readHeader, readFile, replaceFile, build, lookup };
