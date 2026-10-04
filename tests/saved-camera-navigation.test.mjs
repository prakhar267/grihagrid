import test from 'node:test'
import assert from 'node:assert/strict'
import { createMultiFloorDemo } from '../src/spatial/model.js'
import { roomAtCamera } from '../src/spatial/workspace-navigation.js'

test('saved camera context follows physical room and floor without changing its pose', () => {
  const model=createMultiFloorDemo(), pose=[3100,5800,4850], original=[...pose]
  assert.equal(roomAtCamera(model,pose).id,'upper-gallery')
  assert.deepEqual(pose,original)
  assert.equal(roomAtCamera(model,[3100,5800,1000]).id,'ground-gallery')
  assert.equal(roomAtCamera(model,[3100,5800,6100]).id,'upper-gallery')
})

test('aerial, exterior and between-floor saved views do not borrow a room label', () => {
  const model=createMultiFloorDemo()
  for(const pose of [[3100,5800,10000],[-3000,5800,1650],[3100,5800,3100],[3100,5800,6200],null,[0,0], [NaN,0,0]]) {
    assert.equal(roomAtCamera(model,pose),null)
  }
})
