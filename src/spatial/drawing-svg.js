import DOMPurify from 'dompurify'

// SVG is a drawing input, never an active document. Purify before parsing, then
// remove resource references before rasterizing the result in an inert image.
export function sanitizedSvg(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('SVG documents with external entities are not supported.')
  text = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, '')
  const clean = DOMPurify.sanitize(text, { PARSER_MEDIA_TYPE: 'application/xhtml+xml', USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'use', 'style', 'link'], FORBID_ATTR: ['style'], ALLOW_DATA_ATTR: false, RETURN_TRUSTED_TYPE: false })
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('This SVG could not be read.')
  for (const node of doc.querySelectorAll('*')) for (const attribute of [...node.attributes]) {
    if (/^on/i.test(attribute.name) || /href|src|style/i.test(attribute.name) || /url\((?!\s*#)/i.test(attribute.value)) node.removeAttribute(attribute.name)
  }
  return new XMLSerializer().serializeToString(doc)
}
