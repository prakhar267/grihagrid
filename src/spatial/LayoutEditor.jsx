import { useEffect, useMemo, useRef, useState } from 'react'
import { spatialUUID } from './ids.js'
import { pointInPolygon, validateBuilding } from './model.js'
import { toV2, stairPolygon, doorLeafPrimitive } from './model-v2.js'
import { applySceneEdit } from './editor-ops.js'
import { clearFloor, nextFloor } from './floor-plans.js'
import FloorTools from './FloorTools.jsx'
import './layout-editor.css'

const id = prefix => `${prefix}-${spatialUUID().slice(0, 8)}`
const metres = value => Number((value / 1000).toFixed(3))
const middle = polygon => polygon.reduce((sum, p) => [sum[0] + p[0] / polygon.length, sum[1] + p[1] / polygon.length], [0, 0])
const kinds = ['chair', 'sofa', 'bed', 'table', 'desk', 'coffee-table', 'counter', 'island', 'stool', 'wardrobe', 'shelf', 'nightstand', 'console', 'rug', 'plant', 'tree', 'lamp', 'bathtub', 'toilet']
const sizes = { chair: [700, 700, 800], sofa: [2400, 900, 850], bed: [1800, 2200, 650], table: [1400, 800, 750], desk: [1400, 650, 750], 'coffee-table': [1100, 600, 400], counter: [1800, 600, 900], island: [1400, 800, 900], stool: [400, 400, 650], wardrobe: [1800, 600, 2200], shelf: [1200, 400, 2000], nightstand: [500, 500, 500], console: [1200, 400, 800], rug: [2500, 1800, 18], plant: [450, 450, 1400], tree: [1800, 1800, 3500], lamp: [400, 400, 1800], bathtub: [1700, 750, 580], toilet: [550, 700, 750] }

function Field({ label, value, onCommit, min, max, step = 0.05, unit = 'm' }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => { const next = Number(draft); if (next === Number(value)) return; if (!Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max) || onCommit(next) === false) setDraft(String(value)) }
  return <label className="le-field">{label}<span><input aria-label={label} type="number" value={draft} min={min} max={max} step={step} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>{unit && <small>{unit}</small>}</span></label>
}
function TextField({ label, value, onCommit }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <label className="le-field">{label}<input aria-label={label} value={draft} maxLength="100" onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== value && onCommit(draft.trim()) === false) setDraft(value) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label>
}

function StairDirection({ stair, floorId }) {
  const up = stair.fromFloorId === floorId
  const from = up ? stair.start : stair.end, to = up ? stair.end : stair.start
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy)
  const ux = dx / length, uy = dy / length, middle = from.map((v, i) => (v + to[i]) / 2)
  const offset = stair.width * .28, half = Math.min(length * .2, 900)
  const center = [middle[0] - uy * offset, middle[1] + ux * offset]
  const tip = [center[0] + ux * half, center[1] + uy * half]
  return <g style={{ pointerEvents: 'none' }}>
    <line x1={center[0] - ux * half} y1={center[1] - uy * half} x2={tip[0]} y2={tip[1]} stroke="#322b22" strokeWidth="30"/>
    <path d={`M${tip[0] - ux * 200 - uy * 120},${tip[1] - uy * 200 + ux * 120} L${tip.join(',')} L${tip[0] - ux * 200 + uy * 120},${tip[1] - uy * 200 - ux * 120}`} fill="none" stroke="#322b22" strokeWidth="30"/>
    <text x={middle[0] + uy * 100} y={middle[1] - ux * 100} textAnchor="middle" dominantBaseline="middle" fontSize="180" fill="#322b22">{up ? 'UP' : 'DOWN'}</text>
  </g>
}

