import { useCallback, useEffect, useRef, useState } from 'react'
import { probeRenderer, RENDER_SERVICE } from './renderer-health.js'
import './render-panel.css'

const SERVICE = RENDER_SERVICE
let pairedSession = null // Memory only; never put pairing/session credentials in URLs or browser storage.

// An exact origin keeps hosted pairing usable without trusting arbitrary sites.
// Single quotes are shell-escaped because users can copy this setup command.
const serviceCommand = typeof window === 'undefined' ? 'npm run spatial:service'
  : `GRIHAGRID_RENDER_ORIGINS='${window.location.origin.replaceAll("'", "'\\''")}' npm run spatial:service`

function useMountedState(initial, mounted) {
  const [value, setValue] = useState(initial)
  const update = useCallback(next => { if (mounted.current) setValue(next) }, [mounted])
  return [value, update]
}

export default function RenderPanel({ model, tour, viewpoints = [], disabled = false }) {
  const mounted = useRef(true)
  const requests = useRef(new Set())
  const refreshing = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const request of requests.current) request.abort(); requests.current.clear() } }, [])
  const [session, setSession] = useMountedState(pairedSession, mounted)
  const [pairCode, setPairCode] = useMountedState('', mounted)
  const [jobs, setJobs] = useMountedState([], mounted)
  const [status, setStatus] = useMountedState('checking', mounted)
  const [healthAttempt, setHealthAttempt] = useState(0)
  const [error, setError] = useMountedState('', mounted)
  const [busy, setBusy] = useMountedState(false, mounted)
  const [quality, setQuality] = useMountedState(8, mounted)
  const [device, setDevice] = useMountedState('auto', mounted)
  const [media, setMedia] = useMountedState(null, mounted)
  const mediaUrl = useRef(null)

  const api = useCallback(async (pathname, options = {}) => {
    const controller = new AbortController(); requests.current.add(controller)
    const timeout = setTimeout(() => controller.abort(), 8000)
    let response
    try { response = await fetch(`${SERVICE}${pathname}`, { ...options, signal: controller.signal, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers }, credentials: 'omit' }) }
    catch { throw new Error('The local renderer is not responding. Check its connection to see the latest progress; running work may continue on your computer.') }
    finally { clearTimeout(timeout); requests.current.delete(controller) }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      if (response.status === 401 && pathname !== '/pair') { pairedSession = null; setSession(null) }
      throw new Error(body.error || `Local renderer returned ${response.status}.`)
    }
    return response
  }, [session])

  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const response = await api('/jobs'); const body = await response.json()
      setJobs(body.jobs); setStatus('connected'); setError('')
    } catch (error) { setError(error.message); setStatus('offline') } finally { refreshing.current = false }
  }, [api])

  useEffect(() => {
    if (session) return
    const controller = new AbortController()
    setStatus('checking')
    probeRenderer({ signal: controller.signal }).then(available => {
      if (!controller.signal.aborted) setStatus(available ? 'available' : 'offline')
    })
    return () => controller.abort()
  }, [session, healthAttempt, setStatus])

  useEffect(() => {
    if (!session) return
    refresh()
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [session, refresh])

  useEffect(() => () => { if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current) }, [])

  async function pair(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await api('/pair', { method: 'POST', body: JSON.stringify({ code: pairCode.trim() }) })
      const value = await response.json(); pairedSession = value; setSession(value); setPairCode(''); setStatus('connected')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function submit(mode) {
    setBusy(true); setError('')
    try {
      await (await api('/jobs', { method: 'POST', body: JSON.stringify({ model, tour, viewpoints, settings: { mode, samples: quality, device } }) })).json()
      await refresh()
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function action(job, operation) {
    setBusy(true); setError('')
    try { await (await api(`/jobs/${job.id}${operation ? `/${operation}` : ''}`, { method: operation ? 'POST' : 'DELETE', ...(operation ? { body: '{}' } : {}) })).json(); await refresh() }
    catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function artifact(job, name, preview = false) {
    setBusy(true); setError('')
    try {
      const response = await api(`/jobs/${job.id}/artifacts/${name}`)
      const blob = await response.blob(); if (!mounted.current) return; const url = URL.createObjectURL(blob)
      if (preview) {
        if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current)
        mediaUrl.current = url; setMedia({ url, video: name.endsWith('.mp4'), name: job.name })
      } else {
        const link = document.createElement('a'); link.href = url; link.download = `grihagrid-${name.split('/').at(-1)}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function disconnect() {
    try { await api('/session', { method: 'DELETE' }) } catch { /* Local token is cleared even when service is offline. */ }
    pairedSession = null; setSession(null); setJobs([])
    if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current)
    mediaUrl.current = null; setMedia(null)
  }

  return <section className="render-panel" aria-label="Local render studio">
    <div className="render-panel-heading"><div><p className="render-eyebrow">LOCAL RENDER STUDIO</p><h3>A film of your home.</h3></div><span className="render-connection">{session && status === 'connected' ? 'Connected to your computer' : status === 'checking' ? 'Checking local renderer…' : 'Local setup'}</span></div>
    <p>Blender Cycles creates the film on your computer. The house and tour stay local. One job renders at a time; interrupted jobs recover when the service restarts, and completed frames survive cancellation.</p>
    {!session ? <>
      <details open={status === 'offline'}><summary>Set up the local renderer once</summary><p>Start the local render service in your GrihaGrid checkout. This command allows this app address to connect:</p><code>{serviceCommand}</code><p>Open the private pairing-code file named by the service, then paste its code below. Keep the service running while rendering. If your browser asks, allow this site to connect to devices on your local network.</p></details>
      <form className="render-pairing" onSubmit={pair}><label>Pairing code<input type="password" autoComplete="off" value={pairCode} onChange={event => setPairCode(event.target.value)} placeholder="Private code from your computer" required /></label><button type="submit" disabled={busy || !pairCode.trim()}>Connect renderer</button></form>
      {status === 'offline' && <p role="status" className="render-note">The local renderer could not be reached. Check the setup above, then try again. <button type="button" onClick={() => setHealthAttempt(value => value + 1)}>Check renderer connection</button></p>}
    </> : <>
      <div className="render-settings"><label>Cycles quality<select value={quality} onChange={event => setQuality(Number(event.target.value))}><option value={8}>Quick preview · 8 samples</option><option value={16}>Balanced · 16 samples</option><option value={32}>Detailed · 32 samples</option><option value={64}>High quality · 64 samples</option></select></label><label>Render device<select value={device} onChange={event => setDevice(event.target.value)}><option value="auto">Automatic · GPU when available</option><option value="cpu">CPU · use if GPU rendering fails</option></select></label><button onClick={() => submit('preview')} disabled={busy || disabled || !tour}>Render previews</button><button onClick={() => submit('film')} disabled={busy || disabled || !tour}>Render 1080p film</button><button className="render-subtle" onClick={disconnect}>Disconnect</button></div>
      {status === 'offline' && <p role="status" className="render-note">Connection lost. These are the last known job states; rendering may still continue on your computer. <button className="render-subtle" onClick={refresh}>Check connection</button></p>}
      <p className="render-note">Films use 30 frames per second. Rendering can take minutes to hours depending on the tour, quality and hardware. Review the previews before a long film. If GPU rendering fails or exhausts memory, choose CPU and start a new render; resuming keeps the original job settings.</p>
      {disabled && <p className="render-note">Review the current model and regenerate any stale tour before rendering.</p>}
      <div className="render-jobs" aria-label="Local render jobs">{jobs.length === 0 ? <p>{status === 'connected' ? 'No local renders yet. Start with previews to check materials and framing.' : 'Local jobs could not be loaded yet. Check the connection to restore their status.'}</p> : jobs.map(job => {
        const active = ['queued', 'running', 'cancelling'].includes(job.status)
        const percent = job.progress?.total ? Math.min(100, Math.round((job.progress.frame || 0) / job.progress.total * 100)) : 0
        return <article className="render-job" key={job.id} data-render-job-id={job.id}>
          <div className="render-job-title"><strong>{job.name}</strong><span>{job.mode === 'film' ? 'Film' : job.mode === 'preview' ? 'Previews' : 'Scene'} · Cycles · {job.samples} samples · {job.device === 'cpu' ? 'CPU' : 'Auto device'}</span></div>
          <p className="render-job-status">{job.status.replaceAll('-', ' ')} · revision {job.sourceRevision}{active ? ` · ${job.progress?.stage || 'waiting'}` : ''}{job.progress?.frame > 0 ? job.mode === 'preview' ? ` · preview at tour frame ${job.progress.frame} of ${job.progress.total}` : ` · ${job.progress.frame} / ${job.progress.total} frames` : ''}</p>
          {active && <progress max="100" value={percent} aria-label={`${job.name} render progress`}>{percent}%</progress>}
          {job.error && <p>{job.error}</p>}
          {job.recovery && <p className="render-note">{job.recovery}</p>}
          <div className="render-job-actions">
            {active && job.progress?.frame > 0 && <button onClick={() => artifact(job, 'previews/frame-0001.png', true)} disabled={busy}>View preview</button>}
            {active && <button onClick={() => action(job, 'cancel')} disabled={busy || job.status === 'cancelling'}>Cancel render</button>}
            {['failed', 'cancelled', 'interrupted'].includes(job.status) && <button onClick={() => action(job, 'resume')} disabled={busy}>Resume render</button>}
            {job.status === 'complete' && <><button onClick={() => artifact(job, job.mode === 'film' ? 'tour.mp4' : 'previews/frame-0001.png', true)} disabled={busy}>View {job.mode === 'film' ? 'film' : 'preview'}</button>{job.mode === 'film' && <button onClick={() => artifact(job, 'tour.mp4')} disabled={busy}>Download film</button>}<button onClick={() => artifact(job, 'house.blend')} disabled={busy}>Blender scene</button><button onClick={() => artifact(job, 'house.glb')} disabled={busy}>3D model</button></>}
            {!active && <button className="render-subtle" onClick={() => action(job, '')} disabled={busy}>Remove local render</button>}
          </div>
        </article>
      })}</div>
    </>}
    {error && <p role="alert" className="render-error">{error}</p>}
    {media && <div className="render-media">{media.video ? <video src={media.url} controls playsInline aria-label={`Rendered tour of ${media.name}`} /> : <img src={media.url} alt={`Blender preview of ${media.name}`} />}</div>}
  </section>
}
