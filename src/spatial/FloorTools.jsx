import { useEffect, useRef, useState } from 'react'
import { FLOOR_LAYOUTS, clearFloor, connectFloorBelow, floorReference, populateFloor, rectangularRoom, suggestedRoomPosition } from './floor-plans.js'
import { polygonArea } from './model-v2.js'

function AddRoom({ scene, floorId, onApply, onAdded, onCancel }) {
  const [position] = useState(() => { try { return suggestedRoomPosition(scene, floorId) } catch { return scene.bounds.min.slice(0, 2) } })
  const [values, setValues] = useState({ name: `Room ${scene.rooms.length + 1}`, width: '3', depth: '3', x: String(position[0] / 1000), y: String(position[1] / 1000) })
  const nameInput = useRef(null)
  useEffect(() => { nameInput.current?.focus() }, [])
  const update = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }))
  function submit(event) {
    event.preventDefault()
    let added
    const result = onApply(current => {
      added = rectangularRoom(current, floorId, { name: values.name, ...Object.fromEntries(['x', 'y', 'width', 'depth'].map(key => [key, values[key].trim() ? Number(values[key]) * 1000 : NaN])) })
      return { type: 'addRoom', room: added, withWalls: true }
    }, `${values.name.trim()} added. Select it to rename, move or resize its corners.`)
    if (result) onAdded(added.id)
  }
  return <form className="le-add-room" aria-label="Add a room" onSubmit={submit}>
    <h3>Add a room to {scene.floors.find(f => f.id === floorId).name}</h3>
    <div className="le-room-fields"><label>New room name<input ref={nameInput} name="name" value={values.name} onChange={update} maxLength={100} required/></label>
      {['width', 'depth', 'x', 'y'].map(key => <label key={key}>{key === 'x' || key === 'y' ? `Position ${key.toUpperCase()}` : `Room ${key}`} (m)<input name={key} type="number" value={values[key]} onChange={update} step=".1" min={['width', 'depth'].includes(key) ? 1 : -100} max={['width', 'depth'].includes(key) ? 20 : 100} required/></label>)}
    </div><p>Position uses the plan’s X/Y coordinates. Check additions and extensions against your site limits. Add doors with the Door tool after placing the room.</p>
    <div className="le-floor-actions"><button type="submit" className="le-primary">Add room to plan</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}
