import { Component, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { buildPrimitives, toBrowser, fromBrowser, floorApertures, pointInPolygon } from './model.js'
import { resolveCollision, floorAtPosition } from './navigation.js'
import { getOverviewView, getRoomView, sampleTour } from './tours.js'
import { validateViewpoints } from './viewpoints.js'
import { cameraFloor, roomOnFloor } from './workspace-navigation.js'
import './world-canvas.css'

extend({ RoundedBoxGeometry })
const isSoftBox = primitive => primitive.kind === 'box' && primitive.material === 'fabric' && !primitive.id.includes('rug')

const MATERIALS = {
  plaster: { roughness: 0.96, metalness: 0, bumpScale: 0.0004 },
  wood: { roughness: 0.58, metalness: 0, bumpScale: 0.0015 },
  fabric: { roughness: 0.94, metalness: 0, bumpScale: 0.0012, sheen: 0.45, sheenRoughness: 0.9, sheenColor: '#eee7d9' },
  stone: { roughness: 0.66, metalness: 0, bumpScale: 0.0007 },
  ceramic: { roughness: 0.24, metalness: 0, bumpScale: 0.00015 },
  clay: { roughness: 0.9, metalness: 0, bumpScale: 0.0008 },
  grass: { roughness: 1, metalness: 0, bumpScale: 0.003 },
  leaves: { roughness: 0.84, metalness: 0 },
  glass: { color: '#b7d9d8', transparent: true, opacity: 0.18, roughness: 0.12, metalness: 0.08, depthWrite: false },
  metal: { roughness: 0.3, metalness: 0.72 },
  brass: { color: '#b38c4d', roughness: 0.32, metalness: 0.65 },
  water: { color: '#76a9a4', transparent: true, opacity: 0.72, roughness: 0.12, metalness: 0.18 },
}
const vector = value => new THREE.Vector3(...toBrowser(value))

// Deterministic, original textures: there are no remote asset or font requests.
function makeTexture(kind) {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let seed = 8291
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128)
  if (kind === 'wood') {
    // Fine grain, not broad colour stripes stretched over an entire cabinet.
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = `rgba(69, 48, 29, ${0.012 + random() * 0.04})`
      ctx.lineWidth = 0.2 + random() * 0.65
      const x = random() * 128
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 1.5, 40, x - 1.5, 80, x, 128); ctx.stroke()
    }
  } else if (kind === 'fabric') {
    for (let i = 0; i < 128; i += 2) {
      ctx.strokeStyle = `rgba(68, 58, 45, ${0.045 + random() * 0.025})`; ctx.lineWidth = 0.55
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke()
      ctx.strokeStyle = `rgba(68, 58, 45, ${0.025 + random() * 0.025})`
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke()
    }
  } else {
    // Seamless mineral grain is suitable for slabs, ceramics and plaster.
    for (let i = 0; i < 3800; i++) {
      ctx.fillStyle = `rgba(70,61,50,${random() * 0.055})`
      ctx.fillRect(random() * 128, random() * 128, 0.5 + random(), 0.5 + random())
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function textureType(primitive) {
  const name = String(primitive.material || '').toLowerCase()
  if (/wood|oak|walnut|timber|teak/.test(name)) return 'wood'
  if (/fabric|linen|cotton|upholst|rug|carpet/.test(name)) return 'fabric'
  if (/tile|stone|marble|terrazzo|floor|plaster|ceramic|clay|grass/.test(name) || primitive.category === 'floor') return 'tile'
  return null
}

function meshGeometry(primitive) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(primitive.vertices.flatMap(toBrowser), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(primitive.vertices.flatMap(p => [p[0] / 1800, p[1] / 1800]), 2))
  geometry.setIndex(primitive.indices)
  const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals()
  return flat
}

function surfaceGeometry(primitive, dimensions) {
  const kind = primitive.kind || 'box', material = String(primitive.material || '').toLowerCase()
  let geometry
  if (kind === 'mesh') geometry = meshGeometry(primitive)
  else if (kind === 'cylinder') geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16).scale(...dimensions)
  else if (kind === 'sphere') geometry = new THREE.SphereGeometry(0.5, 12, 8).scale(...dimensions)
  else if (isSoftBox(primitive)) geometry = new RoundedBoxGeometry(...dimensions, 2, Math.min(0.04, Math.min(...dimensions) * 0.28))
  else if (primitive.category === 'furniture' && ['wood', 'stone', 'ceramic'].includes(material) && Math.min(...dimensions) > 0.045) geometry = new RoundedBoxGeometry(...dimensions, 1, Math.min(0.008, Math.min(...dimensions) * 0.12))
  else geometry = new THREE.BoxGeometry(...dimensions)
  const texture = textureType(primitive)
  if (texture) {
    // Per-face local metre coordinates retain material scale after resizing.
    // Geometry already has real dimensions, so a large floor cannot stretch UVs.
    const spacing = texture === 'wood' ? 0.45 : texture === 'fabric' ? 0.12 : 0.6
    const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i))
      const axes = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y]
      uv.setXY(i, axes[0] / spacing, axes[1] / spacing)
    }
    uv.needsUpdate = true
  }
  return geometry
}

