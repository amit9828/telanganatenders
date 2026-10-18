import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createWorker } from 'tesseract.js';

function ocrCacheRoot() {
  return process.env.GEM_OCR_CACHE || path.join(os.tmpdir(), 'gem-ocr');
}

const cache = new Map();

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, sum]);
}

function grayPng(gray, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  const scan = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y += 1) {
    gray.copy(scan, y * (1 + width) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scan)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageStreams(buffer) {
  const latin = buffer.toString('latin1');
  const images = [];
  let from = 0;
  while (images.length < 40) {
    const at = latin.indexOf('/Subtype /Image', from);
    if (at < 0) break;
    const dictStart = latin.lastIndexOf('<<', at);
    const dictEnd = latin.indexOf('>>', at);
    const dict = latin.slice(Math.max(0, dictStart), dictEnd);
    const width = Number(dict.match(/\/Width\s+(\d+)/)?.[1] || 0);
    const height = Number(dict.match(/\/Height\s+(\d+)/)?.[1] || 0);
    const bpc = Number(dict.match(/\/BitsPerComponent\s+(\d+)/)?.[1] || 8);
    const filter = dict.match(/\/Filter\s*\/([A-Za-z0-9]+)/)?.[1] || '';
    const streamAt = latin.indexOf('stream', dictEnd);
    const endAt = latin.indexOf('endstream', streamAt + 6);
    if (!width || !height || streamAt < 0 || endAt < 0) {
      from = at + 16;
      continue;
    }
    let dataStart = streamAt + 'stream'.length;
    if (buffer[dataStart] === 13 && buffer[dataStart + 1] === 10) dataStart += 2;
    else if (buffer[dataStart] === 10) dataStart += 1;
    let dataEnd = endAt;
    if (buffer[dataEnd - 1] === 10) dataEnd -= 1;
    if (buffer[dataEnd - 1] === 13) dataEnd -= 1;
    images.push({ width, height, bpc, filter, bytes: buffer.subarray(dataStart, dataEnd) });
    from = endAt + 9;
  }
  return images;
}

function samplePacked(raw, width, height, bpc, step) {
  const outW = Math.ceil(width / step);
  const outH = Math.ceil(height / step);
  const gray = Buffer.alloc(outW * outH);
  const rowBytes = Math.ceil((width * bpc) / 8);
  const max = (1 << bpc) - 1;
  for (let y = 0; y < outH; y += 1) {
    const srcY = Math.min(height - 1, y * step);
    const row = srcY * rowBytes;
    for (let x = 0; x < outW; x += 1) {
      const srcX = Math.min(width - 1, x * step);
      const bit = srcX * bpc;
      const byte = raw[row + (bit >> 3)] || 0;
      const shift = 8 - bpc - (bit & 7);
      const value = shift >= 0 ? (byte >> shift) & max : (byte << -shift) & max;
      gray[y * outW + x] = Math.round((value / max) * 255);
    }
  }
  return { gray, outW, outH };
}

function pageImage(image) {
  const step = Math.max(1, Math.round(image.width / 1500));
  if (image.filter === 'DCTDecode') return image.bytes;
  const raw = image.filter === 'FlateDecode' ? zlib.inflateSync(image.bytes) : image.bytes;
  if (image.bpc === 8 && step === 1 && raw.length >= image.width * image.height) {
    return grayPng(raw.subarray(0, image.width * image.height), image.width, image.height);
  }
  const { gray, outW, outH } = samplePacked(raw, image.width, image.height, image.bpc, step);
  return grayPng(gray, outW, outH);
}

export async function ocrEmptyPdf(buffer, maxPages = Infinity) {
  const key = `${buffer.length}:${buffer.subarray(0, 16).toString('hex')}:${maxPages}`;
  if (cache.has(key)) return cache.get(key);
  const cacheDir = path.join(ocrCacheRoot(), 'pages');
  const cacheFile = path.join(cacheDir, `${crypto.createHash('sha256').update(buffer).digest('hex')}.txt`);
  if (maxPages === Infinity && fs.existsSync(cacheFile)) {
    const saved = fs.readFileSync(cacheFile, 'utf8');
    cache.set(key, saved);
    return saved;
  }
  const images = imageStreams(buffer).filter((image) => image.width > 200 && image.height > 200).slice(0, maxPages);
  if (!images.length) return '';
  const worker = await createWorker('eng', 1, {
    cachePath: path.join(ocrCacheRoot(), 'worker'),
  });
  const pages = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = pageImage(images[index]);
      const result = await worker.recognize(image);
      const text = String(result?.data?.text || '').trim();
      if (text) pages.push(text);
      console.log(`  OCR page ${index + 1}/${images.length}: ${text.length} characters`);
    }
  } finally {
    await worker.terminate();
  }
  const text = pages.join('\n\n');
  cache.set(key, text);
  if (maxPages === Infinity && text) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, text);
  }
  return text;
}