export default function FloorTools({ scene, floorId, selectedRoomId, onApply, onSelectRoom, onTool, onDrawStairs, disabled }) {
  const floor = scene.floors.find(f => f.id === floorId), rooms = scene.rooms.filter(r => r.floorId === floorId)
  const sources = scene.floors.filter(f => f.id !== floorId && scene.rooms.some(r => r.floorId === f.id && !r.exterior))
  const lower = scene.floors.filter(f => f.elevation < floor.elevation).sort((a, b) => b.elevation - a.elevation)[0]
  const connected = lower && scene.stairs.some(s => s.fromFloorId === lower.id && s.toFloorId === floorId)
  const [source, setSource] = useState(''), [adding, setAdding] = useState(false), [clearing, setClearing] = useState(false)
  const heading = useRef(null), addButton = useRef(null)
  const sourceId = sources.some(f => f.id === source) ? source : sources.find(f => f.id === lower?.id)?.id || sources[0]?.id || ''
  let reference
  try { reference = floorReference(scene, floorId) } catch { /* manual room entry remains available */ }
  useEffect(() => { setAdding(false); setClearing(false); setSource('') }, [floorId])
  function applyLayout(layout) {
    const result = onApply(current => populateFloor(current, floorId, { layout, sourceFloorId: sourceId }), `Rooms added to ${floor.name}. Review the plan, then connect stairs to the floor below.`)
    if (result) { onTool('select'); setAdding(false); window.requestAnimationFrame(() => heading.current?.focus()) }
  }
  function addRoom() { onTool('select'); setAdding(true); setClearing(false) }
  function cancelRoom() { setAdding(false); window.requestAnimationFrame(() => addButton.current?.focus()) }
  return <section className="le-floor-tools" aria-label={`Plan ${floor.name}`}>
    <div className="le-floor-intro"><div><span className="sp-eyebrow">{rooms.length ? 'YOUR FLOOR PLAN' : 'START THIS FLOOR'}</span><h3 ref={heading} tabIndex={-1}>{rooms.length ? `${floor.name} · ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}` : `${floor.name} is ready for a plan.`}</h3><p>{rooms.length ? 'Choose a room below to edit it, or add another space.' : 'The dashed outlines belong to other floors. Create your own rooms here, or start with a ready-made layout.'}</p></div><div className="le-floor-actions"><button ref={addButton} type="button" className="le-primary" onClick={addRoom} disabled={scene.rooms.length >= 48}>Add room</button><button type="button" onClick={() => { setAdding(false); onTool('room') }}>Draw room corners</button></div></div>
    {!rooms.length && <div className="le-floor-starters">
      {scene.walls.some(w => w.floorId === floorId) && <p className="le-loose-walls">This floor contains loose walls. <button type="button" onClick={() => onApply(current => clearFloor(current, floorId), 'Loose walls cleared. Choose a layout or add a room.')}>Remove loose walls before applying a layout</button></p>}
      <div className="le-template-heading"><h4>Choose a starting layout</h4>{reference && <span>{(reference.width / 1000).toFixed(1)} × {(reference.depth / 1000).toFixed(1)} m reference footprint</span>}</div>
      <div className="le-floor-layouts">{FLOOR_LAYOUTS.map(layout => <article key={layout.id}>
        <svg viewBox="0 0 150 94" role="img" aria-label={`${layout.name} schematic`}><rect x="3" y="3" width="144" height="88" fill="#e8decc" stroke="currentColor" strokeWidth="2"/>{layout.id !== 'open' && <><path d="M61 3V91M89 3V91M3 47H61M89 60H147" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M67 14H83M67 22H83M67 30H83M67 38H83M67 46H83M67 54H83M67 62H83M67 70H83" stroke="#ad977a"/></>}</svg>
        <h4>{layout.name}</h4><p>{layout.description}</p><button type="button" onClick={() => applyLayout(layout.id)} disabled={!reference}>Use {layout.name.toLowerCase()}</button>
      </article>)}</div>
      {sources.length > 0 && <div className="le-copy-floor"><div><h4>Or copy an existing floor</h4><p>Copy indoor rooms, walls, windows and furniture. Outdoor grounds stay below; outside-facing doors become windows. Stair connections are added separately.</p></div><label>Copy from<select value={sourceId} onChange={event => setSource(event.target.value)}>{sources.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button type="button" onClick={() => applyLayout('copy')}>Copy floor plan</button></div>}
      <p className="le-muted">Starting layouts are editable concepts sized to the reference floor. Check wall alignment, structure and site limits before construction.</p>
    </div>}
    {adding && <AddRoom key={floorId} scene={scene} floorId={floorId} onApply={onApply} onCancel={cancelRoom} onAdded={roomId => { setAdding(false); onTool('select'); onSelectRoom(roomId) }}/ >}
    {rooms.length > 0 && <><ul className="le-room-list" aria-label={`Rooms on ${floor.name}`}>{rooms.map(room => <li key={room.id}>
      <button type="button" aria-label={`Edit ${room.name} on ${floor.name}`} aria-pressed={selectedRoomId === room.id} onClick={() => { onTool('select'); onSelectRoom(room.id) }}><strong>{room.name}</strong><span>{(polygonArea(room.polygon) / 1e6).toFixed(1)} m² · Edit</span></button>
      <button type="button" aria-label={`Remove ${room.name} from ${floor.name}`} disabled={scene.rooms.length === 1} onClick={() => onApply({ type: 'removeRoom', roomId: room.id }, `${room.name} removed. Undo restores the room and its contents.`)}>Remove</button>
    </li>)}</ul>
    {lower && <div className="le-floor-connection"><div><h4>{connected ? `Connected to ${lower.name}` : `Connect to ${lower.name}`}</h4><p>{connected ? 'The staircase is included in the plan and 3D model.' : 'Add a staircase so walking and tours can reach this floor. A suggested straight run needs clear rooms and landing space on both levels.'}</p></div>{!connected && <div className="le-floor-actions"><button type="button" onClick={() => onApply(current => connectFloorBelow(current, floorId), 'A straight staircase connects these floors. Review the position and landing space in 2D and 3D.')}>Suggest connecting stairs</button><button type="button" onClick={() => onDrawStairs(lower.id, floorId)}>Draw stairs from below</button></div>}</div>}
    <div className="le-floor-clear">{clearing ? <><p>Remove all {rooms.length} rooms, walls, furniture and stairs connected to {floor.name}? Other floors keep their rooms. Undo can restore this edit.</p><button type="button" onClick={() => { if (onApply(current => clearFloor(current, floorId), `${floor.name} cleared. Choose another starting layout or add a room.`)) { setClearing(false); onTool('select'); window.requestAnimationFrame(() => heading.current?.focus()) } }}>Confirm clear floor</button><button type="button" onClick={() => setClearing(false)}>Keep floor plan</button></> : <button type="button" disabled={disabled || rooms.length === scene.rooms.length} onClick={() => setClearing(true)}>Clear floor to choose another layout</button>}</div>
    </>}
  </section>
}
