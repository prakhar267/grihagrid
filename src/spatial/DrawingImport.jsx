import { useEffect, useRef, useState } from 'react'
import { spatialUUID } from './ids.js'
import { sanitizedSvg } from './drawing-svg.js'
import { recognizeRaster, recognitionToBuilding, roomsFromWalls, calibrateScale, dimensionCandidates } from './drawing-recognition.js'
import { validateBuilding, pointInPolygon } from './model.js'
import './layout-editor.css'

const uid = prefix => `${prefix}-${spatialUUID().slice(0, 8)}`
const middle = polygon => polygon.reduce((sum, p) => [sum[0] + p[0] / polygon.length, sum[1] + p[1] / polygon.length], [0, 0])

async function imageCanvas(file) {
  let blob = file
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) blob = new Blob([sanitizedSvg(await file.text())], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob), img = new Image()
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The drawing could not be decoded. Use a PNG, JPEG, SVG or PDF.')); img.src = url })
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 100000000) throw new Error('Use a drawing smaller than 100 megapixels.')
    const scale = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = document.createElement('canvas')
    canvas.width = Math.max(8, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(8, Math.round(img.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally { URL.revokeObjectURL(url) }
}

export default function DrawingImport({ model, onChange, onStatus, onCancel }) {
  const [source, setSource] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [threshold, setThreshold] = useState(180), [gap, setGap] = useState(70), [tool, setTool] = useState('select'), [selected, setSelected] = useState(null)
  const [scalePoints, setScalePoints] = useState([]), [distance, setDistance] = useState('4'), [mmPerPixel, setMmPerPixel] = useState(null), [trace, setTrace] = useState([])
  const [reviewed, setReviewed] = useState(false), [manualEdits, setManualEdits] = useState(0), [ocr, setOcr] = useState(null), [progress, setProgress] = useState('')
  const [pdfPage, setPdfPage] = useState(1), [pdfCount, setPdfCount] = useState(0), [height, setHeight] = useState(3), [thickness, setThickness] = useState(0.18)
  const svg = useRef(null), drag = useRef(null), pdf = useRef(null), pdfTask = useRef(null), ocrWorker = useRef(null), pendingJob = useRef(0), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; pendingJob.current++; pdfTask.current?.destroy().catch(() => {}); ocrWorker.current?.terminate() } }, [])
  const notify = message => { if (typeof onStatus === 'function') onStatus(message) }
  const edit = updater => { setResult(current => typeof updater === 'function' ? updater(current) : updater); setReviewed(false); setManualEdits(value => value + 1); setError('') }
  const pixel = event => { const point = svg.current.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const next = point.matrixTransform(svg.current.getScreenCTM().inverse()); return [Math.max(0, Math.min(source.width, next.x)), Math.max(0, Math.min(source.height, next.y))] }
  function loadCanvas(canvas, name) {
    const context = canvas.getContext('2d', { willReadFrequently: true }), pixels = context.getImageData(0, 0, canvas.width, canvas.height), nextSource = { name, width: canvas.width, height: canvas.height, pixels, url: canvas.toDataURL('image/png') }
    const initialGap = Math.round(Math.min(canvas.width, canvas.height) * 0.105)
    setGap(initialGap); setSource(nextSource); setResult(recognizeRaster(pixels, { threshold: Number(threshold), maxGap: initialGap })); setScalePoints([]); setMmPerPixel(null); setReviewed(false); setManualEdits(0); setOcr(null); setSelected(null); setTrace([]); setTool('scale'); setError('')
    notify('Drawing decoded and analyzed in this browser. Calibrate one known dimension, then review the detected geometry.')
  }
  async function loadPdfPage(pdfDocument, pageNumber, name) {
    const page = await pdfDocument.getPage(pageNumber), original = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(2, 1100 / Math.max(original.width, original.height)) })
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (alive.current) { loadCanvas(canvas, name); setPdfPage(pageNumber) }
  }
  async function upload(file) {
    if (!file) return
    const job = ++pendingJob.current; setBusy('Reading drawing'); setError(''); setSource(null); setResult(null); setReviewed(false); setMmPerPixel(null); setScalePoints([]); setOcr(null)
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file smaller than 25 MB.')
      await pdfTask.current?.destroy(); pdfTask.current = null; pdf.current = null; setPdfCount(0)
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pdfjs = await import('pdfjs-dist'), worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false, useSystemFonts: true, standardFontDataUrl: '/spatial-pdf/standard_fonts/', cMapUrl: '/spatial-pdf/cmaps/', cMapPacked: true, wasmUrl: '/spatial-pdf/wasm/' }); pdfTask.current = loadingTask
        const document = await loadingTask.promise
        if (job !== pendingJob.current) { await loadingTask.destroy(); return }
        pdf.current = document; setPdfCount(document.numPages); await loadPdfPage(document, 1, file.name)
      } else {
        const canvas = await imageCanvas(file)
        if (job === pendingJob.current) loadCanvas(canvas, file.name)
      }
    } catch (e) { if (alive.current) setError(e.message) } finally { if (alive.current) setBusy('') }
  }
  function recognize() {
    if (!source) return
    try { setResult(recognizeRaster(source.pixels, { threshold: Number(threshold), maxGap: Number(gap) })); setReviewed(false); setManualEdits(0); setSelected(null); setError('') } catch (e) { setError(e.message) }
  }
  function rebuildRooms(current) {
    const nextRooms = roomsFromWalls(current.walls, source.width, source.height)
    return { ...current, rooms: nextRooms.map((room, index) => ({ ...room, name: current.rooms[index]?.name || room.name })) }
  }
  function finishTrace() {
    try {
      if (trace.length < 3) { setError('Mark at least three corners before closing the room.'); return }
      const room = { id: uid('traced-room'), name: `Traced room ${result.rooms.length + 1}`, polygon: trace, confidence: 1 }
      const walls = trace.map((start, i) => ({ id: uid('traced-wall'), start, end: trace[(i + 1) % trace.length], thickness: 5, confidence: 1 }))
      edit(current => ({ ...current, rooms: [...current.rooms, room], walls: [...current.walls, ...walls] })); setTrace([]); setTool('select'); setSelected({ type: 'room', id: room.id })
    } catch (e) { setError(e.message) }
  }
  function addDoor() {
    try {
      const length = Math.hypot(selectedWall.end[0] - selectedWall.start[0], selectedWall.end[1] - selectedWall.start[1])
      const opening = { id: uid('manual-opening'), wallId: selectedWall.id, offset: length * 0.35, width: mmPerPixel ? 900 / mmPerPixel : length * 0.2, kind: 'door', confidence: 1 }
      edit(current => ({ ...current, openings: [...current.openings, opening] }))
    } catch (e) { setError(e.message) }
  }
  function clickCanvas(event) {
    try {
      if (drag.current?.moved) return
      const point = pixel(event)
      if (tool === 'scale') { setScalePoints(points => points.length >= 2 ? [point] : [...points, point]); setMmPerPixel(null); setReviewed(false) }
      if (tool === 'trace') setTrace(points => [...points, point])
      if (tool === 'wall') {
        if (!trace.length) setTrace([point])
        else { const wall = { id: uid('manual-wall'), start: trace[0], end: point, thickness: 5, confidence: 1 }; edit(current => rebuildRooms({ ...current, walls: [...current.walls, wall] })); setTrace([]) }
      }
    } catch (e) { setError(e.message) }
  }
  function setCalibrationPoint(index, axis, value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return
    const points = [scalePoints[0] || [0, 0], scalePoints[1] || [0, 0]].map(point => [...point])
    points[index][axis] = Math.max(0, Math.min(axis === 0 ? source.width : source.height, number))
    setScalePoints(points); setMmPerPixel(null); setReviewed(false); setError('')
  }
  function calibrate() {
    try { if (scalePoints.length !== 2) throw new Error('Choose both ends of a known dimension on the drawing.'); setMmPerPixel(calibrateScale(scalePoints[0], scalePoints[1], Number(distance) * 1000)); setTool('select'); setReviewed(false); setError('') } catch (e) { setError(e.message) }
  }
  async function readText() {
    setBusy('Reading labels locally'); setProgress('Loading the local OCR runtime'); setError('')
    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, { workerPath: '/spatial-ocr/worker.min.js', corePath: '/spatial-ocr/tesseract-core-simd-lstm.wasm.js', langPath: '/spatial-ocr', workerBlobURL: false, gzip: true, logger: update => { if (alive.current) setProgress(`${update.status} ${Math.round((update.progress || 0) * 100)}%`) } })
      ocrWorker.current = worker
      const recognized = await worker.recognize(source.url, {}, { text: true, blocks: true })
      if (!alive.current) return
      const lines = (recognized.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)), labels = lines.filter(line => line.confidence >= 35 && /living|kitchen|bed|bath|study|office|dining|hall|store|balcony|garden|terrace|lounge/i.test(line.text))
      setOcr({ text: recognized.data.text, confidence: recognized.data.confidence, dimensions: dimensionCandidates(recognized.data.text), labels })
      edit(current => ({ ...current, rooms: current.rooms.map(room => { const label = labels.find(line => pointInPolygon([(line.bbox.x0 + line.bbox.x1) / 2, (line.bbox.y0 + line.bbox.y1) / 2], room.polygon)); return label ? { ...room, name: label.text.trim().replace(/\s+/g, ' ').slice(0, 80) } : room }) }))
      notify('OCR ran on this device. Recognized dimensions and labels are candidates; confirm them against the drawing.')
    } catch (e) { if (alive.current) setError(`Local OCR could not finish: ${e.message}. You can still calibrate and name rooms manually.`) } finally { await ocrWorker.current?.terminate(); ocrWorker.current = null; if (alive.current) { setBusy(''); setProgress('') } }
  }
  function removeSelected() {
    if (!selected) return
    edit(current => selected.type === 'wall' ? rebuildRooms({ ...current, walls: current.walls.filter(w => w.id !== selected.id), openings: current.openings.filter(o => o.wallId !== selected.id) }) : selected.type === 'room' ? { ...current, rooms: current.rooms.filter(r => r.id !== selected.id) } : { ...current, openings: current.openings.filter(o => o.id !== selected.id) })
    setSelected(null)
  }
  function apply() {
    try {
      const next = recognitionToBuilding(result, { mmPerPixel, name: source.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported drawing', wallHeight: Number(height) * 1000, wallThickness: Number(thickness) * 1000 })
      const validation = validateBuilding(next)
      if (!validation.valid) throw new Error(validation.errors.slice(0, 5).join(' '))
      onChange(next); notify(`Created ${next.rooms.length} rooms from your reviewed drawing geometry. ${manualEdits ? 'Manual corrections were included.' : 'The geometry came from local pixel recognition.'}`)
    } catch (e) { setError(e.message) }
  }
  const selectedWall = result?.walls.find(wall => selected?.type === 'wall' && wall.id === selected.id), selectedRoom = result?.rooms.find(room => selected?.type === 'room' && room.id === selected.id), selectedOpening = result?.openings.find(opening => selected?.type === 'opening' && opening.id === selected.id)
  function openingLine(opening) { const wall = result.walls.find(w => w.id === opening.wallId); if (!wall) return null; const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy); return { wall, start: [wall.start[0] + dx * opening.offset / length, wall.start[1] + dy * opening.offset / length], end: [wall.start[0] + dx * (opening.offset + opening.width) / length, wall.start[1] + dy * (opening.offset + opening.width) / length] } }
  return <section className="le-drawing" aria-label="Import and review a drawing">
    <div className="le-heading"><div><span className="sp-eyebrow">FROM YOUR DRAWING</span><h2>Read it. Check it. Build it.</h2><p>Your image stays in this browser. Recognition follows straight and slightly uneven walls at any angle, including simple irregular rooms. Curves, overlapping outlines and strong perspective distortion need manual correction.</p></div>{onCancel && <button type="button" onClick={onCancel}>Close import</button>}</div>
    <div className="le-import-file"><label>Choose a drawing <input aria-label="Choose drawing file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.svg,.pdf" disabled={Boolean(busy)} onChange={event => upload(event.target.files?.[0])}/></label><small>PNG, JPEG, WebP, SVG or PDF · up to 25 MB · no upload or provider call</small></div>
    {busy && <p className="le-status" role="status">{busy}{progress ? ` · ${progress}` : '…'}</p>}
    {source && result && <>
      <div className="le-toolbar" role="group" aria-label="Drawing correction tools">{[['select', 'Select'], ['scale', 'Calibrate'], ['trace', 'Trace room'], ['wall', 'Add wall']].map(([id, label]) => <button key={id} type="button" aria-pressed={tool === id} onClick={() => { setTool(id); setTrace([]) }}>{label}</button>)}<button type="button" disabled={trace.length < 3 || tool !== 'trace'} onClick={finishTrace}>Close traced room</button><button type="button" disabled={!selected} onClick={removeSelected}>Delete selected</button>{pdfCount > 1 && <label>PDF page <select aria-label="PDF page" value={pdfPage} onChange={async event => { setBusy('Reading PDF page'); try { await loadPdfPage(pdf.current, Number(event.target.value), source.name) } catch (e) { setError(e.message) } finally { setBusy('') } }}>{Array.from({ length: Math.min(pdfCount, 500) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}</div>
      <div className="le-drawing-grid"><div className="le-drawing-stage">
        <svg ref={svg} viewBox={`0 0 ${source.width} ${source.height}`} role="group" aria-label="Drawing with detected walls, rooms and scale points" onClick={clickCanvas}
          onPointerMove={event => { if (!drag.current) return; const point = pixel(event); drag.current.moved = true; const { id, end } = drag.current; edit(current => ({ ...current, walls: current.walls.map(wall => wall.id === id ? { ...wall, [end]: point } : wall) })) }}
          onPointerUp={() => { if (drag.current) { if (drag.current.moved) setResult(current => rebuildRooms(current)); setTimeout(() => { drag.current = null }, 0) } }} onPointerCancel={() => { drag.current = null }}>
          <image href={source.url} width={source.width} height={source.height}/>
          {result.rooms.map(room => { const c = middle(room.polygon); return <g key={room.id} role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Detected ${room.name}`} aria-pressed={selected?.id === room.id} onClick={event => { if (tool !== 'select') return; event.stopPropagation(); setSelected({ type: 'room', id: room.id }) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ type: 'room', id: room.id }) } }}><polygon points={room.polygon.map(p => p.join(',')).join(' ')} fill={selected?.id === room.id ? '#b86d3559' : '#b6bf913d'} stroke="#6e8068" strokeWidth="1" pointerEvents={tool === 'select' ? 'auto' : 'none'}/><text x={c[0]} y={c[1]} textAnchor="middle" fontSize={Math.max(9, source.width / 70)} fill="#263322" paintOrder="stroke" stroke="#ffffff" strokeWidth="3" style={{ pointerEvents: 'none' }}>{room.name}</text></g> })}
          {result.walls.map(wall => <g key={wall.id}><line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke={selected?.id === wall.id ? '#962f12' : wall.confidence < 0.65 ? '#b97139' : '#416c58'} strokeWidth={selected?.id === wall.id ? 5 : 3} strokeDasharray={wall.confidence < 0.65 ? '7 4' : undefined} style={{ pointerEvents: 'none' }}/><line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke="transparent" strokeWidth="13" role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Select detected wall ${wall.id}`} style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none' }} onClick={event => { if (tool === 'select') { event.stopPropagation(); setSelected({ type: 'wall', id: wall.id }) } }} onKeyDown={event => { if (event.key === 'Enter') setSelected({ type: 'wall', id: wall.id }) }}/></g>)}
          {result.openings.map(opening => { const line = openingLine(opening); return line && <line key={opening.id} x1={line.start[0]} y1={line.start[1]} x2={line.end[0]} y2={line.end[1]} stroke={opening.kind === 'door' ? '#2c81a4' : '#8b5aa0'} strokeWidth="8" strokeDasharray="3 2" role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Select detected ${opening.kind} ${opening.id}`} aria-pressed={selected?.id === opening.id} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ type: 'opening', id: opening.id }) } }} onClick={event => { if (tool === 'select') { event.stopPropagation(); setSelected({ type: 'opening', id: opening.id }) } }} style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none' }}/ > })}
          {selectedWall && ['start', 'end'].map(end => <circle key={end} cx={selectedWall[end][0]} cy={selectedWall[end][1]} r="6" fill="#fff" stroke="#a7532f" strokeWidth="2" onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: selectedWall.id, end, moved: false } }} onClick={event => event.stopPropagation()}/>)}
          {trace.length > 0 && <polyline points={trace.map(p => p.join(',')).join(' ')} fill="none" stroke="#a7532f" strokeWidth="3" strokeDasharray="5 3" style={{ pointerEvents: 'none' }}/>}
          {scalePoints.length === 2 && <line x1={scalePoints[0][0]} y1={scalePoints[0][1]} x2={scalePoints[1][0]} y2={scalePoints[1][1]} stroke="#215ca0" strokeWidth="2" style={{ pointerEvents: 'none' }}/>}
          {scalePoints.map((point, i) => <g key={i} style={{ pointerEvents: 'none' }}><circle cx={point[0]} cy={point[1]} r="5" fill="#215ca0"/><text x={point[0] + 8} y={point[1] - 8} fontSize="14" fill="#215ca0">{i + 1}</text></g>)}
        </svg>
        <p className="le-stage-help">{tool === 'scale' ? 'Click the two ends of one known dimension, then enter its real length.' : tool === 'trace' ? 'Click each corner in order. Close traced room when the outline is complete. This is manual tracing.' : tool === 'wall' ? 'Click two endpoints to add a correction wall. Rooms will be recalculated.' : 'Select a wall to drag its endpoints. Green room fills are proposed enclosed spaces; dashed copper edges need review.'}</p>
      </div><aside className="le-inspector">
        <h3>Scale & construction</h3><div className="le-calibration-points"><h4>Reference points (pixels)</h4><p>Click both ends in the drawing, or enter their pixel coordinates here.</p>{[0, 1].map(index => <div className="le-vertex-row" key={index}><span>{index + 1}</span>{[0, 1].map(axis => <label key={axis}>Point {index + 1} {axis ? 'Y' : 'X'}<input aria-label={`Calibration point ${index + 1} ${axis ? 'Y' : 'X'}`} type="number" min="0" max={axis ? source.height : source.width} step="1" value={scalePoints[index] ? Number(scalePoints[index][axis].toFixed(2)) : ''} onChange={event => setCalibrationPoint(index, axis, event.target.value)}/></label>)}</div>)}</div><label>Known distance (m)<input aria-label="Known drawing distance in metres" type="number" min=".1" step=".1" value={distance} onChange={event => { setDistance(event.target.value); setMmPerPixel(null); setReviewed(false) }}/></label><button type="button" disabled={scalePoints.length !== 2} onClick={calibrate}>Set calibrated scale</button><p>{mmPerPixel ? `${mmPerPixel.toFixed(2)} mm / pixel · calibrated by you` : `${scalePoints.length} of 2 scale points selected`}</p><label>Wall height (m)<input type="number" min="2.2" max="6" step=".1" value={height} onChange={event => { setHeight(event.target.value); setReviewed(false) }}/></label><label>Wall thickness (m)<input type="number" min=".08" max=".6" step=".01" value={thickness} onChange={event => { setThickness(event.target.value); setReviewed(false) }}/></label>
        <h3>Recognition settings</h3><label>Ink threshold <input aria-label="Drawing ink threshold" type="range" min="40" max="240" value={threshold} onChange={event => setThreshold(event.target.value)}/></label><label>Largest door gap (pixels)<input aria-label="Maximum detected door gap" type="number" min="3" max="220" value={gap} onChange={event => setGap(event.target.value)}/></label><button type="button" onClick={recognize} disabled={Boolean(busy)}>Run pixel recognition again</button><small>Rerunning replaces correction geometry. Calibration stays attached to this image.</small>
        {selectedRoom && <><h3>Selected room</h3><label>Room name<input value={selectedRoom.name} maxLength="80" onChange={event => edit(current => ({ ...current, rooms: current.rooms.map(room => room.id === selectedRoom.id ? { ...room, name: event.target.value } : room) }))}/></label></>}
        {selectedWall && <><h3>Selected wall</h3><p>Pixel support: {Math.round(selectedWall.confidence * 100)}% · review required</p><button type="button" onClick={addDoor}>Add door to wall</button></>}
        {selectedOpening && <><h3>Selected opening</h3><label>Type<select value={selectedOpening.kind} onChange={event => edit(current => ({ ...current, openings: current.openings.map(o => o.id === selectedOpening.id ? { ...o, kind: event.target.value } : o) }))}><option value="door">Door</option><option value="window">Window</option></select></label><label>Offset ({mmPerPixel ? 'm' : 'pixels'})<input type="number" step={mmPerPixel ? '.05' : '1'} value={Number((selectedOpening.offset * (mmPerPixel ? mmPerPixel / 1000 : 1)).toFixed(3))} onChange={event => edit(current => ({ ...current, openings: current.openings.map(o => o.id === selectedOpening.id ? { ...o, offset: Number(event.target.value) / (mmPerPixel ? mmPerPixel / 1000 : 1) } : o) }))}/></label><label>Width ({mmPerPixel ? 'm' : 'pixels'})<input type="number" step={mmPerPixel ? '.05' : '1'} value={Number((selectedOpening.width * (mmPerPixel ? mmPerPixel / 1000 : 1)).toFixed(3))} onChange={event => edit(current => ({ ...current, openings: current.openings.map(o => o.id === selectedOpening.id ? { ...o, width: Number(event.target.value) / (mmPerPixel ? mmPerPixel / 1000 : 1) } : o) }))}/></label></>}
      </aside></div>
      <div className="le-recognition-review"><div><h3>{result.rooms.length} rooms · {result.walls.length} walls · {result.openings.length} proposed openings</h3><ul>{result.issues.filter(issue => issue.id !== 'scale' || !mmPerPixel).map(issue => <li key={issue.id}>{issue.text}</li>)}</ul><p>{manualEdits ? `${manualEdits} correction actions included. Traced shapes are manual input.` : 'All current geometry was detected from this image; none was loaded from the demonstration house.'}</p></div><div><button type="button" disabled={Boolean(busy)} onClick={readText}>Read labels & dimensions on this device</button><p>Optional OCR downloads the app’s local language model, then processes the image in your browser. No image or extracted text is sent to an AI provider.</p>{ocr && <><p>OCR confidence {Math.round(ocr.confidence)}% · verify against your drawing.</p>{ocr.dimensions.length > 0 && <label>Candidate dimension<select defaultValue="" onChange={event => { setDistance(String(Number(event.target.value) / 1000)); setMmPerPixel(null); setReviewed(false); setTool('scale') }}><option value="" disabled>Choose a dimension to calibrate…</option>{ocr.dimensions.map((candidate, i) => <option key={i} value={candidate.distanceMm}>{candidate.text} · unverified</option>)}</select></label>}<details><summary>Recognized text</summary><pre>{ocr.text}</pre></details></>}</div></div>
      <label className="le-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)}/> I reviewed the detected rooms, openings, scale and construction assumptions against my drawing.</label><button type="button" className="le-primary" disabled={!reviewed || !mmPerPixel || !result.rooms.length || Boolean(busy)} onClick={apply}>Create model from reviewed geometry</button><p className="le-muted">This replaces the open spatial study after your review. Save through Change Study to create an accepted project revision.</p>
    </>}
    {error && <p className="le-error" role="alert">{error}</p>}
  </section>
}
