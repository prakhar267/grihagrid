export const RENDER_SERVICE = 'http://127.0.0.1:43127'

// Bound the entire probe, including a stalled body or browser permission prompt.
export async function probeRenderer({ signal, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (signal?.aborted) return false
  const controller = new AbortController()
  let timer, cancel
  const cancelled = new Promise(resolve => {
    cancel = () => { controller.abort(); resolve(false) }
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(cancel, timeoutMs)
  })
  const request = (async () => {
    try {
      const response = await fetchImpl(`${RENDER_SERVICE}/health`, { credentials: 'omit', signal: controller.signal })
      if (!response.ok) return false
      const body = await response.json()
      return !controller.signal.aborted && body?.service === 'grihagrid-local-renderer'
    } catch { return false }
  })()
  try { return await Promise.race([request, cancelled]) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
