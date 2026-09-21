import test from 'node:test'
import assert from 'node:assert/strict'
import { setWalkingInput, consumeWalkingInput } from '../src/spatial/walking-input.js'

test('a tap released between frames still moves, then stops without sticking', () => {
  const state = {}
  setWalkingInput(state, 'forward', true); setWalkingInput(state, 'forward', false)
  for (let i = 0; i < 5; i++) assert.equal(consumeWalkingInput(state, 0.016).forward, 1)
  assert.equal(consumeWalkingInput(state, 0.016).forward, 0)
})
test('held keys keep moving and key repeat cannot extend movement after release', () => {
  const state = {}
  setWalkingInput(state, 'right', true)
  for (let i = 0; i < 20; i++) { setWalkingInput(state, 'right', true); assert.equal(consumeWalkingInput(state, 0.016).side, 1) }
  setWalkingInput(state, 'right', false)
  assert.equal(consumeWalkingInput(state, 0.016).side, 0)
})
test('cancelled pointers, focus resets and opposing directions do not drift', () => {
  const state = {}
  setWalkingInput(state, 'forward', true); setWalkingInput(state, 'backward', true)
  assert.equal(consumeWalkingInput(state, 1).forward, 0)
  assert.equal(consumeWalkingInput(state, 1).seconds, 0.05)
  setWalkingInput(state, 'forward', false, true); setWalkingInput(state, 'backward', false, true)
  assert.deepEqual(consumeWalkingInput(state, 0.016), { forward: 0, side: 0, seconds: 0.016 })
  assert.equal(consumeWalkingInput({}, 0.016).forward, 0)
})
