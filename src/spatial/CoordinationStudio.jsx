import { useEffect, useMemo, useRef, useState } from 'react'
import { spatialUUID } from './ids.js'
import { toV2, validateBuilding } from './model.js'
import { applySceneEdit } from './editor-ops.js'
import { COMPONENTS, DISCIPLINES, componentFootprint, componentTag, coordinationIssues, coordinationSchedule, coordinationCSV, disciplineOf } from './coordination.js'
import { coordinationPlanSheet } from './drawing-set.js'
import './coordination-studio.css'

const signature=model=>JSON.stringify({...model,revision:0})
const numeric=value=>String(value).trim()===''?NaN:Number(value)
const fromItem=item=>({...structuredClone(item),position:item.position.map(String),size:item.size.map(String),rotation:String(Math.round(item.rotation*180/Math.PI*100)/100),loadWatts:item.loadWatts??'',pending:false})
function newItem(model,floorId,kind='column') {
  const room=model.rooms.find(r=>r.floorId===floorId&&!r.exterior),center=room?room.polygon.reduce((p,q)=>[p[0]+q[0]/room.polygon.length,p[1]+q[1]/room.polygon.length],[0,0]):[0,0]
  return {id:null,kind,label:'',floorId,position:[...center.map(v=>String(Math.round(v/50)*50)),'0'],size:['','',''],rotation:'0',system:'',notes:'',loadWatts:'',pending:false}
}
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}

