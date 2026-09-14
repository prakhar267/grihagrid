import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { recognizeRaster } from '../src/spatial/drawing-recognition.js'
import { validateBuilding } from '../src/spatial/model.js'
import { raster, rotatedPlan, polygonPlan, rotate } from '../tests/fixtures/drawing-rasters.mjs'

const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local test origin required.')
const output = new URL('../qa-artifacts/spatial-recognition/', import.meta.url)
await mkdir(output, { recursive: true })
const baselineRef = process.env.SPATIAL_RECOGNITION_BASELINE || 'e6fad7d'
assert.match(baselineRef, /^[a-f0-9]{7,40}$/)
const baselineSource = execFileSync('git', ['show', `${baselineRef}:src/spatial/drawing-recognition.js`], { encoding: 'utf8' })
const baseline = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`)
const fixtures = [
  { name: 'rotated-17', ...rotatedPlan(17), rooms: 1 },
  { name: 'rotated-37-shared-door', ...rotatedPlan(37, { partition: true }), rooms: 2 },
  { name: 'skewed', ...polygonPlan([[80, 75], [485, 110], [535, 390], [55, 435]]), rooms: 1 },
  { name: 'diagonal-concave', ...polygonPlan([[-170, -130], [170, -130], [170, 0], [0, 0], [0, 170], [-170, 170]].map(p => rotate(p, 13))), rooms: 1 },
  { name: 'uneven-freehand', ...rotatedPlan(17, { thickness: 3, wobble: 2.5, uneven: true }), rooms: 1 },
  { name: 'blank-rejected', input: raster(), rooms: 0 },
]
const unfinished = rotatedPlan(17), open = raster()
for (let i = 0; i < 3; i++) open.stroke(unfinished.corners[i], unfinished.corners[i + 1])
const fill = raster()
for (let y = 100; y < 300; y++) for (let x = 100; x < 300; x++) { const i = (y * fill.width + x) * 4; fill.data[i] = fill.data[i + 1] = fill.data[i + 2] = 0 }
fixtures.push({ name: 'solid-fill-rejected', input: fill, rooms: 0 })
fixtures.push({ name: 'unclosed-rejected', input: open, rooms: 0 })

function png({ width, height, data }) {
  const crc = bytes => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (name, data) => { const kind = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([kind, data]))); return Buffer.concat([length, kind, data, checksum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const scan = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(scan, y * (width * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))])
}
const sourceFiles = ['src/spatial/drawing-recognition.js', 'src/spatial/drawing-geometry.js', 'src/spatial/drawing-orthogonal.js', 'src/spatial/DrawingImport.jsx', 'tests/fixtures/drawing-rasters.mjs', 'tests/fixtures/read-png.mjs', 'tests/fixtures/labeled-floorplan.png', 'tests/drawing-recognition-angles.test.mjs', 'scripts/check-spatial-recognition.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])))
const result = { at: new Date().toISOString(), origin, baselineRef, baselineSourceSha256: createHash('sha256').update(baselineSource).digest('hex'), sourceHashes, rasterChecks: [], browserChecks: [], errors: [], externalRequests: [] }
for (const fixture of fixtures) {
  const before = baseline.recognizeRaster(fixture.input, { maxGap: 45 }), started = performance.now(), after = recognizeRaster(fixture.input, { maxGap: 45 }), recognitionMs = performance.now() - started
  assert.equal(after.rooms.length, fixture.rooms, fixture.name)
  const source = png(fixture.input)
  await writeFile(new URL(`${fixture.name}.png`, output), source)
  result.rasterChecks.push({ name: fixture.name, expectedRooms: fixture.rooms, beforeRooms: before.rooms.length, beforeWalls: before.walls.length, afterRooms: after.rooms.length, afterWalls: after.walls.length, proposedOpenings: after.openings.length, recognitionMs, pngSha256: createHash('sha256').update(source).digest('hex'), expectedCorners: fixture.corners || null, observedPolygons: after.rooms.map(r => r.polygon) })
}
await writeFile(new URL('baseline-comparison.json', output), JSON.stringify(result, null, 2))
if (!process.argv.includes('--baseline-only')) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } })
  page.on('pageerror', e => result.errors.push(e.message))
  page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data:|blob:)/.test(request.url()) && request.url() !== 'http://127.0.0.1:43127/health') result.externalRequests.push({ method: request.method(), url: request.url() }) })
  try {
    await page.goto(`${origin}/explore`)
    await page.getByRole('button', { name: '2D Plan', exact: true }).click()
    for (const fixture of fixtures) {
      if (!await page.locator('.le-drawing').count()) await page.getByRole('button', { name: /Import a drawing/i }).click()
      await page.getByLabel('Choose drawing file').setInputFiles(new URL(`${fixture.name}.png`, output).pathname)
      await page.locator('.le-recognition-review h3').filter({ hasText: new RegExp(`^${fixture.rooms} rooms`) }).waitFor({ timeout: 20000 })
      const create = page.getByRole('button', { name: 'Create model from reviewed geometry', exact: true })
      assert.equal(await create.isDisabled(), true, 'Uncalibrated or unreviewed geometry must remain blocked.')
      if (fixture.rooms) {
        const points = fixture.corners.slice(0, 2), distance = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) * 0.02
        for (let i = 0; i < 2; i++) for (let axis = 0; axis < 2; axis++) await page.getByRole('spinbutton', { name: `Calibration point ${i + 1} ${axis ? 'Y' : 'X'}`, exact: true }).fill(String(points[i][axis]))
        await page.getByLabel('Known drawing distance in metres').fill(String(distance))
        await page.getByRole('button', { name: 'Set calibrated scale', exact: true }).click()
        assert.equal(await create.isDisabled(), true, 'Scale alone cannot accept the drawing.')
        await page.getByLabel(/I reviewed the detected rooms/).check()
        assert.equal(await create.isEnabled(), true)
        if (fixture.name === 'uneven-freehand') {
          await page.getByRole('button', { name: 'Run pixel recognition again', exact: true }).click()
          assert.equal(await page.getByLabel(/I reviewed the detected rooms/).isChecked(), false)
          assert.equal(await create.isDisabled(), true, 'Rerunning recognition invalidates acceptance.')
          await page.getByLabel(/I reviewed the detected rooms/).check()
        }
        await page.screenshot({ path: new URL(`${fixture.name}-review.png`, output).pathname, fullPage: true })
        await create.click()
        await page.locator('.le-drawing').waitFor({ state: 'detached' })
        assert.equal(await page.locator('.le-error').count(), 0, (await page.locator('.le-error').allTextContents()).join('; '))
        const polygons = await page.getByRole('group', { name: 'Editable building plan', exact: true }).locator('polygon').count()
        assert.ok(polygons >= fixture.rooms)
        result.browserChecks.push({ name: fixture.name, accepted: true, calibratedMmPerPixel: 20, explicitReview: true })
      } else {
        await page.getByLabel(/I reviewed the detected rooms/).check()
        assert.equal(await create.isDisabled(), true)
        await page.screenshot({ path: new URL(`${fixture.name}-review.png`, output).pathname, fullPage: true })
        result.browserChecks.push({ name: fixture.name, accepted: false, creationDisabled: true })
        if (fixture.name === 'blank-rejected') {
          const threshold = page.getByLabel('Drawing ink threshold')
          await threshold.focus(); await threshold.press('ArrowLeft')
          // The next upload must accept the native range input's string value.
        }
      }
    }
    await page.getByRole('button', { name: 'Close import', exact: true }).click()
    await page.getByRole('button', { name: '3D Explore', exact: true }).click()
    await page.getByRole('button', { name: 'Review Change Study', exact: true }).click()
    await page.getByRole('button', { name: 'Accept concept revision', exact: true }).click()
    await page.getByRole('button', { name: 'Camera Tour', exact: true }).click()
    await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click()
    await page.getByRole('button', { name: 'Render / Export', exact: true }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download scene JSON', exact: true }).click()])
    const modelPath = new URL('accepted-uneven-model.json', output)
    await download.saveAs(modelPath.pathname)
    const bundle = JSON.parse(await readFile(modelPath, 'utf8')), validation = validateBuilding(bundle.model)
    assert.equal(validation.valid, true, validation.errors.join('; '))
    assert.equal(bundle.model.rooms.length, 1); assert.equal(bundle.model.walls.length, 4); assert.equal(bundle.model.furniture.length, 0)
    result.browserChecks.push({ name: 'reviewed-model-export', validSharedModel: true, rooms: bundle.model.rooms.length, walls: bundle.model.walls.length, furniture: bundle.model.furniture.length })
    assert.deepEqual(result.errors, []); assert.deepEqual(result.externalRequests, [])
    result.browser = { engine: 'Chrome headless', version: browser.version(), viewport: '1512x1100', physicalDevice: false }
    result.passed = true
  } catch (error) {
    result.passed = false; result.failure = String(error.stack || error)
    await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {})
    throw error
  } finally {
    await writeFile(new URL('verification.json', output), JSON.stringify(result, null, 2))
    await browser.close()
  }
}
console.log(JSON.stringify({ rasterCases: result.rasterChecks.length, browserChecks: result.browserChecks.length, passed: result.passed ?? 'raster only', output: output.pathname }))