function Primitive({ primitive, textures, cutaway, elevation = 0, object, selected, onObjectSelect, onRoomHover, onRoomSelect }) {
  const shape = useMemo(() => {
    const position = [...primitive.position], size = [...primitive.size]
    if (cutaway && primitive.category === 'roof') return null
    if (cutaway && ['wall', 'opening'].includes(primitive.category)) {
      const base = position[2] - size[2] / 2, cap = elevation + 950
      if (base >= cap) return null
      size[2] = Math.min(cap, position[2] + size[2] / 2) - base
      position[2] = base + size[2] / 2
    }
    return { position, geometry: surfaceGeometry(primitive, [size[0] / 1000, size[2] / 1000, size[1] / 1000]) }
  }, [primitive, cutaway, elevation])
  useEffect(() => () => shape?.geometry.dispose(), [shape])
  if (!shape) return null
  const material = String(primitive.material || '').toLowerCase()
  const config = MATERIALS[material] || {}
  const texture = textures[textureType(primitive)] || null
  const SurfaceMaterial = material === 'fabric' ? 'meshPhysicalMaterial' : 'meshStandardMaterial'
  return <mesh
    name={primitive.id}
    position={toBrowser(shape.position)}
    rotation={[0, primitive.rotation || primitive.rotationZ || 0, 0]}
    castShadow={!['glass', 'water'].includes(material) && primitive.category !== 'floor'}
    receiveShadow
    onPointerOver={event => { if (primitive.roomId) { event.stopPropagation(); onRoomHover?.(primitive.roomId) } }}
    onPointerOut={() => onRoomHover?.(null)}
    onClick={event => { if (event.delta > 4) return; event.stopPropagation(); if (object) onObjectSelect?.(object); else if (primitive.roomId) onRoomSelect?.(primitive.roomId) }}
    userData={{ id: primitive.id, objectId: object?.id || null, roomId: primitive.roomId || null, floorId: primitive.floorId || null, category: primitive.category, canonicalUnits: 'mm' }}
  >
    <primitive object={shape.geometry} attach="geometry" />
    <SurfaceMaterial color={primitive.color || '#ddd2bd'} roughness={0.86} metalness={0} map={texture} bumpMap={config.bumpScale ? texture : null} {...config} emissive={selected ? '#a85729' : '#000000'} emissiveIntensity={selected ? 0.22 : 0} />
  </mesh>
}

function RoomSurface({ room, active, hovered, visible, onHover, onSelect, elevation, apertures }) {
  const shape = useMemo(() => {
    const shape = new THREE.Shape()
    room.polygon.forEach(([x, y], i) => i ? shape.lineTo(x / 1000, y / 1000) : shape.moveTo(x / 1000, y / 1000))
    shape.closePath()
    for (const aperture of apertures) {
      if (!pointInPolygon(aperture.polygon[0], room.polygon)) continue
      const path = new THREE.Path()
      aperture.polygon.forEach(([x, y], i) => i ? path.lineTo(x / 1000, y / 1000) : path.moveTo(x / 1000, y / 1000))
      path.closePath(); shape.holes.push(path)
    }
    return shape
  }, [room.polygon, apertures])
  const center = useMemo(() => room.polygon.reduce((sum, p) => [sum[0] + p[0] / room.polygon.length, sum[1] + p[1] / room.polygon.length], [0, 0]), [room.polygon])
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, elevation / 1000 + 0.015, 0]}
      onPointerOver={event => { event.stopPropagation(); onHover?.(room.id) }}
      onPointerOut={() => onHover?.(null)}
      onClick={event => { event.stopPropagation(); if (event.delta <= 4) onSelect?.(room.id) }}
      userData={{ roomId: room.id, presentationOnly: true }}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={active ? '#b86a3c' : '#dbb079'} transparent opacity={active ? 0.15 : hovered ? 0.13 : 0} depthWrite={false} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide} />
    </mesh>
    {visible && <Html position={toBrowser([center[0], center[1], elevation + 180])} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <span className={`world-room-label${active ? ' is-active' : ''}`}>{room.name}</span>
    </Html>}
  </group>
}

