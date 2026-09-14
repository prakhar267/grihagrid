import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import { spatialUUID } from '../src/spatial/ids.js'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('spatial IDs preserve native UUID output and the crypto method receiver', () => {
  const expected = '01234567-89ab-4cde-8fab-0123456789ab'
  const provider = { randomUUID() { assert.equal(this, provider); return expected }, getRandomValues() { assert.fail('Native UUIDs need no fallback') } }
  assert.equal(spatialUUID(provider), expected)
})

test('local HTTP UUID fallback consumes 16 secure bytes and sets version and variant', () => {
  for (const value of [0, 0xff, 0x55, 0xaa]) {
    let calls = 0
    const provider = { getRandomValues(bytes) { assert.equal(this, provider); assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length, 16); calls++; bytes.fill(value); return bytes } }
    const actual = spatialUUID(provider)
    assert.match(actual, uuidV4)
    const bytes = actual.replaceAll('-', '').match(/../g).map(hex => parseInt(hex, 16))
    assert.equal(bytes[6], (value & 0x0f) | 0x40)
    assert.equal(bytes[8], (value & 0x3f) | 0x80)
    assert.ok(bytes.every((byte, i) => i === 6 || i === 8 || byte === value), 'All other entropy bytes survive unchanged')
    assert.equal(calls, 1)
  }
})

test('fallback works with actual Web Crypto and creates independent valid IDs', () => {
  const provider = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }
  const ids = Array.from({ length: 64 }, () => spatialUUID(provider))
  assert.equal(new Set(ids).size, ids.length)
  ids.forEach(id => assert.match(id, uuidV4))
})

test('missing or failing secure entropy is reported without inventing an ID', () => {
  for (const provider of [null, {}, { randomUUID: undefined }]) assert.throws(() => spatialUUID(provider), /cannot create secure random identifiers.*Web Crypto/)
  const failure = new Error('Secure entropy unavailable')
  assert.throws(() => spatialUUID({ getRandomValues() { throw failure } }), error => error === failure)
  assert.throws(() => spatialUUID({ randomUUID() { throw failure }, getRandomValues() { assert.fail('Do not hide a native entropy error') } }), error => error === failure)
})
