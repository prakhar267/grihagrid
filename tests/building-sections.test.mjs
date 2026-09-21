import test from 'node:test'
import assert from 'node:assert/strict'
import { createMultiFloorDemo, createDemoBuilding, toV2, buildPrimitives } from '../src/spatial/model.js'
import { sectionPlane, sectionIntervals, subtractIntervals, buildingSection, sectionCamera } from '../src/spatial/building-sections.js'
import { floorPlanSheet, buildingSectionSheet, drawingSetHTML } from '../src/spatial/drawing-set.js'
import { parseSceneFile, MAX_SCENE_BYTES } from '../src/spatial/scene-file.js'
import { generateTour } from '../src/spatial/tours.js'
import { defaultHouseBrief } from '../src/spatial/house-brief.js'

const close=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`)
test('section intervals respect concave outlines, vertices and reversed winding',()=>{
 const poly=[[0,0],[6000,0],[6000,6000],[4000,6000],[4000,2000],[2000,2000],[2000,6000],[0,6000]]
 for(const p of [poly,[...poly].reverse()])assert.deepEqual(sectionIntervals(p,1,3000),[[0,2000],[4000,6000]])
 assert.deepEqual(sectionIntervals(poly,1,2000),[[0,2000],[4000,6000]])
 assert.deepEqual(subtractIntervals([[0,6000]],[[1000,2000],[1500,3000],[5500,7000]]),[[0,1000],[3000,5500]])
})
test('sections cut shared floor slabs around the real stair aperture',()=>{
 const model=createMultiFloorDemo(),before=structuredClone(model),section=buildingSection(model,{axis:'y',percent:50})
 const slabs=section.parts.filter(p=>p.id==='upper-gallery-floor')
 assert.equal(slabs.length,2);close(slabs[0].right,7300);close(slabs[1].left,8700)
 assert.ok(section.parts.some(p=>p.category==='stairs'))
 assert.ok(section.parts.some(p=>p.category==='roof'))
 for(const p of section.parts){assert.ok(p.right>p.left);assert.ok(p.top>p.bottom)}
 assert.deepEqual(model,before);assert.equal(section.rooms.length,2)
})
test('openings retain actual sill and head voids in the cut wall',()=>{
 const model=createMultiFloorDemo(),section=buildingSection(model,{axis:'x',percent:25})
 const wall=section.parts.filter(p=>p.id.startsWith('ground-wall-0')&&p.category==='wall')
 assert.ok(wall.length>=2)
 assert.ok(wall.every(p=>p.top<=900||p.bottom>=2400))
})
test('both section cameras look from the removed side with matching sheet orientation',()=>{
 const model=createMultiFloorDemo()
 for(const axis of ['x','y']){
  const plane=sectionPlane(model,{axis,percent:35}),view=sectionCamera(model,{axis,percent:35})
  close(view.target[plane.axis],plane.coordinate)
  assert.ok(axis==='x'?view.position[0]>plane.coordinate:view.position[1]<plane.coordinate)
  assert.equal(plane.percent,35)
 }
 assert.equal(sectionPlane(model,{percent:1000}).percent,95)
 assert.equal(sectionPlane(model,{percent:NaN}).percent,50)
})
test('section sheets, plan markers and printable sets coordinate source and dimensions',()=>{
 const model=createMultiFloorDemo(),section={axis:'x',percent:25}
 const svg=buildingSectionSheet(model,{section,unit:'ft'})
 assert.ok(svg.includes('BUILDING SECTION B–B'));assert.ok(svg.includes('Cut X = 3000 mm'))
 assert.ok(svg.includes('FFL +3.200 m'));assert.ok(svg.includes('10′ 6″'))
 assert.ok(floorPlanSheet(model,'ground',{section}).includes('Section B–B'))
 const html=drawingSetHTML(model,{section});assert.equal((html.match(/<article>/g)||[]).length,7)
 assert.ok(html.includes('BUILDING SECTION A–A'));assert.ok(html.includes('BUILDING SECTION B–B'))
 model.name='<img onerror="alert(1)">';model.rooms[0].name='<script>'
 assert.ok(!buildingSectionSheet(model).includes('<script>'));assert.ok(!buildingSectionSheet(model).includes('<img onerror'))
})
test('sections support legacy scenes and empty floors without inventing geometry',()=>{
 const model=toV2(createDemoBuilding());model.floors.push({id:'empty',name:'Empty floor',height:3000,elevation:6000})
 assert.ok(buildingSectionSheet(model).includes('Empty floor'))
 assert.equal(buildingSection(model).parts.filter(p=>p.floorId==='empty').length,0)
 assert.ok(!buildingSectionSheet(createDemoBuilding()).includes('NaN'))
 const primitives=buildPrimitives(model);buildingSection(model,{axis:'x',percent:20});assert.deepEqual(buildPrimitives(model),primitives)
})
const scene=()=>{const model=createMultiFloorDemo();return {model,tour:generateTour(model),viewpoints:[],houseBrief:defaultHouseBrief()}}
test('saved scene roundtrip preserves source, tour, cameras and optional brief',()=>{
 const value=scene();value.viewpoints=[{id:'camera',name:'Entry',buildingId:value.model.id,sourceRevision:value.model.revision,floorId:value.model.floors[0].id,...sectionCamera(value.model)}]
 assert.deepEqual(parseSceneFile(JSON.stringify(value)),value)
 delete value.houseBrief;assert.deepEqual(parseSceneFile(JSON.stringify(value)),value)
})
test('scene import rejects unsupported, oversized, malformed, stale and invalid records',()=>{
 assert.throws(()=>parseSceneFile('{'),/valid JSON/)
 assert.throws(()=>parseSceneFile(' '.repeat(MAX_SCENE_BYTES+1)),/2 MB/)
 for(const mutate of [s=>s.model.rooms[0].polygon=[],s=>s.tour.sourceRevision++,s=>s.viewpoints=[{id:'invalid'}],s=>s.houseBrief.northDegrees=999,s=>s.unknown=true,s=>s.houseBrief=null,s=>s.viewpoints=null]){
  const value=scene();mutate(value);assert.throws(()=>parseSceneFile(JSON.stringify(value)))
 }
})
