import test from 'node:test'
import assert from 'node:assert/strict'
import houses from '../scripts/fixtures/house-release.json' with {type:'json'}
import {validateBuilding} from '../src/spatial/model.js'
import {validateConnectivity} from '../src/spatial/navigation.js'

for(const house of houses)test(`${house.brief.city} furnished G+2 connectivity survives a top-floor starting room`,()=>{
  const model=structuredClone(house.model)
  assert.equal(validateBuilding(model).valid,true)
  assert.deepEqual(validateConnectivity(model),{valid:true,errors:[]})
  const top=model.floors.at(-1).id
  model.rooms.sort((a,b)=>Number(b.floorId===top)-Number(a.floorId===top))
  assert.deepEqual(validateConnectivity(model),{valid:true,errors:[]},'The proof must traverse stairs down as well as up.')
})

for(const house of houses)test(`${house.brief.city} connectivity rejects a sealed room and a missing upper stair`,()=>{
  const sealed=structuredClone(house.model)
  const room=sealed.rooms.find(room=>room.floorId===sealed.floors.at(-1).id&&!/hall/i.test(room.name))
  for(const wall of sealed.walls)if(wall.roomIds.includes(room.id))for(const door of wall.openings)if(door.kind==='door')door.open=false
  assert.equal(validateBuilding(sealed).valid,true)
  const blocked=validateConnectivity(sealed)
  assert.equal(blocked.valid,false)
  assert.ok(blocked.errors.includes(`No traversable route to ${room.name}.`))
  const disconnected=structuredClone(house.model)
  disconnected.stairs.pop()
  assert.equal(validateConnectivity(disconnected).valid,false,'Floor projections cannot create a vertical connection.')
  assert.equal(validateConnectivity(structuredClone(house.model)).valid,true,'A later valid model cannot reuse the failed proof.')
})
