// Deterministic raster fixtures: the recognizer receives RGBA pixels only.
// Expected vector geometry is kept separately for independent error checks.
export function raster(width = 640, height = 560) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const stroke = (a, b, { thickness = 3, wobble = 0, uneven = false } = {}) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), steps = Math.ceil(length * 1.5)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, jitter = wobble * Math.sin(t * Math.PI * 2 * length / 45) * Math.sin(Math.PI * t)
      const x = a[0] + dx * t - dy / length * jitter, y = a[1] + dy * t + dx / length * jitter
      const radius = thickness / 2 + (uneven ? (1 + Math.sin(t * 19)) * 0.7 : 0)
      for (let py = Math.floor(y - radius - 1); py <= Math.ceil(y + radius + 1); py++) for (let px = Math.floor(x - radius - 1); px <= Math.ceil(x + radius + 1); px++) {
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        const coverage = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(px - x, py - y))), j = (py * width + px) * 4
        const light = Math.round(255 - coverage * 230)
        data[j] = data[j + 1] = data[j + 2] = Math.min(data[j], light)
      }
    }
  }
  const polygon = (points, options) => points.forEach((p, i) => stroke(p, points[(i + 1) % points.length], options))
  return { width, height, data, stroke, polygon }
}

export const rotate = (point, degrees, origin = [320, 280]) => {
  const a = degrees * Math.PI / 180
  return [origin[0] + point[0] * Math.cos(a) - point[1] * Math.sin(a), origin[1] + point[0] * Math.sin(a) + point[1] * Math.cos(a)]
}

export function rotatedPlan(degrees, options = {}) {
  const input = raster(), corners = [[-180, -125], [180, -125], [180, 125], [-180, 125]].map(p => rotate(p, degrees))
  input.polygon(corners, options)
  if (options.partition) { input.stroke(rotate([0, -125], degrees), rotate([0, -25], degrees), options); input.stroke(rotate([0, 15], degrees), rotate([0, 125], degrees), options) }
  return { input, corners }
}

export function polygonPlan(points, options = {}) {
  const input = raster(); input.polygon(points, options)
  return { input, corners: points }
}

export function rotateRaster(input, degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  const width = Math.ceil(Math.abs(input.width * c) + Math.abs(input.height * s)) + 20, height = Math.ceil(Math.abs(input.width * s) + Math.abs(input.height * c)) + 20
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - width / 2, dy = y - height / 2, ox = Math.round(dx * c + dy * s + input.width / 2), oy = Math.round(-dx * s + dy * c + input.height / 2)
    if (ox < 0 || oy < 0 || ox >= input.width || oy >= input.height) continue
    for (let channel = 0; channel < 4; channel++) data[(y * width + x) * 4 + channel] = input.data[(oy * input.width + ox) * 4 + channel]
  }
  return { width, height, data }
}