export default function CoordinationStudio({model,floorId,onChange,onStatus,onPendingChange,onExplore,disabled=false}) {
  const scene=useMemo(()=>toV2(model),[model]),floor=scene.floors.find(f=>f.id===floorId)
  const [discipline,setDiscipline]=useState('structure'),[drafts,setDrafts]=useState({}),[history,setHistory]=useState([]),[future,setFuture]=useState([]),[error,setError]=useState(''),[placing,setPlacing]=useState(false)
  const last=useRef(signature(model)),svg=useRef(null),errorRef=useRef(null),formRef=useRef(null)
  const draft=drafts[floorId]||newItem(scene,floorId,Object.keys(COMPONENTS).find(k=>COMPONENTS[k].discipline===discipline)),pending=Object.values(drafts).some(v=>v.pending)
  const rows=coordinationSchedule(scene,floorId,discipline),issues=useMemo(()=>coordinationIssues(scene),[scene]),floorIssues=issues.filter(issue=>issue.ids.some(id=>scene.coordination?.some(v=>v.id===id&&v.floorId===floorId)))
  useEffect(()=>{onPendingChange?.(pending);return()=>onPendingChange?.(false)},[pending,onPendingChange])
  useEffect(()=>{const next=signature(model);if(last.current!==next){setHistory([]);setFuture([])}last.current=next},[model])
  useEffect(()=>{setPlacing(false);setError('')},[floorId])
  useEffect(()=>{const ids=new Set(model.floors.map(f=>f.id));setDrafts(all=>Object.keys(all).some(id=>!ids.has(id))?Object.fromEntries(Object.entries(all).filter(([id])=>ids.has(id))):all)},[model.floors])
  const setDraft=next=>setDrafts(all=>({...all,[floorId]:next}))
  const change=(key,value)=>{setDraft({...draft,[key]:value,pending:true});setError('')}
  const fail=e=>{setError(e.message);requestAnimationFrame(()=>errorRef.current?.focus());return false}
  function emit(next,message) {last.current=signature(next);onChange(next);onStatus?.(message);setError('');setPlacing(false)}
  function commit(event) {
    event.preventDefault();if(disabled)return
    try {
      const component={id:draft.id||`component-${spatialUUID().slice(0,16)}`,kind:draft.kind,label:draft.label.trim(),floorId,position:draft.position.map(numeric),size:draft.size.map(numeric),rotation:numeric(draft.rotation)*Math.PI/180,system:draft.system.trim(),notes:draft.notes.trim()}
      if(disciplineOf(component)==='electrical')component.loadWatts=draft.loadWatts===''?null:numeric(draft.loadWatts)
      const next=applySceneEdit(scene,{type:'upsertComponent',component})
      if(new TextEncoder().encode(JSON.stringify(next)).length>47000)throw new Error('This house has reached the saved-model size limit. Reduce component notes or remove unused objects before adding more.')
      setHistory(h=>[...h.slice(-49),scene.coordination||[]]);setFuture([]);setDraft(fromItem(component))
      emit(next,`${component.label} updated on ${floor.name}. Review Change Study before accepting.`)
    }catch(e){fail(e)}
  }
  function remove() {
    if(disabled||!draft.id)return
    try{const next=applySceneEdit(scene,{type:'removeComponent',componentId:draft.id});setHistory(h=>[...h.slice(-49),scene.coordination||[]]);setFuture([]);setDraft(newItem(scene,floorId,draft.kind));emit(next,'Component removed from this study. Undo is available.')}catch(e){fail(e)}
  }
  function restore(redo=false) {
    if(disabled||pending)return
    const stack=redo?future:history;if(!stack.length)return
    const next={...scene,coordination:structuredClone(stack.at(-1)),revision:scene.revision+1},check=validateBuilding(next)
    if(!check.valid){fail(new Error(check.errors[0]));return}
    if(redo){setFuture(h=>h.slice(0,-1));setHistory(h=>[...h,scene.coordination||[]])}else{setHistory(h=>h.slice(0,-1));setFuture(h=>[...h,scene.coordination||[]])}
    setDrafts({});emit(next,redo?'Component edit restored.':'Component edit undone.')
  }
  function select(item) {
    if(draft.pending){fail(new Error('Apply or discard the component form before selecting another item.'));return}
    setDiscipline(disciplineOf(item));setDraft(fromItem(item));setPlacing(false);setError('');requestAnimationFrame(()=>formRef.current?.focus())
  }
  const points=scene.rooms.filter(r=>r.floorId===floorId).flatMap(r=>r.polygon),basis=points.length?points:scene.rooms.flatMap(r=>r.polygon)
  const b={x0:Math.min(...basis.map(p=>p[0]))-800,x1:Math.max(...basis.map(p=>p[0]))+800,y0:Math.min(...basis.map(p=>p[1]))-800,y1:Math.max(...basis.map(p=>p[1]))+800}
  const scale=Math.max(b.x1-b.x0,b.y1-b.y0)/55
  function place(event) {
    if(!placing||disabled)return
    const point=svg.current.createSVGPoint();point.x=event.clientX;point.y=event.clientY
    const p=point.matrixTransform(svg.current.getScreenCTM().inverse());change('position',[String(Math.round(p.x/50)*50),String(Math.round(-p.y/50)*50),draft.position[2]]);setPlacing(false);requestAnimationFrame(()=>formRef.current?.focus())
  }
  const numbers=(key,labels)=>labels.map((label,i)=><label key={label}>{label}<input aria-label={label} type="number" step="1" value={draft[key][i]} onChange={e=>change(key,draft[key].map((v,k)=>k===i?e.target.value:v))}/></label>)
  const loadRows=rows.filter(r=>r.discipline==='electrical'),knownLoad=loadRows.reduce((n,r)=>n+(r.loadWatts||0),0),unknownLoad=loadRows.filter(r=>r.loadWatts==null).length
  return <section className="cs-studio" aria-label="Structure and services authoring">
    <div className="ds-heading"><span className="sp-eyebrow">COORDINATE THE HOUSE</span><h2>Structure &amp; services.</h2><p>Place designer-specified members, electrical points and straight pipe runs. Dimensions are in millimetres; base heights are above {floor.name}.</p></div>
    <div className="cs-toolbar"><label>Discipline<select aria-label="Coordination discipline" value={discipline} onChange={e=>{setDiscipline(e.target.value);if(!draft.pending)setDraft(newItem(scene,floorId,Object.keys(COMPONENTS).find(k=>COMPONENTS[k].discipline===e.target.value)))}}>{Object.entries(DISCIPLINES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <button type="button" disabled={disabled||!history.length||pending} onClick={()=>restore()}>Undo component</button><button type="button" disabled={disabled||!future.length||pending} onClick={()=>restore(true)}>Redo component</button>
      <button type="button" onClick={()=>download(coordinationPlanSheet(scene,floorId,discipline),`${scene.id}-${floorId}-${discipline}.svg`,'image/svg+xml')}>Download discipline sheet</button>
      <button type="button" onClick={()=>download(coordinationCSV(scene),`${scene.id}-components.csv`,'text/csv')}>Download component schedule</button><button type="button" onClick={onExplore}>Inspect in 3D</button>
    </div>
    {error&&<p className="cs-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    <div className="cs-workspace"><div><p className="cs-instruction">{placing?'Click the plan to set X / Y on a 50 mm grid, or enter coordinates in the form.':'Select an existing component on the plan or in the list. Enter dimensions before adding a new component.'}</p>
      <svg ref={svg} className={placing?'cs-plan is-placing':'cs-plan'} viewBox={`${b.x0} ${-b.y1} ${b.x1-b.x0} ${b.y1-b.y0}`} role="group" aria-label={`${floor.name} ${DISCIPLINES[discipline]} coordination plan`} onClick={place}>
        {scene.rooms.filter(r=>r.floorId===floorId).map(room=><polygon key={room.id} points={room.polygon.map(p=>`${p[0]},${-p[1]}`).join(' ')} fill="#e9e3d6" stroke="#bdb6a7" strokeWidth="20"/>)}
        {scene.walls.filter(w=>w.floorId===floorId).map(w=><g key={w.id}><line x1={w.start[0]} y1={-w.start[1]} x2={w.end[0]} y2={-w.end[1]} stroke="#787466" strokeWidth={w.thickness}/>{w.openings.map(o=>{const len=Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1]),p=t=>[w.start[0]+(w.end[0]-w.start[0])*t,w.start[1]+(w.end[1]-w.start[1])*t],a=p(o.offset/len),z=p((o.offset+o.width)/len);return <line key={o.id} x1={a[0]} y1={-a[1]} x2={z[0]} y2={-z[1]} stroke={o.kind==='door'?'#f3efe6':'#a8c4c5'} strokeWidth={w.thickness+10}/>})}</g>)}
        {rows.map(item=><g key={item.id} role="button" tabIndex={0} aria-label={`Edit ${item.label}`} aria-pressed={draft.id===item.id} onClick={e=>{e.stopPropagation();if(!placing)select(item);else place(e)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(item)}}}>
          <polygon points={componentFootprint(item).map(p=>`${p[0]},${-p[1]}`).join(' ')} fill={COMPONENTS[item.kind].color} fillOpacity=".5" stroke={draft.id===item.id?'#181511':COMPONENTS[item.kind].color} strokeWidth="35"/>
          <circle cx={item.position[0]} cy={-item.position[1]} r={scale*.65} fill="transparent" stroke={COMPONENTS[item.kind].color} strokeWidth="20"/>
          <text x={item.position[0]} y={-item.position[1]-scale} textAnchor="middle" fontSize={scale} fill="#181511" stroke="#f3efe6" strokeWidth="45" paintOrder="stroke">{componentTag(scene,item)}</text>
        </g>)}
      </svg>
      <p className="cs-instruction">{rows.length} components on {floor.name}.{discipline==='electrical'&&` Entered load: ${knownLoad} W; ${unknownLoad} unspecified. This is not a circuit capacity calculation.`}</p>
      <div className="cs-list">{rows.length?rows.map(item=><button type="button" key={item.id} aria-pressed={draft.id===item.id} onClick={()=>select(item)}><strong>{item.tag} · {item.label}</strong><span>{item.size.join(' × ')} mm · base {item.position[2]} mm</span></button>):<p>No {DISCIPLINES[discipline].toLowerCase()} components on this floor. Use the form to add the first one.</p>}</div>
    </div>
    <form ref={formRef} tabIndex={-1} className="cs-form" onSubmit={commit}><h3>{draft.id?'Edit component':'Add a component'}</h3><fieldset disabled={disabled}>
      <label>Component type<select aria-label="Component type" value={draft.kind} onChange={e=>{const kind=e.target.value;setDiscipline(COMPONENTS[kind].discipline);setDraft({...draft,kind,pending:true})}}>{Object.entries(COMPONENTS).map(([key,spec])=><option key={key} value={key}>{spec.name}</option>)}</select></label>
      <label>Component label<input aria-label="Component label" maxLength="60" value={draft.label} onChange={e=>change('label',e.target.value)} required/></label>
      <div className="cs-number-grid">{numbers('position',['Centre X (mm)','Centre Y (mm)','Base above floor (mm)'])}</div>
      <button type="button" aria-pressed={placing} onClick={()=>setPlacing(v=>!v)}>{placing?'Cancel placement':'Place on plan'}</button>
      <div className="cs-number-grid">{numbers('size',['Width / X (mm)','Depth / Y (mm)','Height / Z (mm)'])}</div>
      <p className="cs-instruction">{COMPONENTS[draft.kind].pipe?'For a straight run, enter its length on one axis and the same diameter on the other two. Use rotation for a horizontal diagonal.':'Enter the designed component envelope. No member sizing is calculated.'}</p>
      <label>Rotation (degrees)<input aria-label="Component rotation" type="number" min="-360" max="360" step="1" value={draft.rotation} onChange={e=>change('rotation',e.target.value)}/></label>
      <label>System / circuit<input aria-label="System or circuit" maxLength="40" value={draft.system} onChange={e=>change('system',e.target.value)} placeholder={disciplineOf(draft)==='electrical'?'e.g. First floor lighting':disciplineOf(draft)==='structure'?'e.g. Frame A':'e.g. Cold water riser A'}/></label>
      {disciplineOf(draft)==='electrical'&&<label>Entered connected load (W)<input aria-label="Connected load in watts" type="number" min="0" max="100000" value={draft.loadWatts} onChange={e=>change('loadWatts',e.target.value)} placeholder="Unspecified"/></label>}
      <label>Design reference / notes<textarea aria-label="Component design notes" maxLength="300" rows="3" value={draft.notes} onChange={e=>change('notes',e.target.value)} placeholder="Reference drawing, specification or question for the designer"/></label>
      <div className="cs-actions"><button className="sp-primary" type="submit">{draft.id?'Apply component changes':'Add component to study'}</button><button type="button" onClick={()=>{setDraft(newItem(scene,floorId,draft.kind));setError('');setPlacing(false)}}>{draft.pending?'Discard form changes':'New component'}</button>{draft.id&&<button type="button" onClick={remove}>Remove component</button>}</div>
      {draft.pending&&<p className="cs-instruction" role="status">Form changes have not been applied to the house. Apply or discard them before accepting the study.</p>}
    </fieldset></form></div>
    <details className="cs-issues" open={floorIssues.length>0}><summary>Coordination checks · {floorIssues.length} items on this floor</summary><p>Checks cover entered envelopes against openings and other disciplines, plus missing system/load fields. Supports, fitting connections, reinforcement, hydraulic/electrical sizing and code compliance need design verification.</p>{floorIssues.length?<ul>{floorIssues.map((issue,i)=><li key={`${issue.code}-${i}`}><button type="button" onClick={()=>select(scene.coordination.find(v=>v.id===issue.ids[0]))}>{issue.message}</button></li>)}</ul>:<p>No geometric interference or missing service fields found by these checks.</p>}</details>
  </section>
}
