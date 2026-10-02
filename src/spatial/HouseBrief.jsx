import { useLayoutEffect, useMemo, useState } from 'react';
import { ArrowRight, DownloadSimple, Plus, Trash } from '@phosphor-icons/react';
import { assessHouseBrief, applyVastuPreferences, briefMarkdown, changeFloorCount, CLIMATES, DIRECTIONS, FEATURES, FLOOR_NAMES, newRoom, PERSONAS, PROJECT_TYPES, ROOM_TYPES, BRIEF_SOURCES, validateHouseBrief } from './house-brief.js';
import { briefGenerationGuidance, briefIssueAction } from './brief-guidance.js';
import './house-brief.css';

function Select({ label, value, options, onChange, ...props }) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)} {...props}>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
function NumberField({ label, value, onChange, min = 0, max, step = 'any', suffix, ...props }) {
  return <label>{label}<span className="hb-number"><input type="number" value={value ?? ''} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} {...props}/>{suffix && <small>{suffix}</small>}</span></label>;
}
function download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function HouseBrief({ value, onChange, model, onGenerate, onSave, onSelectRoom, onOpenDrawing, onOpenPlan, disabled = false, saved = false, isPrivate = false, initialStep = 'site', compact = false }) {
  const [step, setStep] = useState(initialStep), [unit, setUnit] = useState('m'), [roomType, setRoomType] = useState('bedroom'), [roomFloor, setRoomFloor] = useState(0), [error, setError] = useState('');
  const review = useMemo(() => assessHouseBrief(value, model), [value, model]);
  const [focusTarget, setFocusTarget] = useState(null);
  const guidance = useMemo(() => briefGenerationGuidance(value), [value]);
  const linear = unit === 'm' ? 1 : .3048, areaFactor = unit === 'm' ? 1 : .09290304;
  const shown = n => n === null ? null : Number((n / linear).toFixed(3));
  const areaShown = n => Number((n / areaFactor).toFixed(1));
  const change = patch => { setError(''); onChange({ ...value, ...patch }); };
  const nested = (key, patch) => change({ [key]: { ...value[key], ...patch } });
  const changeRoom = (id, patch) => change({ rooms: value.rooms.map(r => r.id === id ? { ...r, ...patch } : r) });
  const floors = Object.fromEntries(Array.from({ length: Number.isInteger(value.floors) ? value.floors : 1 }, (_, i) => [i, FLOOR_NAMES[i]]));
  const requiredMissing = review.checks.filter(c => c.priority === 'required' && c.status !== 'matched').length;
  function addRoom() { if (value.rooms.length >= 36) return; let index = 1; while(value.rooms.some(r => r.id === `r${index}`)) index++; change({ rooms: [...value.rooms, newRoom(roomType, index, Math.min(roomFloor, value.floors - 1))] }); }
  async function importBrief(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try { if(file.size>65536)throw new Error('Choose a brief JSON file smaller than 64 KB.');
      const data=JSON.parse(await file.text());
      if(data.kind!=='grihagrid-house-brief')throw new Error('Choose a GrihaGrid house brief export.');
      const result=validateHouseBrief(data.brief);if(!result.valid)throw new Error(result.errors[0]);
      if(!window.confirm('Replace this working brief with the imported requirements? Saved project revisions and geometry stay unchanged.'))return;
      onChange(data.brief);setError('');
    }catch(failure){setError(failure.message);}
  }
  useLayoutEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById(focusTarget.id) || document.getElementById('hb-step-heading');
    for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    element?.focus();
    if (focusTarget.id !== 'hb-step-heading') element?.scrollIntoView({ block: 'center' });
  }, [focusTarget]);
  function chooseStep(next, target = 'hb-step-heading') {
    setStep(next); setError(''); setFocusTarget({ id: target });
  }
  function followAction(action) {
    if (action.step) chooseStep(action.step, action.target);
    else if (action.destination === 'drawing') onOpenDrawing?.();
    else if (action.destination === 'plan') onOpenPlan?.();
  }
  function actionButton(action, primary = false) {
    if (!action || (action.destination === 'drawing' && !onOpenDrawing) || (action.destination === 'plan' && !onOpenPlan)) return null;
    return <button type="button" className={primary ? 'sp-primary' : 'sp-text-button'} onClick={() => followAction(action)}>{action.label} <ArrowRight/></button>;
  }
  function generate() {
    try { onGenerate(value); setError(''); }
    catch (failure) { setError(failure.message); setFocusTarget({ id: 'hb-generation-error' }); }
  }
  return <section className="house-brief" aria-label="House design brief">
    <div className="hb-heading">{!compact&&<div><span className="sp-eyebrow">A HOUSE AROUND YOUR LIFE</span><h2>Start with what matters.</h2><p>Set the site, list the spaces, then test the plan against your brief.</p></div>}<Select label="Display units" value={unit} options={{ m: 'Metres / m²', ft: 'Feet / sq ft' }} onChange={setUnit}/></div>
    <nav className="hb-steps" aria-label="House brief sections">{[['site', '01', 'Your plot'], ['rooms', '02', 'Rooms & floors'], ['needs', '03', 'Your lifestyle'], ['review', '04', 'Review needs']].map(([key, number, label]) => <button type="button" key={key} aria-current={step === key ? 'step' : undefined} onClick={() => chooseStep(key)}><span>{number}</span>{label}</button>)}</nav>
    <h3 id="hb-step-heading" className="hb-step-heading" tabIndex={-1}>{({site:'Tell us about your plot',rooms:'Choose your rooms and floors',needs:'Make room for everyday life',review:'Review your house requirements'})[step]}</h3><fieldset className="hb-fields" disabled={disabled}><legend className="sr-only">House requirements</legend>
      {step === 'site' && <>
        <div className="hb-grid"><Select label="I am planning as a" value={value.persona} options={PERSONAS} onChange={persona => change({ persona })}/><Select label="Project type" value={value.projectType} options={PROJECT_TYPES} onChange={projectType => change({ projectType })}/></div>
        <div className="hb-grid"><label>City / town / village<input id="hb-city" maxLength={100} autoComplete="off" placeholder="Any location in India" value={value.city} onChange={e => change({ city: e.target.value })}/></label><label>Locality / local authority<input maxLength={120} autoComplete="off" placeholder="Area and planning authority, if known" value={value.locality} onChange={e => change({ locality: e.target.value })}/></label></div>

        <div className="hb-grid"><NumberField label={`Plot width (${unit === 'm' ? 'metres' : 'feet'})`} value={shown(value.widthM)} min={3.048 / linear} max={152.4 / linear} suffix={unit} onChange={n => change({ widthM: n === null ? null : n * linear })}/><NumberField label={`Plot depth (${unit === 'm' ? 'metres' : 'feet'})`} value={shown(value.depthM)} min={3.048 / linear} max={152.4 / linear} suffix={unit} onChange={n => change({ depthM: n === null ? null : n * linear })}/></div>
        <p className="hb-caption">Plot area is land area. It does not tell us how much you may build or how much usable room space you will have.</p>
        <details className="hb-details"><summary>Site details &amp; building limits <small>Road, open spaces and local rules</small></summary>
        <div className="hb-grid"><Select id="hb-climate" label="Site climate" value={value.climate} options={CLIMATES} onChange={climate => change({ climate })}/><Select label="Site shape / terrain" value={value.shape} options={{ rectangular: 'Flat rectangular plot', corner: 'Corner plot', irregular: 'Irregular boundary', sloping: 'Sloping site' }} onChange={shape => change({ shape })}/></div>
        <div className="hb-grid"><Select label="Which side faces the road?" value={value.roadSide} options={{ front: 'Front', right: 'Right', back: 'Back', left: 'Left' }} onChange={roadSide => change({ roadSide })}/><NumberField id="hb-road-width" label="Approach-road width" value={shown(value.roadWidthM)} min={1 / linear} max={80 / linear} suffix={unit} placeholder="Unknown" onChange={n => change({ roadWidthM: n === null ? null : n * linear })}/></div>
        <h3 id="hb-setbacks" tabIndex={-1}>Space around the plot edges (setbacks)</h3><p className="hb-caption">These are the distances that must stay open between your building and each plot edge. Leave unknown values blank. An architect or your local authority can confirm them before you generate a layout. Zero means you are explicitly assuming no gap.</p>
        <div className="hb-grid hb-grid--four">{['front', 'back', 'left', 'right'].map(side => <NumberField key={side} label={`${side[0].toUpperCase() + side.slice(1)} setback`} value={shown(value.setbacks[side])} max={100 / linear} suffix={unit} placeholder="Unknown" onChange={n => nested('setbacks', { [side]: n === null ? null : n * linear })}/>)}</div>
        <details className="hb-details"><summary id="hb-local-rules">Local development limits, if confirmed</summary><div className="hb-grid"><NumberField label="Maximum FAR / FSI" min={.1} max={20} value={value.rules.far} placeholder="Unknown" onChange={far => nested('rules', { far })}/><NumberField label="Maximum coverage (%)" min={1} max={100} value={value.rules.coverage} placeholder="Unknown" onChange={coverage => nested('rules', { coverage })}/><NumberField label="Maximum height" min={2 / linear} max={200 / linear} suffix={unit} value={shown(value.rules.heightM)} placeholder="Unknown" onChange={n => nested('rules', { heightM: n === null ? null : n * linear })}/><label>Authority, rule source & date<input value={value.rules.source} maxLength={240} placeholder="Record who confirmed these limits" onChange={e => nested('rules', { source: e.target.value })}/></label></div></details>
        </details>
      </>}
      {step === 'rooms' && <>
        <div className="hb-grid"><Select id="hb-floors" label="Number of floors" value={value.floors} options={{ 1: 'Ground only', 2: 'Ground + 1', 3: 'Ground + 2', 4: 'Ground + 3' }} onChange={n => { try { onChange(changeFloorCount(value, Number(n))); setError(''); } catch (failure) { setError(failure.message); } }}/><p className="hb-caption">Assign every room to a floor. Reducing floors never silently deletes or moves your requirements. The current model supports up to four floors.</p></div>
        {Object.entries(floors).map(([index, floorName]) => <section className="hb-floor" key={index}><header><h3 id={`hb-floor-${index}`} tabIndex={-1}>{floorName}</h3><span>{areaShown(value.rooms.filter(r => r.floor === Number(index)).reduce((n, r) => n + (r.areaM2 || 0), 0))} {unit === 'm' ? 'm²' : 'sq ft'} requested</span></header>{value.rooms.filter(r => r.floor === Number(index)).map(room => <div className="hb-room" key={room.id}>
          <label>Room name<input aria-label={`Name for ${room.id}`} value={room.name} maxLength={80} onChange={e => changeRoom(room.id, { name: e.target.value })}/><small>{ROOM_TYPES[room.kind][0]}</small></label>
          <NumberField label={`Target ${unit === 'm' ? 'm²' : 'sq ft'}`} value={room.areaM2 === null ? null : areaShown(room.areaM2)} min={2 / areaFactor} max={300 / areaFactor} aria-label={`Target area for ${room.id}`} onChange={n => changeRoom(room.id, { areaM2: n === null ? null : n * areaFactor })}/>
          <Select label="Floor" value={room.floor} options={floors} aria-label={`Floor for ${room.id}`} onChange={n => changeRoom(room.id, { floor: Number(n) })}/>
          <Select label="Priority" value={room.priority} options={{ required: 'Must have', optional: 'Nice to have' }} aria-label={`Priority for ${room.id}`} onChange={priority => changeRoom(room.id, { priority })}/>
          <button className="hb-remove" type="button" disabled={value.rooms.length === 1} aria-label={`Remove ${room.name} (${room.id})`} onClick={() => change({ rooms: value.rooms.filter(r => r.id !== room.id) })}><Trash/></button>
        </div>)}{!value.rooms.some(r => r.floor === Number(index)) && <p className="hb-empty">No rooms assigned. Add rooms below or move them from another floor.</p>}</section>)}
        <div className="hb-add"><Select label="Add a space" value={roomType} options={Object.fromEntries(Object.entries(ROOM_TYPES).map(([key, [label]]) => [key, label]))} onChange={setRoomType}/><Select label="On floor" value={Math.min(roomFloor, value.floors - 1)} options={floors} onChange={n => setRoomFloor(Number(n))}/><button type="button" className="sp-secondary" disabled={value.rooms.length >= 36} onClick={addRoom}><Plus/> Add room</button></div>
        <p className="hb-caption">Targets are editable design assumptions, not statutory minimum room sizes. All rooms—including “nice to have” spaces—remain in the fit calculation until you remove them.</p>
      </>}
      {step === 'needs' && <>
        <h3>The people who live here</h3><div className="hb-grid hb-grid--four">{['adults', 'children', 'elders'].map(key => <NumberField key={key} label={key[0].toUpperCase() + key.slice(1)} value={value.household[key]} max={30} step="1" onChange={n => nested('household', { [key]: n })}/>)}<Select label="Access needs" value={value.household.accessibility} options={{ none: 'No specific request', step_free: 'Step-free daily living', wheelchair: 'Wheelchair access' }} onChange={accessibility => nested('household', { accessibility })}/></div>
        <div className="hb-grid"><NumberField label="Car parking spaces" value={value.parking} max={4} step="1" onChange={parking => change({ parking })}/><label>Other requirements<input value={value.notes} maxLength={1200} placeholder="Privacy, pets, staff, separate entry, work routine…" onChange={e => change({ notes: e.target.value })}/></label></div>
        <div className="hb-features">{Object.entries(FEATURES).map(([key, label]) => <label key={key}><input type="checkbox" checked={value.features.includes(key)} onChange={e => change({ features: e.target.checked ? [...value.features, key] : value.features.filter(f => f !== key) })}/>{label}</label>)}</div>
        <h3 id="hb-north" tabIndex={-1}>North & Vastu preferences</h3><div className="hb-grid"><Select label="Vastu preference" value={value.vastu} options={{ none: 'No Vastu preference', flexible: 'Flexible preferences', strict: 'Required direction preferences' }} onChange={vastu => change({ vastu })}/><NumberField label="North angle (degrees)" value={value.northDegrees} max={359.99} placeholder="Not measured" onChange={northDegrees => change({ northDegrees })}/></div>
        <p className="hb-caption">0° means model +Y is north; 90° means model +X is north. The 2D drawing’s screen-up direction is −Y. Confirm the survey orientation before comparing room directions.</p>
        {value.vastu !== 'none' && <><button type="button" className="sp-secondary" onClick={() => onChange(applyVastuPreferences(value))}>Use common kitchen / puja / bedroom preferences</button><p className="hb-caption">An editable starting preference: kitchen SE, puja NE, main bedroom SW. Traditions differ; this does not certify Vastu or override safety and local rules.</p><div className="hb-directions">{value.rooms.map(room => <Select key={room.id} label={`${room.name} · ${FLOOR_NAMES[room.floor]}`} value={room.direction} aria-label={`Direction for ${room.id}`} options={Object.fromEntries(DIRECTIONS.map(d => [d, d === 'any' ? 'No direction preference' : d]))} onChange={direction => changeRoom(room.id, { direction })}/>)}</div></>}
        <details className="hb-details"><summary id="hb-budget">Budget allowance using your own rate</summary><p className="hb-caption">A transparent scope check, not a contractor quote. No live market rate is assumed.</p><div className="hb-grid"><NumberField label="Available construction budget (₹ lakh)" value={value.budget.budgetLakh} min={1} max={100000} onChange={budgetLakh => nested('budget', { budgetLakh })}/><NumberField label="Your rate (₹ per m²)" value={value.budget.rateInrM2} min={1000} max={1000000} onChange={rateInrM2 => nested('budget', { rateInrM2 })}/><NumberField label="Contingency (%)" value={value.budget.contingencyPercent} max={100} onChange={contingencyPercent => nested('budget', { contingencyPercent })}/></div></details>
      </>}
      {step === 'review' && <>
        {onGenerate && <section className="hb-next-action" aria-label="Next step for your house">
          <span className="sp-eyebrow">YOUR NEXT STEP</span><h3>{guidance.title}</h3><p>{guidance.detail}</p>
          <div className="hb-actions">{guidance.kind === 'ready' ? <button type="button" className="sp-primary" onClick={generate}>Create a layout study <ArrowRight/></button> : actionButton(guidance.action, true)}
            {guidance.kind === 'invalid' && ['site', 'rooms', 'needs'].map(key => <button type="button" className="sp-secondary" key={key} onClick={() => chooseStep(key)}>Review {({site:'plot details',rooms:'rooms and floors',needs:'lifestyle needs'})[key]}</button>)}
            {onSave && <button type="button" className="sp-secondary" disabled={!review.valid || saved} onClick={onSave}>{saved ? 'Brief saved' : 'Review & save brief'}</button>}
          </div>
          {guidance.kind === 'drawing' && <p className="hb-caption">Your brief stays available in Your needs. Importing a drawing opens a review before any layout is changed.</p>}
        </section>}
        {error && <div id="hb-generation-error" className="hb-error" role="alert" tabIndex={-1}><strong>Something needs attention.</strong><p>{error}</p><div className="hb-actions"><button type="button" className="sp-text-button" onClick={() => chooseStep('rooms')}>Review rooms and areas <ArrowRight/></button>{onOpenDrawing && <button type="button" className="sp-text-button" onClick={onOpenDrawing}>Use a measured drawing <ArrowRight/></button>}</div></div>}
        {review.valid && <><div className="hb-metrics"><div><span>Plot / land</span><strong>{areaShown(review.plotArea)} <small>{unit === 'm' ? 'm²' : 'sq ft'}</small></strong></div><div><span>Space available per floor</span><strong>{review.setbacksKnown ? areaShown(review.envelopeArea) : 'Unknown'} <small>{review.setbacksKnown ? unit === 'm' ? 'm²' : 'sq ft' : ''}</small></strong></div><div><span>Rooms + space for walls and access</span><strong>{areaShown(review.targetArea)} <small>{unit === 'm' ? 'm²' : 'sq ft'}</small></strong></div></div>
          <p className="hb-caption">Programme total adds 25% for walls/circulation and 24 m² per floor for stairs when there is more than one floor. These are early allowances; the actual layout may need more. Local FAR and carpet-area definitions differ.</p>
          <div className="hb-floor-totals">{review.floors.map(f => <p key={f.index}><strong>{f.name}</strong><span>{f.rooms} requested spaces · {areaShown(f.target)} {unit === 'm' ? 'm²' : 'sq ft'} with allowances</span></p>)}</div>
          {review.budget?.modelArea !== undefined && <p className="hb-caption">Current model: {review.budget.modelArea.toFixed(1)} m² of room polygons, including circulation and unassigned spaces; ₹{(review.budget.modelTotal / 100000).toFixed(1)} lakh at your rate with contingency. Walls and the exclusions below require a measured estimate.</p>}
          {review.budget && <p className="hb-caption">Programme allowance at your entered rate: ₹{(review.budget.total / 100000).toFixed(1)} lakh including contingency, excluding land, taxes, approvals, professional fees, interiors and abnormal site costs.</p>}
        </>}
        <details className="hb-details hb-findings" open={review.issues.some(issue => issue.status === 'blocked')}><summary>Checks to review ({review.issues.length}){review.issues.some(issue => issue.status === 'blocked') ? ' · changes needed' : ' · site details and professional checks'}</summary><p>These checks stay with your brief. A generated layout is still a concept, and local rules need professional confirmation.</p>{review.issues.map(issue => <article key={issue.id} data-status={issue.status}><span>{issue.status === 'blocked' ? 'Change needed' : 'Review'}</span><div><h4>{issue.title}</h4><p>{issue.detail}</p>{actionButton(briefIssueAction(issue.id))}</div></article>)}</details>
        {model && review.valid && <details className="hb-details hb-model-check"><summary>Compare with the current floor plan{requiredMissing ? ` · ${requiredMissing} room requirements need attention` : ''}</summary><p>This compares your brief with the plan currently open, which may still be the example house. Creating a new study uses your requirements.</p><p>{requiredMissing ? `${requiredMissing} required room requirement${requiredMissing === 1 ? '' : 's'} need attention.` : 'All named required room targets match this schematic model.'} Room names and floor assignments identify imported rooms. This check does not certify fit-out, daylight or access.</p><div className="hb-table-wrap"><table><caption>Room requirements compared with the current model</caption><thead><tr><th>Room / floor</th><th>Target / model</th><th>Direction</th><th>Result</th></tr></thead><tbody>{review.checks.map(c => <tr key={c.id}><th>{c.roomId && onSelectRoom ? <button type="button" onClick={() => onSelectRoom(c.roomId)}>{c.name}</button> : c.name}<small>{c.floor} · {c.priority}</small></th><td>{areaShown(c.targetArea)} / {c.actualArea === null ? '—' : areaShown(c.actualArea)} {unit === 'm' ? 'm²' : 'sq ft'}</td><td>{value.vastu === 'none' ? 'Not requested' : `${c.direction} / ${c.wantedDirection}`}</td><td>{c.status}</td></tr>)}</tbody></table></div></details>}
        {!onGenerate && onSave && <div className="hb-actions"><button type="button" className="sp-secondary" disabled={!review.valid || saved} onClick={onSave}>{saved ? 'Brief saved' : 'Review & save brief'}</button></div>}

        <p className="hb-caption">{isPrivate ? 'Save the brief as a project revision, then review and accept any resulting layout separately.' : 'This working brief stays in this tab. Download it before leaving; a private house is required for cloud saving.'}</p>
        <details className="hb-details"><summary>Reference material & professional checks</summary><p>Local adoption, site conditions and qualified professional review determine what can be built. These references inform the questions, not an automatic approval.</p><ul>{BRIEF_SOURCES.map(([name, url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{name}</a></li>)}</ul></details>
      </>}
    </fieldset>
    {step === 'review' && <div className="hb-portable"><button type="button" className="sp-secondary" disabled={!review.valid} onClick={() => download(briefMarkdown(value, review), 'grihagrid-house-brief.md', 'text/markdown')}><DownloadSimple/> Download working brief</button><button type="button" className="sp-text-button" disabled={!review.valid} onClick={() => download(JSON.stringify({ kind: 'grihagrid-house-brief', brief: value }, null, 2), 'grihagrid-house-brief.json', 'application/json')}>Download editable JSON</button><label>Import brief JSON<input type="file" accept=".json,application/json" disabled={disabled} onChange={importBrief}/></label></div>}
    {error && step !== 'review' && <p className="hb-error" role="alert">{error}</p>}
    <div className="hb-next">{step!=='site'&&<button type="button" className="sp-text-button" onClick={()=>chooseStep(({rooms:'site',needs:'rooms',review:'needs'})[step])}>Back</button>}{step !== 'review' && <button type="button" className="sp-secondary" onClick={() => chooseStep(({ site: 'rooms', rooms: 'needs', needs: 'review' })[step])}>Continue to {({site:'rooms',rooms:'lifestyle',needs:'review'})[step]} <ArrowRight/></button>}</div>
  </section>;
}
