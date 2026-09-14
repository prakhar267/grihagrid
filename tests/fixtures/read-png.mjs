import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

// Test-only decoder for the retained 8-bit RGB/RGBA screenshot fixture.
export function readPng(path) {
  const bytes = readFileSync(path), parts = []; let offset = 8, width, height, channels
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; if (data[8] !== 8 || ![2, 6].includes(data[9])) throw new Error('Expected 8-bit RGB/RGBA fixture.') }
    if (type === 'IDAT') parts.push(data)
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(parts)), row = width * channels, pixels = Buffer.alloc(width * height * channels)
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < height; y++) for (let x = 0; x < row; x++) {
    const filter = raw[y * (row + 1)], a = x >= channels ? pixels[y * row + x - channels] : 0, b = y ? pixels[(y - 1) * row + x] : 0, c = y && x >= channels ? pixels[(y - 1) * row + x - channels] : 0
    pixels[y * row + x] = (raw[y * (row + 1) + 1 + x] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255
  }
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let i = 0; i < width * height; i++) for (let j = 0; j < channels; j++) data[i * 4 + j] = pixels[i * channels + j]
  return { width, height, data }
}
