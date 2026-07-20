const fs = require("fs");
const zlib = require("zlib");

const input = "kerala.pbf";
const output = "kerala_pbf_places.js";
const data = fs.readFileSync(input);
let offset = 0;
const places = [];
const stats = { primitiveBlocks: 0, denseNodes: 0, namedPlaces: 0 };

while (offset < data.length) {
  const headerSize = data.readUInt32BE(offset);
  offset += 4;
  const header = readMessage(data.subarray(offset, offset + headerSize));
  offset += headerSize;
  const type = header[1]?.[0]?.toString("utf8");
  const dataSize = Number(readVarintFromBuffer(header[3]?.[0] || Buffer.from([0])));
  const blob = readMessage(data.subarray(offset, offset + dataSize));
  offset += dataSize;
  if (type !== "OSMData") continue;

  const blobData = blob[1]?.[0] || zlib.inflateSync(blob[3][0]);
  parsePrimitiveBlock(blobData);
}

const payload = {
  source: input,
  generatedAt: new Date().toISOString(),
  stats,
  places
};

fs.writeFileSync(output, `window.KERALA_PBF_PLACES=${JSON.stringify(payload)};\n`, "utf8");
console.log(`${output} ${places.length} places`);

function parsePrimitiveBlock(buffer) {
  stats.primitiveBlocks += 1;
  const block = readMessage(buffer);
  const stringTable = (readMessage(block[1]?.[0] || Buffer.alloc(0))[1] || []).map((item) => item.toString("utf8"));
  const granularity = firstVarint(block[17], 100);
  const latOffset = firstVarint(block[19], 0);
  const lonOffset = firstVarint(block[20], 0);
  for (const groupBuffer of block[2] || []) {
    const group = readMessage(groupBuffer);
    for (const denseBuffer of group[2] || []) {
      parseDenseNodes(denseBuffer, stringTable, granularity, latOffset, lonOffset);
    }
  }
}

function parseDenseNodes(buffer, stringTable, granularity, latOffset, lonOffset) {
  stats.denseNodes += 1;
  const dense = readMessage(buffer);
  const ids = readPackedSints(dense[1]);
  const lats = readPackedSints(dense[8]);
  const lons = readPackedSints(dense[9]);
  const keyVals = readPackedUints(dense[10]);
  let id = 0;
  let lat = 0;
  let lon = 0;
  let tagIndex = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i] || 0;
    lon += lons[i] || 0;
    const tags = {};
    while (tagIndex < keyVals.length && keyVals[tagIndex] !== 0) {
      const key = stringTable[keyVals[tagIndex++]];
      const value = stringTable[keyVals[tagIndex++]];
      if (key && value) tags[key] = value;
    }
    tagIndex += 1;
    const kind = tags.place || tags.amenity || tags.tourism || tags.shop || tags.office || tags.public_transport;
    if (!tags.name || !kind) continue;
    const latDeg = (latOffset + granularity * lat) / 1e9;
    const lonDeg = (lonOffset + granularity * lon) / 1e9;
    if (latDeg < 8 || latDeg > 13 || lonDeg < 74 || lonDeg > 78) continue;
    places.push({
      id,
      name: tags.name,
      kind,
      lat: Number(latDeg.toFixed(7)),
      lon: Number(lonDeg.toFixed(7))
    });
    stats.namedPlaces += 1;
  }
}

function readMessage(buffer) {
  const fields = {};
  let pos = 0;
  while (pos < buffer.length) {
    const key = readVarint(buffer, pos);
    pos = key.next;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    let value;
    if (wire === 0) {
      const item = readVarint(buffer, pos);
      pos = item.next;
      value = varintToBuffer(item.value);
    } else if (wire === 2) {
      const length = readVarint(buffer, pos);
      pos = length.next;
      value = buffer.subarray(pos, pos + Number(length.value));
      pos += Number(length.value);
    } else if (wire === 1) {
      value = buffer.subarray(pos, pos + 8);
      pos += 8;
    } else if (wire === 5) {
      value = buffer.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`Unsupported wire type ${wire}`);
    }
    if (!fields[field]) fields[field] = [];
    fields[field].push(value);
  }
  return fields;
}

function readPackedSints(buffers = []) {
  const values = [];
  for (const buffer of buffers) {
    let pos = 0;
    while (pos < buffer.length) {
      const item = readVarint(buffer, pos);
      pos = item.next;
      values.push(zigzag(item.value));
    }
  }
  return values;
}

function readPackedUints(buffers = []) {
  const values = [];
  for (const buffer of buffers) {
    let pos = 0;
    while (pos < buffer.length) {
      const item = readVarint(buffer, pos);
      pos = item.next;
      values.push(Number(item.value));
    }
  }
  return values;
}

function firstVarint(buffers, fallback) {
  if (!buffers?.length) return fallback;
  return Number(readVarintFromBuffer(buffers[0]));
}

function readVarintFromBuffer(buffer) {
  return readVarint(buffer, 0).value;
}

function readVarint(buffer, start) {
  let shift = 0n;
  let value = 0n;
  let pos = start;
  while (pos < buffer.length) {
    const byte = BigInt(buffer[pos++]);
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) return { value, next: pos };
    shift += 7n;
  }
  throw new Error("Unterminated varint");
}

function zigzag(value) {
  return Number((value >> 1n) ^ (-(value & 1n)));
}

function varintToBuffer(value) {
  const bytes = [];
  let current = value;
  while (current >= 0x80n) {
    bytes.push(Number((current & 0x7fn) | 0x80n));
    current >>= 7n;
  }
  bytes.push(Number(current));
  return Buffer.from(bytes);
}
