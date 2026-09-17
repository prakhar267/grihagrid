import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, House } from '@phosphor-icons/react';
import { api } from '../api.js';
import { validAnonymousProjectName } from '../anonymous-draft.js';
import { isApplicationUnauthenticated } from '../logout.js';
import { registerNavigationGuard } from '../navigation-guard.js';
import { ESTIMATOR_CITIES } from '../public-estimator.js';
import './house-library.css';

const exitWarning = 'Leave this house setup? Unsaved details will be lost. If creation was interrupted, check My houses before creating another.';

export default function NewHouse({ onNavigate }) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('40'), [length, setLength] = useState('50');
  const [city, setCity] = useState('Other');
  const [phase, setPhase] = useState('idle'), [error, setError] = useState('');
  const submission = useRef(null), pending = useRef(false), request = useRef(null);
  const dirty = Boolean(name || width !== '40' || length !== '50' || city !== 'Other' || submission.current);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    const unregister = registerNavigationGuard(() => window.confirm(exitWarning));
    window.addEventListener('beforeunload', warn);
    return () => { unregister(); window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
  function leave() {
    if (pending.current || (dirty && !window.confirm(exitWarning))) return;
    onNavigate('/dashboard');
  }
  async function create(event) {
    event.preventDefault();
    if (pending.current) return;
    const normalizedName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!validAnonymousProjectName(normalizedName)) { setError('Enter a house name with 2–100 characters.'); return; }
    if (![width, length].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 10 && Number(value) <= 500)) {
      setError('Enter plot dimensions between 10 and 500 feet.'); return;
    }
    // Preserve one request across uncertain responses; changing its payload could create a duplicate.
    submission.current ||= { key: crypto.randomUUID(), body: { name: normalizedName, input: { width: Number(width), length: Number(length), city, floors: 'G', quality: 'Signature' } } };
    const controller = new AbortController(); request.current = controller;
    pending.current = true; setPhase('creating'); setError('');
    try {
      const result = await api('/api/projects', { method: 'POST', headers: { 'idempotency-key': submission.current.key }, body: submission.current.body, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(result?.project?.id || '')) throw new Error('Creation could not be confirmed. Retry the same request or check My houses.');
      onNavigate(`/projects/${result.project.id}/spatial`, { initialView: 'plan' });
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (isApplicationUnauthenticated(failure)) { onNavigate('/login'); return; }
      // A rejected validation request never created a project and can be corrected.
      if (failure.status === 400 || failure.status === 422) submission.current = null;
      setError(failure.message || 'Creation could not be confirmed. Retry the same request or check My houses.');
      setPhase('error');
    } finally { pending.current = false; }
  }
  return <main className="new-house-page">
    <header><button className="brand" onClick={leave} disabled={phase === 'creating'}><House/> GrihaGrid</button><button className="quiet-action" onClick={leave} disabled={phase === 'creating'}><ArrowLeft/> My houses</button></header>
    <section className="new-house-intro"><span className="kicker">Your private studio</span><h1>Begin a house.</h1><p>Import a drawing, shape the floor plan, then move through it in 3D.</p></section>
    <form onSubmit={create} className="new-house-form" aria-busy={phase === 'creating'}>
      <fieldset disabled={phase === 'creating' || Boolean(submission.current)}><legend>House details</legend>
        <label>Name<input required minLength={2} maxLength={100} autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Our courtyard home"/></label>
        <div className="new-house-dimensions"><label>Plot width (feet)<input type="number" required min="10" max="500" step="0.01" value={width} onChange={event => setWidth(event.target.value)}/></label><label>Plot depth (feet)<input type="number" required min="10" max="500" step="0.01" value={length} onChange={event => setLength(event.target.value)}/></label></div>
        <label>City<select value={city} onChange={event => setCity(event.target.value)}>{ESTIMATOR_CITIES.map(value => <option key={value} value={value}>{value === 'Other' ? 'Other / not specified' : value}</option>)}</select></label>
      </fieldset>
      <p className="new-house-note">You’ll start with an editable example. These plot details are a planning reference; they do not generate or resize the layout. Import your drawing or edit the rooms, then review the Change Study to save your first model.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {phase === 'error' && submission.current && <p role="status">Your details are held for a safe retry. The same request won’t create a second house.</p>}
      <button className="copper-button" type="submit" disabled={phase === 'creating'}>{phase === 'creating' ? 'Creating house…' : phase === 'error' && submission.current ? 'Retry creation' : 'Create house'}<ArrowRight/></button>
      <p className="new-house-note">Concept design only. A licensed professional must verify the plan before construction. Planning reports remain available in Project details.</p>
    </form>
  </main>;
}