export default function LayoutEditor({ model, onChange, onStatus, selectedRoomId, onSelectRoom, activeFloorId, onActiveFloorChange, disabled = false }) {
  const scene = useMemo(() => toV2(model), [model]), [localFloor, setLocalFloor] = useState(scene.floors[0].id)
  const floorId = scene.floors.some(f => f.id === (activeFloorId || localFloor)) ? (activeFloorId || localFloor) : scene.floors[0].id
  const floor = scene.floors.find(f => f.id === floorId), rooms = scene.rooms.filter(room => room.floorId === floorId)
  const [tool, setTool] = useState('select'), [selection, setSelection] = useState(selectedRoomId ? { type: 'room', id: selectedRoomId } : null), [points, setPoints] = useState([])
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [history, setHistory] = useState([]), [future, setFuture] = useState([]), [snap, setSnap] = useState(100)
  const [furnitureKind, setFurnitureKind] = useState('chair'), [stairTarget, setStairTarget] = useState(''), [view, setView] = useState(null)
  const [removingFloor, setRemovingFloor] = useState(false)
  const removalHeading = useRef(null), removeFloorButton = useRef(null)
  const svg = useRef(null), drag = useRef(null), modelIdentity = useRef({id:model.id,revision:model.revision}), editor = useRef(null), inspector = useRef(null), errorMessage = useRef(null), pendingTool = useRef(null)
  const allPoints = scene.rooms.flatMap(room => room.polygon), extents = { x0: Math.min(...allPoints.map(p => p[0])) - 1800, y0: Math.min(...allPoints.map(p => p[1])) - 1800, x1: Math.max(...allPoints.map(p => p[0])) + 1800, y1: Math.max(...allPoints.map(p => p[1])) + 1800 }
  const fit = () => [extents.x0, extents.y0, extents.x1 - extents.x0, extents.y1 - extents.y0]
  const box = view || fit(), display = preview || scene
  useEffect(() => { if (modelIdentity.current.id !== model.id || model.revision < modelIdentity.current.revision) { setHistory([]); setFuture([]); setSelection(null); setView(null); setPoints([]) } modelIdentity.current = {id:model.id,revision:model.revision} }, [model.id,model.revision])
  useEffect(() => { setTool(pendingTool.current?.floorId === floorId ? pendingTool.current.tool : 'select'); pendingTool.current = null; setPoints([]); setPreview(null); setView(null); setError(''); setRemovingFloor(false); drag.current = null }, [floorId])
  useEffect(() => { setSelection(scene.rooms.some(r => r.id === selectedRoomId && r.floorId === floorId) ? { type: 'room', id: selectedRoomId } : null) }, [selectedRoomId, floorId])
  function chooseFloor(next) { setLocalFloor(next); onActiveFloorChange?.(next); setTool('select'); setSelection(null); setPoints([]); setPreview(null); setView(null); setError(''); drag.current = null }
  function chooseTool(next) { setTool(next); setPoints([]); setError(''); if (next === 'room') window.requestAnimationFrame(() => svg.current?.focus()) }
  const focusFloor = () => window.requestAnimationFrame(() => editor.current?.querySelector('.le-floor-intro h3')?.focus())
  function inspectRoom(roomId) { select('room', roomId); window.requestAnimationFrame(() => inspector.current?.focus()) }
  const status = text => { onStatus?.(text) }
  function commit(operation, message = 'Layout change previewed. Review Change Study before accepting the revision.') {
    if (disabled) return false
    try {
      let next = scene
      if (typeof operation === 'function') {
        const result = operation(scene)
        next = result?.type ? applySceneEdit(scene, result) : result
        const validation = validateBuilding(next)
        if (!validation.valid) throw new Error(validation.errors.slice(0, 3).join(' '))
      } else for (const item of Array.isArray(operation) ? operation : [operation]) next = applySceneEdit(next, item)
      if (selection?.type === 'room' && !next.rooms.some(r => r.id === selection.id)) setSelection(null)
      setHistory(items => [...items.slice(-49), scene]); setFuture([]); setPreview(null); setError(''); onChange(next); status(message); return next
    } catch (e) { setPreview(null); setError(e.message.replace(/Room polygons overlap: [^.]+\./g, 'Rooms cannot overlap on the same floor. Adjust the room position or dimensions.')); window.requestAnimationFrame(() => errorMessage.current?.focus()); return false }
  }
  function restore(direction) {
    if (disabled) return
    const stack = direction === 'undo' ? history : future, snapshot = stack.at(-1)
    if (!snapshot) return
    const next = { ...structuredClone(snapshot), revision: scene.revision + 1 }, validation = validateBuilding(next)
    if (!validation.valid) { setError(validation.errors[0]); return }
    if (direction === 'undo') { setHistory(items => items.slice(0, -1)); setFuture(items => [...items, scene]) } else { setFuture(items => items.slice(0, -1)); setHistory(items => [...items, scene]) }
    onChange(next); setPreview(null); setSelection(null); setError(''); status(`${direction === 'undo' ? 'Undid' : 'Restored'} the last validated layout edit.`)
  }
  function select(type, itemId, extra = {}) {
    setSelection({ type, id: itemId, ...extra }); setError('')
    if (type === 'room') onSelectRoom?.(itemId)
  }
  function point(event, matrix) { const p = svg.current.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const result = p.matrixTransform(matrix || svg.current.getScreenCTM().inverse()); const grid = Number(snap) || 1; return [Math.round(result.x / grid) * grid, Math.round(result.y / grid) * grid] }
  const roomAt = (p, atFloor = floorId) => scene.rooms.find(room => room.floorId === atFloor && pointInPolygon(p, room.polygon))
  const selectedRoom = scene.rooms.find(room => selection?.type === 'room' && room.id === selection.id && room.floorId === floorId)
  const selectedWall = scene.walls.find(wall => selection?.type === 'wall' && wall.id === selection.id)
  const selectedFurniture = scene.furniture.find(item => selection?.type === 'furniture' && item.id === selection.id)
  const openingWall = scene.walls.find(wall => wall.id === selection?.wallId), selectedOpening = openingWall?.openings.find(opening => selection?.type === 'opening' && opening.id === selection.id)
  const selectedStair = scene.stairs.find(stair => selection?.type === 'stair' && stair.id === selection.id)
  function nearestWall(p) {
    const candidates = scene.walls.filter(wall => wall.floorId === floorId).map(wall => { const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy), t = Math.max(0, Math.min(1, ((p[0] - wall.start[0]) * dx + (p[1] - wall.start[1]) * dy) / (length * length))); return { wall, along: t * length, length, distance: Math.hypot(p[0] - wall.start[0] - t * dx, p[1] - wall.start[1] - t * dy) } }).sort((a, b) => a.distance - b.distance)
    return candidates[0]?.distance < Math.max(450, box[2] / 35) ? candidates[0] : null
  }
  function finishRoom() {
    try {
      if (points.length < 3) { setError('Mark three or more corners before closing the room.'); return }
      const room = { id: id('room'), name: `Room ${scene.rooms.length + 1}`, floorId, polygon: points, color: '#d4c5ae', exterior: false }
      if (commit({ type: 'addRoom', room, withWalls: true })) { setPoints([]); setTool('select'); select('room', room.id) }
    } catch (e) { setError(e.message) }
  }
  function click(event) {
    try {
      if (disabled) return
      if (drag.current?.moved) return
      const p = point(event)
      if (tool === 'room') { setPoints(items => [...items, p]); return }
      if (tool === 'wall') {
        if (!points.length) setPoints([p])
        else { const wall = { id: id('wall'), floorId, start: points[0], end: p, height: floor.height, thickness: 180, roomIds: roomAt(p) ? [roomAt(p).id] : [], openings: [] }; if (commit({ type: 'addWall', wall })) { setPoints([]); select('wall', wall.id) } }
      }
      if (tool === 'door' || tool === 'window') {
        const target = nearestWall(p)
        if (!target) { setError('Click close to a wall to place an opening.'); return }
        const width = tool === 'door' ? 900 : 1500, opening = { id: id(tool), kind: tool, offset: Math.max(0, Math.min(target.length - width, target.along - width / 2)), width, sill: tool === 'door' ? 0 : 900, height: tool === 'door' ? 2200 : 1400, open: tool === 'door' }
        if (commit({ type: 'upsertOpening', wallId: target.wall.id, opening })) select('opening', opening.id, { wallId: target.wall.id })
      }
      if (tool === 'furniture') {
        const room = roomAt(p)
        if (!room) { setError('Place furniture inside a room on this floor.'); return }
        const furniture = { id: id(furnitureKind), roomId: room.id, floorId, kind: furnitureKind, position: [...p, 0], size: sizes[furnitureKind], rotation: 0, color: ['plant', 'tree'].includes(furnitureKind) ? '#687b51' : '#b99c79' }
        if (commit({ type: 'upsertFurniture', furniture })) { setTool('select'); select('furniture', furniture.id) }
      }
      if (tool === 'stairs') {
        if (!points.length) setPoints([p])
        else {
          const targetFloor = scene.floors.find(f => f.id === stairTarget && f.elevation > floor.elevation) || scene.floors.find(f => f.elevation > floor.elevation), lower = roomAt(points[0]), upper = targetFloor && roomAt(p, targetFloor.id)
          if (!targetFloor || !lower || !upper) { setError('A staircase needs rooms on both floors. Its complete run must fit within both room footprints.'); return }
          const stair = { id: id('stair'), name: 'New staircase', fromFloorId: floorId, toFloorId: targetFloor.id, start: points[0], end: p, width: 1200, steps: Math.ceil((targetFloor.elevation - floor.elevation) / 190), roomIds: [lower.id, upper.id] }
          if (commit({ type: 'upsertStair', stair })) { setPoints([]); setTool('select'); select('stair', stair.id) }
        }
      }
      if (tool === 'select') setSelection(null)
    } catch (e) { setError(e.message) }
  }
  function beginDrag(event, descriptor) {
    if (disabled) return
    if (tool !== 'select' && tool !== 'pan') return
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { ...descriptor, start: point(event), original: scene, moved: false, view: box, matrix: svg.current.getScreenCTM().inverse() }
  }
  function dragOperation(state, p) {
    const delta = [p[0] - state.start[0], p[1] - state.start[1]]
    if (state.type === 'wall') { const wall = state.original.walls.find(w => w.id === state.id); return { type: 'updateWall', wallId: wall.id, patch: { start: wall.start.map((v, i) => v + delta[i]), end: wall.end.map((v, i) => v + delta[i]) } } }
    if (state.type === 'opening') { const wall = state.original.walls.find(w => w.id === state.wallId), opening = wall.openings.find(o => o.id === state.id), length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]); return { type: 'upsertOpening', wallId: wall.id, opening: { ...opening, offset: opening.offset + delta.reduce((sum, v, i) => sum + v * (wall.end[i] - wall.start[i]) / length, 0) } } }
    if (state.type === 'vertex') return { type: 'moveVertex', roomId: state.id, index: state.index, point: p }
    if (state.type === 'wall-end') return { type: 'updateWall', wallId: state.id, patch: { [state.end]: p } }
    if (state.type === 'furniture') { const item = state.original.furniture.find(f => f.id === state.id), position = [item.position[0] + delta[0], item.position[1] + delta[1], item.position[2]], room = roomAt(position); return { type: 'upsertFurniture', furniture: { ...item, position, roomId: room?.id || item.roomId } } }
    if (state.type === 'room') { const room = state.original.rooms.find(r => r.id === state.id); return { type: 'updateRoom', roomId: room.id, patch: { polygon: room.polygon.map(q => [q[0] + delta[0], q[1] + delta[1]]) } } }
    if (state.type === 'stair-end') { const stair = state.original.stairs.find(s => s.id === state.id); return { type: 'upsertStair', stair: { ...stair, [state.end]: p } } }
    return null
  }
  function moving(event) {
    const state = drag.current
    if (!state) return
    const p = point(event, state.matrix)
    if (Math.hypot(p[0] - state.start[0], p[1] - state.start[1]) < 20) return
    state.moved = true
    if (state.type === 'pan') { setView([state.view[0] - (p[0] - state.start[0]), state.view[1] - (p[1] - state.start[1]), state.view[2], state.view[3]]); return }
    const operation = dragOperation(state, p); state.operation = operation
    if (!operation) return
    const next = structuredClone(state.original)
    if (operation.type === 'upsertOpening') Object.assign(next.walls.find(w => w.id === operation.wallId).openings.find(o => o.id === operation.opening.id), operation.opening)
    if (operation.type === 'moveVertex') next.rooms.find(r => r.id === operation.roomId).polygon[operation.index] = p
    if (operation.type === 'updateWall') Object.assign(next.walls.find(w => w.id === operation.wallId), operation.patch)
    if (operation.type === 'upsertFurniture') Object.assign(next.furniture.find(f => f.id === operation.furniture.id), operation.furniture)
    if (operation.type === 'updateRoom') Object.assign(next.rooms.find(r => r.id === operation.roomId), operation.patch)
    if (operation.type === 'upsertStair') Object.assign(next.stairs.find(s => s.id === operation.stair.id), operation.stair)
    setPreview(next)
  }
  function stopDrag() { const state = drag.current; if (state?.moved && state.operation) commit(state.operation); setPreview(null); setTimeout(() => { drag.current = null }, 0) }
  function removeSelection() {
    if (!selection) return
    const type = selection.type, operation = type === 'room' ? { type: 'removeRoom', roomId: selection.id } : type === 'wall' ? { type: 'removeWall', wallId: selection.id } : type === 'opening' ? { type: 'removeOpening', wallId: selection.wallId, openingId: selection.id } : type === 'furniture' ? { type: 'removeFurniture', furnitureId: selection.id } : { type: 'removeStair', stairId: selection.id }
    if (commit(operation)) setSelection(null)
  }
  function nudge(dx, dy) {
    if (selectedOpening) { const length = Math.hypot(openingWall.end[0] - openingWall.start[0], openingWall.end[1] - openingWall.start[1]); updateOpening({ offset: selectedOpening.offset + (dx * (openingWall.end[0] - openingWall.start[0]) + dy * (openingWall.end[1] - openingWall.start[1])) / length }) }
    else if (selectedFurniture) commit({ type: 'upsertFurniture', furniture: { ...selectedFurniture, position: [selectedFurniture.position[0] + dx, selectedFurniture.position[1] + dy, selectedFurniture.position[2]] } })
    else if (selectedRoom) commit({ type: 'updateRoom', roomId: selectedRoom.id, patch: { polygon: selectedRoom.polygon.map(p => [p[0] + dx, p[1] + dy]) } })
    else if (selectedWall) commit({ type: 'updateWall', wallId: selectedWall.id, patch: { start: [selectedWall.start[0] + dx, selectedWall.start[1] + dy], end: [selectedWall.end[0] + dx, selectedWall.end[1] + dy] } })
    else if (selectedStair) commit({ type: 'upsertStair', stair: { ...selectedStair, start: [selectedStair.start[0] + dx, selectedStair.start[1] + dy], end: [selectedStair.end[0] + dx, selectedStair.end[1] + dy] } })
  }
  function key(event) {
    if (disabled) return
    if (event.target.closest('input,textarea,select,button,a,summary,[contenteditable="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo') }
    if (event.key === 'Escape') { setPoints([]); setTool('select'); setPreview(null) }
    if (event.key === 'Enter' && tool === 'room') { event.preventDefault(); finishRoom() }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection) { event.preventDefault(); removeSelection() }
    const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
    if (directions[event.key] && selection) { event.preventDefault(); nudge(...directions[event.key].map(v => v * (event.shiftKey ? 500 : Number(snap) || 100))) }
  }
  function addFloor() {
    try {
      const next = nextFloor(scene)
      if (commit({ type: 'addFloor', floor: next }, `${next.name} added. Choose a starting layout, copy a floor or add your first room.`)) { chooseFloor(next.id); focusFloor() }
    } catch (e) { setError(e.message) }
  }
  function removeFloor() {
    if (commit(current => clearFloor(current, floorId, true), `${floor.name} deleted. Other floors keep their rooms; Undo restores the removed floor.`)) { setRemovingFloor(false); chooseFloor([...scene.floors].filter(f => f.elevation < floor.elevation).sort((a, b) => b.elevation - a.elevation)[0]?.id || scene.floors[0].id); focusFloor() }
  }
  const openingView = (wall, opening) => { const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy); return [[wall.start[0] + dx * opening.offset / length, wall.start[1] + dy * opening.offset / length], [wall.start[0] + dx * (opening.offset + opening.width) / length, wall.start[1] + dy * (opening.offset + opening.width) / length]] }
  const updateOpening = patch => { const opening = { ...selectedOpening, ...patch }; if (opening.kind === 'window') { delete opening.hinge; delete opening.swing } return commit({ type: 'upsertOpening', wallId: openingWall.id, opening }) }
  const updateFurniture = patch => commit({ type: 'upsertFurniture', furniture: { ...selectedFurniture, ...patch } })
  const updateStair = patch => commit({ type: 'upsertStair', stair: { ...selectedStair, ...patch } })
  return <section ref={editor} className="layout-editor" aria-label="Full layout editor" onKeyDown={key}><fieldset className="le-controls" disabled={disabled}>
    <div className="le-heading"><div><span className="sp-eyebrow">EDIT THE SPATIAL MODEL</span><h2>Every corner is yours.</h2><p>Draw rooms, adjust shared wall vertices, place openings and furniture, and connect floors with real stairs.</p></div><div className="le-history"><button type="button" disabled={!history.length} onClick={() => restore('undo')}>Undo</button><button type="button" disabled={!future.length} onClick={() => restore('redo')}>Redo</button></div></div>
    <div className="le-floorbar"><label>Editing floor<select aria-label="Editing floor" value={floorId} onChange={event => chooseFloor(event.target.value)}>{scene.floors.map(f => <option key={f.id} value={f.id}>{f.name} · {metres(f.elevation)} m</option>)}</select></label><button type="button" disabled={scene.floors.length >= 4} onClick={addFloor}>Add floor</button><button ref={removeFloorButton} type="button" disabled={scene.floors.length < 2 || floor.elevation === 0} onClick={() => { setRemovingFloor(true); window.requestAnimationFrame(() => removalHeading.current?.focus()) }}>Delete floor and contents</button><label>Snap<select aria-label="Layout snap grid" value={snap} onChange={event => setSnap(Number(event.target.value))}><option value="1">Free</option><option value="50">50 mm</option><option value="100">100 mm</option><option value="250">250 mm</option><option value="500">500 mm</option></select></label></div>
    {removingFloor && <section className="le-floor-delete" aria-label="Confirm floor deletion"><h3 ref={removalHeading} tabIndex={-1}>Delete {floor.name}?</h3><p>Remove this floor, its {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}, walls, furniture and connected stairs. Other floors keep their rooms. Undo can restore this edit.</p><div className="le-floor-actions"><button type="button" onClick={removeFloor}>Confirm delete floor</button><button type="button" onClick={() => { setRemovingFloor(false); window.requestAnimationFrame(() => removeFloorButton.current?.focus()) }}>Keep this floor</button></div></section>}
    {error && <p ref={errorMessage} tabIndex={-1} className="le-error" role="alert">{error} The previous valid layout is retained.</p>}
    <FloorTools scene={scene} floorId={floorId} selectedRoomId={selectedRoom?.id} onApply={commit} onSelectRoom={inspectRoom} onTool={chooseTool} disabled={disabled} onDrawStairs={(from, to) => { pendingTool.current = { floorId: from, tool: 'stairs' }; chooseFloor(from); setStairTarget(to); setTool('stairs'); window.requestAnimationFrame(() => svg.current?.focus()) }}/>
    <div className="le-toolbar" role="group" aria-label="Layout drawing tools">{[['select', 'Select / move'], ['pan', 'Pan'], ['room', 'Draw room'], ['wall', 'Wall'], ['door', 'Door'], ['window', 'Window'], ['furniture', 'Furniture'], ['stairs', 'Stairs']].map(([value, label]) => <button key={value} type="button" aria-pressed={tool === value} onClick={() => chooseTool(value)}>{label}</button>)}<button type="button" disabled={tool !== 'room' || points.length < 3} onClick={finishRoom}>Close room</button><button type="button" disabled={!selection} onClick={removeSelection}>Delete selection</button></div>
    <div className="le-editor-grid"><div><div className="le-plan-stage"><svg ref={svg} viewBox={box.join(' ')} role="group" aria-label="Editable building plan" tabIndex="0" onClick={click} onPointerMove={moving} onPointerUp={stopDrag} onPointerCancel={() => { drag.current = null; setPreview(null) }} onPointerDown={event => { if (tool === 'pan') beginDrag(event, { type: 'pan' }) }}>
      <defs><pattern id="layout-mm-grid" width="500" height="500" patternUnits="userSpaceOnUse"><path d="M500 0H0V500" fill="none" stroke="#ddd4c6" strokeWidth="10"/></pattern></defs><rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill="url(#layout-mm-grid)"/>
      {display.rooms.filter(room => room.floorId !== floorId).map(room => <polygon key={room.id} points={room.polygon.map(p => p.join(',')).join(' ')} fill="none" stroke="#b8afa1" strokeWidth="25" strokeDasharray="100 100" style={{ pointerEvents: 'none' }}/ >)}
      {display.rooms.filter(room => room.floorId === floorId).map(room => { const c = middle(room.polygon); return <g key={room.id} role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Edit ${room.name}`} aria-pressed={selection?.id === room.id} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select('room', room.id) } }}>
        <polygon points={room.polygon.map(p => p.join(',')).join(' ')} fill={room.color} fillOpacity={selection?.id === room.id ? 0.9 : 0.52} stroke={selection?.id === room.id ? '#a7532f' : '#8b7e6b'} strokeWidth={selection?.id === room.id ? 50 : 20} style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }} onPointerDown={event => { if (tool === 'select') { select('room', room.id); beginDrag(event, { type: 'room', id: room.id }) } }} onClick={event => { if (tool === 'select') { event.stopPropagation(); select('room', room.id) } }}/><text x={c[0]} y={c[1]} textAnchor="middle" fontSize={Math.max(140, box[2] / 85)} fill="#393126" paintOrder="stroke" stroke="#f3efe6" strokeWidth="40" style={{ pointerEvents: 'none' }}>{room.name}</text>
      </g> })}
      {display.furniture.filter(item => item.floorId === floorId).map(item => <rect key={item.id} x={item.position[0] - item.size[0] / 2} y={item.position[1] - item.size[1] / 2} width={item.size[0]} height={item.size[1]} rx="50" transform={`rotate(${item.rotation * 180 / Math.PI},${item.position[0]},${item.position[1]})`} fill={item.color} stroke={selection?.id === item.id ? '#a7532f' : '#8b755d'} strokeWidth={selection?.id === item.id ? 55 : 20} fillOpacity=".88" role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Edit ${item.kind} ${item.id}`} style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }} onPointerDown={event => { select('furniture', item.id); beginDrag(event, { type: 'furniture', id: item.id }) }} onClick={event => { if (tool === 'select') { event.stopPropagation(); select('furniture', item.id) } }} onKeyDown={event => { if (event.key === 'Enter') select('furniture', item.id) }}/ >)}
      {display.walls.filter(wall => wall.floorId === floorId).map(wall => <g key={wall.id}><line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke={selection?.id === wall.id ? '#a7532f' : '#494135'} strokeWidth={wall.thickness} style={{ pointerEvents: 'none' }}/><line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke="transparent" strokeWidth={Math.max(230, wall.thickness)} role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Edit wall ${wall.id}`} onPointerDown={event => { select('wall', wall.id); beginDrag(event, { type: 'wall', id: wall.id }) }} style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none' }} onClick={event => { if (tool === 'select') { event.stopPropagation(); select('wall', wall.id) } }} onKeyDown={event => { if (event.key === 'Enter') select('wall', wall.id) }}/>{wall.openings.map(opening => { const [a, b] = openingView(wall, opening); return <line key={opening.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={selection?.id === opening.id ? '#ab6546' : opening.kind === 'door' ? '#f7f1e7' : '#88afac'} strokeWidth={wall.thickness + 40} strokeDasharray={opening.kind === 'window' ? '100 20' : undefined} role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Edit ${opening.kind} ${opening.id}`} onPointerDown={event => { select('opening', opening.id, { wallId: wall.id }); beginDrag(event, { type: 'opening', id: opening.id, wallId: wall.id }) }} style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none' }} onClick={event => { if (tool === 'select') { event.stopPropagation(); select('opening', opening.id, { wallId: wall.id }) } }} onKeyDown={event => { if (event.key === 'Enter') select('opening', opening.id, { wallId: wall.id }) }}/ > })}</g>)}
      {display.walls.filter(wall => wall.floorId === floorId).flatMap(wall => wall.openings.filter(opening => opening.kind === 'door').map(opening => {
        const leaf = doorLeafPrimitive(wall, opening), h = leaf.hingePosition, a = leaf.closedEnd, b = leaf.openEnd, radius = opening.width - 70
        const sweep = (a[0] - h[0]) * (b[1] - h[1]) - (a[1] - h[1]) * (b[0] - h[0]) > 0 ? 1 : 0, end = opening.open ? b : a
        return <g key={`swing-${opening.id}`} aria-hidden="true" style={{ pointerEvents: 'none' }}><path d={`M${a[0]} ${a[1]} A${radius} ${radius} 0 0 ${sweep} ${b[0]} ${b[1]}`} fill="none" stroke="#9f7853" strokeWidth="18" strokeDasharray="45 25"/><line x1={h[0]} y1={h[1]} x2={end[0]} y2={end[1]} stroke="#806448" strokeWidth="40"/><circle cx={h[0]} cy={h[1]} r="30" fill="#806448"/></g>
      }))}
      {display.stairs.filter(stair => [stair.fromFloorId, stair.toFloorId].includes(floorId)).map(stair => <g key={stair.id} role="button" tabIndex={tool === 'select' ? 0 : -1} aria-label={`Edit ${stair.name}`} onClick={event => { if (tool === 'select') { event.stopPropagation(); select('stair', stair.id) } }} onKeyDown={event => { if (event.key === 'Enter') select('stair', stair.id) }}><polygon points={stairPolygon(stair).map(p => p.join(',')).join(' ')} fill="#b9a37d" fillOpacity=".5" stroke={selection?.id === stair.id ? '#a7532f' : '#6f6048'} strokeWidth="40" style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }}/>{Array.from({ length: stair.steps }, (_, i) => { const t = i / stair.steps, dx = stair.end[0] - stair.start[0], dy = stair.end[1] - stair.start[1], length = Math.hypot(dx, dy), x = stair.start[0] + dx * t, y = stair.start[1] + dy * t; return <line key={i} x1={x - dy / length * stair.width / 2} y1={y + dx / length * stair.width / 2} x2={x + dy / length * stair.width / 2} y2={y - dx / length * stair.width / 2} stroke="#6f6048" strokeWidth="20" style={{ pointerEvents: 'none' }}/> })}<StairDirection stair={stair} floorId={floorId}/></g>)}
      {selection?.type === 'room' && display.rooms.find(room => room.id === selection.id)?.polygon.map((p, index) => <circle key={index} cx={p[0]} cy={p[1]} r={Math.max(65, box[2] / 140)} fill="#fff9ed" stroke="#a7532f" strokeWidth="30" aria-label={`Room vertex ${index + 1}`} onPointerDown={event => beginDrag(event, { type: 'vertex', id: selection.id, index })} onClick={event => event.stopPropagation()}/>)}
      {selectedWall && ['start', 'end'].map(end => { const wall = display.walls.find(w => w.id === selectedWall.id); return <circle key={end} cx={wall[end][0]} cy={wall[end][1]} r={Math.max(70, box[2] / 140)} fill="#fff9ed" stroke="#a7532f" strokeWidth="30" onPointerDown={event => beginDrag(event, { type: 'wall-end', id: selectedWall.id, end })} onClick={event => event.stopPropagation()}/> })}
      {selectedStair && ['start', 'end'].map(end => { const stair = display.stairs.find(s => s.id === selectedStair.id); return <circle key={end} cx={stair[end][0]} cy={stair[end][1]} r="100" fill="#fff9ed" stroke="#a7532f" strokeWidth="30" onPointerDown={event => beginDrag(event, { type: 'stair-end', id: selectedStair.id, end })} onClick={event => event.stopPropagation()}/> })}
      {points.length > 0 && <polyline points={points.map(p => p.join(',')).join(' ')} fill="none" stroke="#a7532f" strokeWidth="45" strokeDasharray="90 60" style={{ pointerEvents: 'none' }}/ >}
    </svg><div className="le-zoom"><button type="button" aria-label="Zoom plan in" onClick={() => setView([box[0] + box[2] * 0.1, box[1] + box[3] * 0.1, box[2] * 0.8, box[3] * 0.8])}>+</button><button type="button" aria-label="Zoom plan out" onClick={() => setView([box[0] - box[2] * 0.125, box[1] - box[3] * 0.125, box[2] * 1.25, box[3] * 1.25])}>−</button><button type="button" onClick={() => setView(null)}>Fit plan</button></div></div>
      <p className="le-stage-help">{tool === 'room' ? 'Click corners in order, then Close room. New perimeter walls are created with the polygon.' : tool === 'stairs' ? 'Click the bottom and top of a straight stair run. Both floor openings and tread geometry are generated together.' : tool === 'door' || tool === 'window' ? `Click a wall to place a ${tool}, then adjust its dimensions in the inspector.` : tool === 'furniture' ? 'Choose a furniture type, then click a free position inside a room.' : tool === 'wall' ? 'Click two endpoints. Select a wall to move its endpoints or edit its dimensions.' : tool === 'pan' ? 'Drag the plan to move your view. Use the zoom controls to change scale.' : 'Select and drag furniture, rooms or corner handles. Arrow keys nudge the selection; Shift uses 500 mm. Ctrl/Cmd+Z undoes an edit.'}</p></div>
      <aside ref={inspector} tabIndex={-1} className="le-inspector" aria-label="Plan selection inspector">
        {tool === 'furniture' && <><h3>Place furniture</h3><label>Furniture type<select aria-label="Furniture type to add" value={furnitureKind} onChange={event => setFurnitureKind(event.target.value)}>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label></>}
        {tool === 'stairs' && <><h3>Connect floors</h3><label>Upper destination<select aria-label="Stair destination floor" value={stairTarget} onChange={event => setStairTarget(event.target.value)}><option value="">Next upper floor</option>{scene.floors.filter(f => f.elevation > floor.elevation).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><p>Draw a run long enough for 220–500 mm treads and 80–220 mm risers. The opening must fit inside a room on each floor.</p></>}
        {selectedRoom && <><h3>Room</h3><TextField label="Room name" value={selectedRoom.name} onCommit={name => commit({ type: 'updateRoom', roomId: selectedRoom.id, patch: { name } })}/><label>Room color<input aria-label="Room color" type="color" value={selectedRoom.color} onChange={event => commit({ type: 'updateRoom', roomId: selectedRoom.id, patch: { color: event.target.value } })}/></label><label className="le-check"><input type="checkbox" checked={selectedRoom.exterior} onChange={event => commit({ type: 'updateRoom', roomId: selectedRoom.id, patch: { exterior: event.target.checked } })}/> Outdoor ground / terrace</label><details open><summary>Boundary vertices</summary>{selectedRoom.polygon.map((p, index) => <div className="le-vertex-row" key={index}><span>{index + 1}</span><Field label={`Vertex ${index + 1} X`} value={metres(p[0])} onCommit={value => commit({ type: 'moveVertex', roomId: selectedRoom.id, index, point: [value * 1000, p[1]] })}/><Field label={`Vertex ${index + 1} Y`} value={metres(p[1])} onCommit={value => commit({ type: 'moveVertex', roomId: selectedRoom.id, index, point: [p[0], value * 1000] })}/></div>)}</details><button type="button" onClick={() => { const [a, b] = selectedRoom.polygon; commit({ type: 'insertVertex', roomId: selectedRoom.id, index: 0, point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }) }}>Add a boundary corner</button><button type="button" disabled={selectedRoom.polygon.length <= 3} onClick={() => commit({ type: 'removeVertex', roomId: selectedRoom.id, index: selectedRoom.polygon.length - 1 })}>Remove last corner</button></>}
        {selectedWall && <><h3>Wall</h3><Field label="Wall length" value={metres(Math.hypot(selectedWall.end[0] - selectedWall.start[0], selectedWall.end[1] - selectedWall.start[1]))} min={.1} onCommit={value => { const length = Math.hypot(selectedWall.end[0] - selectedWall.start[0], selectedWall.end[1] - selectedWall.start[1]); return commit({ type: 'updateWall', wallId: selectedWall.id, patch: { end: selectedWall.end.map((v, i) => selectedWall.start[i] + (v - selectedWall.start[i]) * value * 1000 / length) } }) }}/><Field label="Wall height" value={metres(selectedWall.height)} min={2.2} max={metres(floor.height)} onCommit={value => commit({ type: 'updateWall', wallId: selectedWall.id, patch: { height: value * 1000 } })}/><Field label="Wall thickness" value={metres(selectedWall.thickness)} min={.02} max={1.5} step={.01} onCommit={value => commit({ type: 'updateWall', wallId: selectedWall.id, patch: { thickness: value * 1000 } })}/>{['start', 'end'].map(end => <div key={end}><h4>{end === 'start' ? 'Start' : 'End'} point</h4>{[0, 1].map(axis => <Field key={axis} label={`${end} ${axis ? 'Y' : 'X'}`} value={metres(selectedWall[end][axis])} onCommit={value => commit({ type: 'updateWall', wallId: selectedWall.id, patch: { [end]: selectedWall[end].map((v, i) => i === axis ? value * 1000 : v) } })}/>)}</div>)}</>}
        {selectedOpening && <><h3>Opening</h3><label>Opening type<select aria-label="Opening type" value={selectedOpening.kind} onChange={event => updateOpening({ kind: event.target.value, sill: event.target.value === 'door' ? 0 : 900, height: event.target.value === 'door' ? 2200 : 1400, open: event.target.value === 'door' })}><option value="door">Door</option><option value="window">Window</option></select></label><Field label="Opening offset" value={metres(selectedOpening.offset)} min={0} onCommit={value => updateOpening({ offset: value * 1000 })}/><Field label="Opening width" value={metres(selectedOpening.width)} min={selectedOpening.kind === 'door' ? .7 : .08} onCommit={value => updateOpening({ width: value * 1000 })}/><Field label="Opening height" value={metres(selectedOpening.height)} min={.1} onCommit={value => updateOpening({ height: value * 1000 })}/>{selectedOpening.kind === 'door' && <><label>Door hinge<select aria-label="Door hinge" value={selectedOpening.hinge || 'start'} onChange={event => updateOpening({ hinge: event.target.value })}><option value="start">Near wall start</option><option value="end">Near wall end</option></select></label><label>Door swing<select aria-label="Door swing" value={selectedOpening.swing || 1} onChange={event => updateOpening({ swing: Number(event.target.value) })}><option value="1">Left side of wall</option><option value="-1">Right side of wall</option></select></label></>}{selectedOpening.kind === 'window' ? <Field label="Window sill" value={metres(selectedOpening.sill)} min={0} onCommit={value => updateOpening({ sill: value * 1000 })}/> : <label className="le-check"><input type="checkbox" checked={Boolean(selectedOpening.open)} onChange={event => updateOpening({ open: event.target.checked })}/> Door open for walking</label>}</>}
        {selectedFurniture && <><h3>{selectedFurniture.kind}</h3><label>Furniture kind<select aria-label="Selected furniture kind" value={selectedFurniture.kind} onChange={event => updateFurniture({ kind: event.target.value })}>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>{[0, 1, 2].map(axis => <Field key={`position-${axis}`} label={`Furniture ${['X', 'Y', 'elevation'][axis]}`} value={metres(selectedFurniture.position[axis])} onCommit={value => updateFurniture({ position: selectedFurniture.position.map((v, i) => i === axis ? value * 1000 : v) })}/>)}{[0, 1, 2].map(axis => <Field key={`size-${axis}`} label={`Furniture ${['width', 'depth', 'height'][axis]}`} value={metres(selectedFurniture.size[axis])} min={.01} onCommit={value => updateFurniture({ size: selectedFurniture.size.map((v, i) => i === axis ? value * 1000 : v) })}/>)}<Field label="Furniture rotation" value={Number((selectedFurniture.rotation * 180 / Math.PI).toFixed(1))} min={-360} max={360} step={15} unit="°" onCommit={value => updateFurniture({ rotation: value * Math.PI / 180 })}/><label>Material color<input aria-label="Furniture material color" type="color" value={selectedFurniture.color} onChange={event => updateFurniture({ color: event.target.value })}/></label></>}
        {selectedStair && <><h3>Staircase</h3><TextField label="Stair name" value={selectedStair.name} onCommit={name => updateStair({ name })}/><Field label="Stair width" value={metres(selectedStair.width)} min={.9} max={3} onCommit={value => updateStair({ width: value * 1000 })}/><Field label="Number of stair treads" value={selectedStair.steps} min={3} max={40} step={1} unit="" onCommit={steps => updateStair({ steps })}/>{['start', 'end'].map(end => <div key={end}><h4>{end === 'start' ? 'Bottom' : 'Top'} point</h4>{[0, 1].map(axis => <Field key={axis} label={`Stair ${end} ${axis ? 'Y' : 'X'}`} value={metres(selectedStair[end][axis])} onCommit={value => updateStair({ [end]: selectedStair[end].map((v, i) => i === axis ? value * 1000 : v) })}/>)}</div>)}<p>{scene.floors.find(f => f.id === selectedStair.fromFloorId)?.name} → {scene.floors.find(f => f.id === selectedStair.toFloorId)?.name}</p></>}
        {!selection && <><h3>{floor.name}</h3><TextField label="Floor name" value={floor.name} onCommit={name => commit({ type: 'updateFloor', floorId, patch: { name } })}/><Field label="Floor elevation" value={metres(floor.elevation)} min={0} onCommit={value => commit({ type: 'updateFloor', floorId, patch: { elevation: value * 1000 } })}/><Field label="Floor height" value={metres(floor.height)} min={2.2} max={6} onCommit={value => commit({ type: 'updateFloor', floorId, patch: { height: value * 1000 } })}/><p>{rooms.length} rooms on this floor. Other floors appear as dashed reference outlines.</p></>}
        {selection && <div className="le-nudge" role="group" aria-label="Nudge selection"><button type="button" onClick={() => nudge(0, -snap)}>↑</button><button type="button" onClick={() => nudge(-snap, 0)}>←</button><button type="button" onClick={() => nudge(snap, 0)}>→</button><button type="button" onClick={() => nudge(0, snap)}>↓</button></div>}
      </aside></div>
    <p className="le-muted">Edits are validated before entering the shared model. Invalid overlaps, openings, furniture bounds and stair dimensions are rejected; accepted project revisions still go through Change Study.</p>
  </fieldset></section>
}