function Environment({ model, mode, selectedRoomId, hoveredRoomId, onRoomHover, onRoomSelect, sceneRef, quality, activeFloorId, isolateFloor, selectedObjectId, onObjectSelect }) {
  const primitives = useMemo(() => buildPrimitives(model), [model])
  // The sample site's top is -80mm. A backdrop at that same height depth-fights
  // with it (especially in Firefox). Keep this decorative plane below all slabs.
  const backdropElevation = useMemo(() => Math.min(-80, ...primitives.filter(p => ['floor', 'exterior'].includes(p.category)).map(p => p.position[2] - p.size[2] / 2)) / 1000 - 0.025, [primitives])
  const textures = useMemo(() => Object.fromEntries(['wood', 'fabric', 'tile'].map(kind => [kind, makeTexture(kind)])), [])
  useEffect(() => () => Object.values(textures).forEach(texture => texture?.dispose()), [textures])
  const cutaway = mode === 'overview'
  // Walking and tours always retain every floor so their routes have visible support.
  const isolated = isolateFloor && !['walk', 'tour'].includes(mode)
  const showFloor = id => !isolated || !id || id === activeFloorId
  const apertures = useMemo(() => Object.fromEntries(model.floors.map(floor => [floor.id, floorApertures(model, floor.id)])), [model])
  const objects = useMemo(() => [...model.furniture.map(item => ({ ...item, type: 'furniture', label: item.kind })), ...model.walls.map(item => ({ ...item, type: 'wall', label: 'Wall' })), ...model.walls.flatMap(wall => wall.openings.map(item => ({ ...item, floorId: wall.floorId, roomId: wall.roomIds[0], wallId: wall.id, type: 'opening', label: item.kind }))), ...(model.stairs || []).map(item => ({ ...item, type: 'stair', label: item.name }))].sort((a, b) => b.id.length - a.id.length), [model])
  const identify = primitive => objects.find(item => primitive.stairId === item.id || primitive.id === item.id || primitive.id.startsWith(`${item.id}-`))

  return <>
    <color attach="background" args={['#e7e0d3']} />
    <fog attach="fog" args={['#e7e0d3', 42, 95]} />
    <ambientLight intensity={0.3} />
    <hemisphereLight args={['#f6f4ed', '#a99c87', 1.1]} />
    <directionalLight position={[-8, 17, 8]} intensity={3.4} color="#fff0d9" castShadow={quality !== 'low'}
      shadow-mapSize-width={quality === 'high' ? 2048 : 1024} shadow-mapSize-height={quality === 'high' ? 2048 : 1024}
      shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={24} shadow-camera-bottom={-24}
      shadow-camera-near={0.5} shadow-camera-far={65} shadow-bias={-0.00015} shadow-normalBias={0.025} shadow-radius={2.2} />
    <directionalLight position={[13, 8, -14]} intensity={0.65} color="#dce8f5" />
    <mesh name="Presentation_Backdrop" rotation={[-Math.PI / 2, 0, 0]} position={[0, backdropElevation, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} /><meshStandardMaterial color="#ded8c6" roughness={1} />
    </mesh>
    <group ref={sceneRef} name="GrihaGrid_Building" userData={{ schemaVersion: model.schemaVersion, revision: model.revision, sourceUnits: 'mm', exportedUnits: 'm' }}>
      {primitives.filter(primitive => showFloor(primitive.floorId)).map(primitive => {
        const object = identify(primitive)
        return <Primitive key={primitive.id} primitive={primitive} textures={textures} cutaway={cutaway} elevation={model.floors.find(floor => floor.id === primitive.floorId)?.elevation || 0}
          object={object} selected={selectedObjectId === object?.id} onObjectSelect={onObjectSelect} onRoomHover={onRoomHover} onRoomSelect={onRoomSelect} />
      })}
    </group>
    {model.rooms.filter(room => showFloor(room.floorId)).map(room => <RoomSurface key={room.id} room={room} active={selectedRoomId === room.id} hovered={hoveredRoomId === room.id}
      elevation={model.floors.find(floor => floor.id === room.floorId)?.elevation || 0} apertures={apertures[room.floorId] || []} visible={mode === 'overview'} onHover={onRoomHover} onSelect={onRoomSelect} />)}
  </>
}

function CameraDirector({ model, mode, selectedRoomId, tour, tourPlaying, tourTime, onTourTime, onTourPause, onMetrics, onFade, controllerRef, movement, reducedMotion, sceneRef, playbackRate, eyeHeight, activeFloorId, isolateFloor, onFloorChange, restoreState }) {
  const { camera, gl, scene, invalidate, size: viewport } = useThree()
  const controls = useRef()
  const live = useRef({})
  live.current = { model, mode, tour, tourPlaying, onTourTime, onTourPause, onMetrics, reducedMotion, onFade, playbackRate, eyeHeight, activeFloorId, isolateFloor, onFloorChange }
  const target = useRef(new THREE.Vector3())
  const elapsed = useRef(0)
  const published = useRef(-1)
  const metrics = useRef({ seconds: 0, frames: 0 })
  const pendingView = useRef(null)
  const manualView = useRef(null)
  const mountedModel = useRef(null)
  const walkingFloor = useRef(null)

  const overviewView = building => {
    let view = getOverviewView(building)
    const active = building.floors.find(floor => floor.id === live.current.activeFloorId)
    const lift = live.current.isolateFloor && active ? active.elevation : (Math.max(...building.floors.map(floor => floor.elevation))) / 2
    view = { ...view, target: [view.target[0], view.target[1], view.target[2] + lift], position: [view.position[0], view.position[1], view.position[2] + lift] }
    const factor = camera.aspect >= 1.2 ? (building.schemaVersion === 2 ? 0.94 : 0.8) : 1.08
    return { ...view, position: view.position.map((value, axis) => view.target[axis] + (value - view.target[axis]) * factor) }
  }
  const applyView = view => {
    if (!view?.position || !view?.target) return
    if (controls.current?.enabled) { const damping = controls.current.enableDamping; controls.current.enableDamping = false; controls.current.update(); controls.current.enableDamping = damping }
    camera.position.copy(vector(view.position))
    target.current.copy(vector(view.target))
    camera.lookAt(target.current)
    if (controls.current) controls.current.target.copy(target.current)
    if (Number.isFinite(view.fov)) camera.fov = THREE.MathUtils.clamp(view.fov, 20, 110)
    camera.updateProjectionMatrix()
    invalidate()
  }
  const jumpTo = (view, fade = true) => {
    if (!view) return
    if (!fade || live.current.reducedMotion) { pendingView.current = null; applyView(view); onFade?.(0); return }
    pendingView.current = { view, at: performance.now(), applied: false }
    onFade?.(1)
    invalidate()
  }

  useEffect(() => {
    const controller = {
      reset: () => jumpTo(overviewView(live.current.model)),
      focusRoom: id => jumpTo(getRoomView(live.current.model, id, live.current.eyeHeight)),
      setView: view => { manualView.current = { view, fromMode: live.current.mode }; jumpTo(view) },
      getView: () => {
        const direction = new THREE.Vector3(); camera.getWorldDirection(direction)
        return { position: fromBrowser(camera.position.toArray()), target: fromBrowser(camera.position.clone().addScaledVector(direction, 3).toArray()), fov: camera.fov }
      },
      getRuntimeState: () => ({ view: controller.getView(), orbitTarget: fromBrowser((controls.current?.target || target.current).toArray()), time: elapsed.current, published: published.current, mode: live.current.mode, modelId: live.current.model.id, revision: live.current.model.revision }),
      exportGLB: async (viewpoints = []) => {
        if (!sceneRef.current) throw new Error('The scene is still loading.')
        if (!validateViewpoints(viewpoints, live.current.model)) throw new Error('Saved cameras must belong to the current concept before exporting.')
        // Rebuild from canonical dimensions: the overview's cutaway is presentation only.
        const complete = new THREE.Group()
        complete.name = 'GrihaGrid_Building'
        complete.userData = { ...sceneRef.current.userData }
        for (const primitive of buildPrimitives(live.current.model)) {
          const geometry = primitive.kind === 'mesh' ? meshGeometry(primitive) : primitive.kind === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 16) : primitive.kind === 'sphere' ? new THREE.SphereGeometry(0.5, 12, 8) : isSoftBox(primitive) ? new RoundedBoxGeometry(1, 1, 1, 2, 0.08) : new THREE.BoxGeometry(1, 1, 1)
          const existing = sceneRef.current.getObjectByName(primitive.id)
          const material = existing?.material?.clone() || new THREE.MeshStandardMaterial({ color: primitive.color || '#ddd2bd', roughness: 0.86, ...(MATERIALS[primitive.material] || {}) })
          const mesh = new THREE.Mesh(geometry, material)
          mesh.name = primitive.id
          mesh.position.set(...toBrowser(primitive.position))
          if (primitive.kind !== 'mesh') mesh.scale.set(primitive.size[0] / 1000, primitive.size[2] / 1000, primitive.size[1] / 1000)
          mesh.rotation.y = primitive.rotation || 0
          mesh.userData = { id: primitive.id, roomId: primitive.roomId || null, category: primitive.category, floorId: primitive.floorId || null, stairId: primitive.stairId || null, wallId: primitive.wallId || null, openingId: primitive.openingId || null }
          complete.add(mesh)
        }
        for (const view of viewpoints) {
          const savedCamera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.05, 180)
          savedCamera.name = view.name
          savedCamera.position.copy(vector(view.position))
          savedCamera.lookAt(vector(view.target))
          savedCamera.userData = { id: `viewpoint:${view.id}`, viewpointId: view.id, viewpointName: view.name, category: 'viewpoint', buildingId: view.buildingId, sourceRevision: view.sourceRevision, ...(view.floorId ? { floorId: view.floorId } : {}) }
          complete.add(savedCamera)
        }
        complete.updateMatrixWorld(true)
        try {
          const result = await new GLTFExporter().parseAsync(complete, { binary: true, onlyVisible: false })
          return new Blob([result], { type: 'model/gltf-binary' })
        } finally {
          complete.traverse(object => { object.geometry?.dispose(); object.material?.dispose() })
        }
      },
      captureImage: () => {
        gl.render(scene, camera)
        return gl.domElement.toDataURL('image/png')
      },
    }
    controllerRef.current = controller
    return () => { if (controllerRef.current === controller) controllerRef.current = null }
  }, [camera, controllerRef, gl, scene, sceneRef])

  useEffect(() => {
    if (mountedModel.current !== model.id) { mountedModel.current = model.id; applyView(overviewView(model)) }
  }, [model])

  useEffect(() => {
    if (mode === 'room' && manualView.current && manualView.current.fromMode !== 'room') { jumpTo(manualView.current.view); manualView.current = null; return }
    manualView.current = null
    if (mode === 'overview') jumpTo(overviewView(model), false)
    else if (mode === 'room' || mode === 'walk') {
      const room = roomOnFloor(model, activeFloorId, selectedRoomId)
      if (room) jumpTo(getRoomView(model, room.id, eyeHeight))
    }
  }, [mode, selectedRoomId, model, eyeHeight])
  useEffect(() => { if (mode === 'overview') applyView(overviewView(model)) }, [viewport.width, viewport.height, activeFloorId, isolateFloor])

  useEffect(() => {
    if (!tourPlaying || Math.abs((Number(tourTime) || 0) - published.current) > 0.000001) {
      elapsed.current = Number(tourTime) || 0
      // A floor selection can leave a queued effect from the previous tour
      // render. It must not overwrite the user's newer overview/room choice.
      if (tour && mode === 'tour' && live.current.mode === 'tour') {
        const pose = sampleTour(tour, elapsed.current); applyView(pose); onFade?.(pose?.fade || 0)
        const floorId = cameraFloor(model, pose?.position, tour.eyeHeight || eyeHeight)
        if (floorId) { walkingFloor.current = floorId; live.current.onFloorChange?.(floorId) }
      }
    }
  }, [tourTime, tour, mode, tourPlaying])
  useEffect(() => { elapsed.current = Number(tourTime) || 0; published.current = -1 }, [tour])
  useEffect(() => {
    if (tourPlaying && tour && mode === 'tour') jumpTo(sampleTour(tour, elapsed.current))
  }, [tourPlaying])

  useEffect(() => {
    const canvas = gl.domElement
    let dragging = false, lastX = 0, lastY = 0
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const onDown = event => {
      if (live.current.tourPlaying) live.current.onTourPause?.()
      live.current.onFade?.(0)
      if (live.current.mode !== 'walk') return
      dragging = true; lastX = event.clientX; lastY = event.clientY
      canvas.setPointerCapture?.(event.pointerId)
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
    }
    const onMove = event => {
      if (!dragging || live.current.mode !== 'walk') return
      euler.y -= (event.clientX - lastX) * 0.004
      euler.x = THREE.MathUtils.clamp(euler.x - (event.clientY - lastY) * 0.004, -1.25, 1.25)
      camera.quaternion.setFromEuler(euler)
      lastX = event.clientX; lastY = event.clientY
    }
    const onUp = () => { dragging = false }
    const onWheel = () => { if (live.current.tourPlaying) live.current.onTourPause?.(); live.current.onFade?.(0) }
    const onKey = event => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      if (live.current.mode !== 'walk') return
      const key = event.key.toLowerCase()
      const map = { w: 'forward', arrowup: 'forward', s: 'backward', arrowdown: 'backward', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' }
      if (map[key]) { event.preventDefault(); movement.current[map[key]] = event.type === 'keydown' }
    }
    const clear = () => { movement.current = {}; dragging = false }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', clear)
    return () => {
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', clear)
    }
  }, [camera, gl, movement])

  useEffect(() => {
    metrics.current = { seconds: 0, frames: 0 }
    if (mode === 'overview') {
      const publish = () => onMetrics?.({ fps: null, renderMode: 'demand', drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles })
      publish(); const timer = window.setTimeout(publish, 350)
      return () => window.clearTimeout(timer)
    }
  }, [mode, model, onMetrics, gl])

  useEffect(() => {
    // Antialias changes need a new WebGL context. Restore after initial camera
    // effects so a quality change does not reset navigation or tour playback.
    if (!restoreState || restoreState.mode !== mode || restoreState.modelId !== model.id || restoreState.revision !== model.revision) return
    pendingView.current = null
    applyView(restoreState.view)
    target.current.copy(vector(restoreState.orbitTarget))
    controls.current?.target.copy(target.current)
    elapsed.current = restoreState.time
    published.current = restoreState.published
    onFade?.(0)
  }, [])

  useFrame((state, delta) => {
    const settings = live.current
    if (settings.mode !== 'overview') { if (metrics.current.frames) metrics.current.seconds += delta; metrics.current.frames++ }
    if (settings.mode !== 'overview' && metrics.current.seconds >= 1.2) {
      // The first callback establishes the baseline; N callbacks contain N-1 intervals.
      settings.onMetrics?.({ fps: Math.round((metrics.current.frames - 1) / metrics.current.seconds), renderMode: 'always', drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles })
      metrics.current = { seconds: 0, frames: 0 }
    }
    if (pendingView.current) {
      const pending = pendingView.current
      const time = performance.now() - pending.at
      if (!pending.applied && time >= 140) { applyView(pending.view); pending.applied = true; settings.onFade?.(0) }
      if (time >= 320) pendingView.current = null
      else invalidate()
      return
    }
    if (settings.mode === 'walk') {
      const keys = movement.current
      const forward = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0)
      const side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
      if (forward || side) {
        const direction = new THREE.Vector3(); camera.getWorldDirection(direction); direction.y = 0; direction.normalize()
        const right = direction.clone().cross(new THREE.Vector3(0, 1, 0))
        const step = direction.multiplyScalar(forward).addScaledVector(right, side).normalize().multiplyScalar(Math.min(delta, 0.05) * 1.6)
        const current = fromBrowser(camera.position.toArray())
        const proposed = fromBrowser(camera.position.clone().add(step).toArray())
        const resolved = resolveCollision(settings.model, current, proposed, 220, settings.eyeHeight)
        if (resolved) {
          camera.position.copy(vector(resolved))
          const floor = (settings.model.schemaVersion === 2 ? floorAtPosition(settings.model, resolved, settings.eyeHeight) : settings.model.floors[0])
          if (floor && floor.id !== walkingFloor.current) { walkingFloor.current = floor.id; settings.onFloorChange?.(floor.id) }
        }
      }
      return
    }
    if (settings.mode === 'tour' && settings.tour && settings.tourPlaying) {
      const duration = settings.tour.duration || settings.tour.totalDuration || 30
      elapsed.current = Math.min(duration, elapsed.current + Math.min(delta, 0.1) * Math.max(0.25, Math.min(3, settings.playbackRate || 1)))
      const pose = sampleTour(settings.tour, elapsed.current)
      if (pose) {
        applyView(pose)
        settings.onFade?.(pose.fade || 0)
        const floor = (settings.model.schemaVersion === 2 ? floorAtPosition(settings.model, pose.position, settings.tour.eyeHeight || settings.eyeHeight) : settings.model.floors[0])
        if (floor && floor.id !== walkingFloor.current) { walkingFloor.current = floor.id; settings.onFloorChange?.(floor.id) }
      }
      if (Math.abs(elapsed.current - published.current) >= 0.1 || elapsed.current >= duration) {
        published.current = elapsed.current; settings.onTourTime?.(elapsed.current)
      }
      if (elapsed.current >= duration) settings.onTourPause?.()
    }
  })
  return <OrbitControls ref={controls} makeDefault enabled={mode !== 'walk' && !tourPlaying}
    enableDamping={!reducedMotion} dampingFactor={0.075} minDistance={1.2} maxDistance={48}
    maxPolarAngle={Math.PI / 2 - 0.035} minPolarAngle={0.08} target={target.current}
    onChange={() => invalidate()}
    onStart={() => { if (live.current.tourPlaying) live.current.onTourPause?.() }} />
}

