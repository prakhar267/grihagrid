// Non-secret spatial object and request IDs. getRandomValues is also available
// on local HTTP previews, where browsers may omit secure-context randomUUID.
export function spatialUUID(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID()
  if (typeof cryptoProvider?.getRandomValues !== 'function') {
    throw new Error('This browser cannot create secure random identifiers. Open this studio in a browser with Web Crypto support.')
  }
  const bytes = new Uint8Array(16)
  cryptoProvider.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