// Remove the listener before R3F intentionally loses its context on normal teardown.
function RendererHealth({ onError, onContextLost }) {
  const { gl } = useThree()
  useEffect(() => {
    const lost = event => {
      // R3F intentionally loses the detached renderer's context on teardown.
      // Only a loss in the live canvas should replace the viewer with fallback.
      if (!gl.domElement.isConnected) return
      event.preventDefault()
      onContextLost(true)
      onError?.('Graphics context was lost. The 2D plan remains available.')
    }
    gl.domElement.addEventListener('webglcontextlost', lost)
    onError?.('')
    return () => gl.domElement.removeEventListener('webglcontextlost', lost)
  }, [gl, onError, onContextLost])
  return null
}

class ViewerErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { this.props.onError?.(error.message || 'The 3D view could not start.') }
  render() { return this.state.error ? <div className="world-fallback" role="status"><strong>The 3D view is unavailable.</strong><span>You can still inspect and edit the 2D plan.</span></div> : this.props.children }
}

const WorldCanvas = forwardRef(function WorldCanvas({ model, mode = 'overview', selectedRoomId, onRoomHover, onRoomSelect, tour, tourPlaying = false, tourTime = 0, onTourTime, onTourPause, quality = 'balanced', reducedMotion = false, onError, onMetrics, playbackRate = 1, activeFloorId, isolateFloor = false, eyeHeight = 1650, selectedObjectId, onObjectSelect, onFloorChange }, ref) {
  const controller = useRef(null)
  const sceneRef = useRef(null)
  const movement = useRef({})
  const [hoveredRoomId, setHoveredRoomId] = useState(null)
  const [pickedObject, setPickedObject] = useState(null)
  const fadeRef = useRef(null)
  const setFading = value => { if (fadeRef.current) fadeRef.current.style.opacity = String(Number(value) || 0) }
  const [contextLost, setContextLost] = useState(false)
  const [graphicsAvailable, setGraphicsAvailable] = useState(null)
  const [contextProfile, setContextProfile] = useState(quality === 'low' ? 'light' : 'antialiased')
  const restoreState = useRef(null)
  const eventSource = useRef(null)
  useLayoutEffect(() => {
    const next = quality === 'low' ? 'light' : 'antialiased'
    if (next === contextProfile) return
    restoreState.current = controller.current?.getRuntimeState() || null
    setContextProfile(next)
  }, [quality, contextProfile])
  useEffect(() => {
    // R3F configures its renderer asynchronously; test capability before that
    // promise can reject outside React's error boundary on unsupported devices.
    let probe
    try {
      probe = document.createElement('canvas').getContext('webgl2', { antialias: false })
      setGraphicsAvailable(Boolean(probe))
      if (!probe) onError?.('3D graphics are unavailable on this device. The 2D plan remains available.')
    } catch {
      setGraphicsAvailable(false)
      onError?.('3D graphics are unavailable on this device. The 2D plan remains available.')
    } finally {
      probe?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [onError])
  useImperativeHandle(ref, () => ({
    reset: () => controller.current?.reset(),
    focusRoom: id => controller.current?.focusRoom(id),
    getView: () => controller.current?.getView(),
    setView: view => controller.current?.setView(view),
    exportGLB: views => controller.current?.exportGLB(views),
    captureImage: () => controller.current?.captureImage(),
  }), [])
  useEffect(() => { movement.current = {} }, [mode])
  const pickObject = object => { setPickedObject(object); onObjectSelect?.(object) }
  useEffect(() => { setPickedObject(null) }, [model, activeFloorId])
  const handleHover = id => { setHoveredRoomId(id); onRoomHover?.(id) }
  return <div className={`world-canvas-shell world-mode-${mode}`} aria-label="Interactive 3D house environment">
    <ViewerErrorBoundary onError={onError}>
      {graphicsAvailable === null && <div className="world-fallback" role="status">Preparing the 3D view…</div>}
      {graphicsAvailable === false && <div className="world-fallback" role="status"><strong>3D graphics are unavailable.</strong><span>Open 2D Plan to inspect and edit this concept.</span></div>}
      {graphicsAvailable && !contextLost && <div ref={eventSource} style={{ width: '100%', height: '100%' }}><Canvas key={contextProfile} eventSource={eventSource} style={{ pointerEvents: 'auto' }} frameloop={mode === 'overview' ? 'demand' : 'always'} shadows={quality !== 'low' ? 'percentage' : false} dpr={quality === 'low' ? 1 : quality === 'high' ? [1, 2] : [1, 1.5]}
        camera={{ fov: 52, near: 0.05, far: 180, position: [17, 17, 15] }}
        gl={{ antialias: contextProfile !== 'light', alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        fallback={<div className="world-fallback" aria-hidden="true">WebGL is unavailable. Use the 2D Plan to explore this design.</div>}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05
          gl.domElement.setAttribute('aria-label', '3D house: drag to look, use the room list to navigate')
          gl.domElement.setAttribute('tabindex', '0')
          gl.domElement.setAttribute('role', 'img')

        }}>
        <RendererHealth onError={onError} onContextLost={setContextLost} />
        <Environment model={model} mode={mode} selectedRoomId={selectedRoomId} hoveredRoomId={hoveredRoomId} onRoomHover={handleHover} onRoomSelect={onRoomSelect} sceneRef={sceneRef} quality={quality} activeFloorId={activeFloorId} isolateFloor={isolateFloor} selectedObjectId={selectedObjectId || pickedObject?.id} onObjectSelect={pickObject} />
        <CameraDirector model={model} mode={mode} selectedRoomId={selectedRoomId} tour={tour} tourPlaying={tourPlaying} tourTime={tourTime} onTourTime={onTourTime} onTourPause={onTourPause} onMetrics={onMetrics} onFade={setFading} controllerRef={controller} movement={movement} reducedMotion={reducedMotion} sceneRef={sceneRef} playbackRate={playbackRate} eyeHeight={eyeHeight} activeFloorId={activeFloorId} isolateFloor={isolateFloor} onFloorChange={onFloorChange} restoreState={restoreState.current} />
      </Canvas></div>}
      {contextLost && <div className="world-fallback" role="status">The graphics session ended. Your 2D plan is still available.</div>}
    </ViewerErrorBoundary>
    {pickedObject && <div className="world-object-card" role="status"><strong>{pickedObject.label}</strong><span>{model.floors.find(floor => floor.id === pickedObject.floorId)?.name || model.floors[0]?.name}{pickedObject.size ? ` · ${pickedObject.size.map(value => (value / 1000).toFixed(2)).join(' × ')} m` : ''}</span><span>Edit dimensions and placement in 2D Plan.</span><button type="button" aria-label="Clear object selection" onClick={() => { setPickedObject(null); onObjectSelect?.(null) }}>×</button></div>}
    <div ref={fadeRef} className="world-camera-fade" aria-hidden="true" />
    {mode === 'walk' && graphicsAvailable && !contextLost && <>
      <div className="world-walk-reticle" aria-hidden="true">+</div>
      <div className="world-walk-pad" role="group" aria-label="Walking controls">
        {[['forward', '↑', 'Walk forward'], ['left', '←', 'Step left'], ['backward', '↓', 'Walk backward'], ['right', '→', 'Step right']].map(([key, symbol, label]) => <button key={key} type="button" className={`world-walk-${key}`} aria-label={label}
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movement.current[key] = true }}
          onPointerUp={() => { movement.current[key] = false }} onPointerCancel={() => { movement.current[key] = false }}
          onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); movement.current[key] = true } }}
          onKeyUp={() => { movement.current[key] = false }} onBlur={() => { movement.current[key] = false }}>{symbol}</button>)}
      </div>
    </>}
  </div>
})

export default WorldCanvas
