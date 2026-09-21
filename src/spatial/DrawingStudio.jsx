import { useMemo, useState } from 'react'
import { floorPlanSheet, elevationSheet, stairSectionSheet, buildingSectionSheet, openingSchedule, drawingSetHTML } from './drawing-set.js'
import SectionControls from './SectionControls.jsx'
import './drawing-studio.css'

function download(text, name, type) {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a')
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)
}
export default function DrawingStudio({model,floorId,northDegrees,section,onSectionChange,onExploreSection,children}) {
  const [view,setView]=useState('drawing'),[sheet,setSheet]=useState('plan'),[unit,setUnit]=useState('mm'),[zoom,setZoom]=useState(100)
  const options=useMemo(()=>({unit,northDegrees,section}),[unit,northDegrees,section])
  const svg=useMemo(()=>sheet==='elevations'?elevationSheet(model):sheet==='stairs'?stairSectionSheet(model):sheet==='section'?buildingSectionSheet(model,options):floorPlanSheet(model,floorId,options),[model,floorId,sheet,options])
  const schedule=useMemo(()=>openingSchedule(model,floorId),[model,floorId])
  return <section className="drawing-studio" aria-label="Architectural drawings">
    <div className="ds-view-switch" role="group" aria-label="Plan workspace mode">
      <button type="button" aria-pressed={view==='drawing'} onClick={()=>setView('drawing')}>Measured drawings</button>
      <button type="button" aria-pressed={view==='edit'} onClick={()=>setView('edit')}>Edit / furnish rooms</button>
    </div>
    <div hidden={view!=='drawing'}>
      <div className="ds-heading"><div><span className="sp-eyebrow">ARCHITECTURAL DRAWING SET</span><h2>A house, in detail.</h2><p>Measured plans, opening schedules, elevations and building sections, coordinated with your 3D model.</p></div></div>
      <div className="ds-toolbar">
        <label>Drawing<select aria-label="Drawing sheet" value={sheet} onChange={e=>setSheet(e.target.value)}><option value="plan">Active floor plan</option><option value="elevations">Four elevations</option><option value="stairs">Stair sections</option><option value="section">Building section</option></select></label>
        <label>Dimensions<select aria-label="Drawing dimension units" value={unit} onChange={e=>setUnit(e.target.value)}><option value="mm">Millimetres</option><option value="m">Metres</option><option value="ft">Feet / inches</option></select></label>
        <label>Sheet zoom<select aria-label="Drawing zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value="100">Fit sheet</option><option value="150">150%</option><option value="200">200%</option><option value="300">300%</option></select></label>
        <button type="button" onClick={()=>download(svg,`${model.id}-${sheet==='plan'?floorId:sheet}-detailed.svg`,'image/svg+xml')}>Download sheet</button>
        <button type="button" onClick={()=>download(drawingSetHTML(model,options),`${model.id}-drawing-set.html`,'text/html')}>Download / print set</button>
      </div>
      {sheet==='section'&&<SectionControls model={model} value={section} onChange={onSectionChange}><button type="button" className="sp-secondary" onClick={onExploreSection}>Explore this section in 3D</button></SectionControls>}
      <p className="ds-sheet-hint">Use the floor selector for each storey. Zoom the sheet to inspect dimensions; scroll within the paper. The downloaded set includes every floor.</p>
      <div className="ds-paper-scroll" tabIndex="0" aria-label="Drawing sheet scroll area"><div className="ds-paper" style={{width:`${zoom}%`}} dangerouslySetInnerHTML={{__html:svg}}/></div>
      <details className="ds-schedule"><summary>Door &amp; window schedule · {schedule.length} openings on this floor</summary><div className="ds-table-scroll"><table><caption>Measured openings in millimetres</caption><thead><tr><th>Tag</th><th>Type</th><th>Width</th><th>Height</th><th>Sill</th><th>Rooms</th></tr></thead><tbody>{schedule.map(o=><tr key={`${o.wallId}:${o.id}`}><td>{o.tag}</td><td>{o.kind}</td><td>{o.width}</td><td>{o.height}</td><td>{o.sill||0}</td><td>{o.rooms}</td></tr>)}</tbody></table></div></details>
      <p className="ds-note">Room dimensions follow the model’s boundary axes; wall thickness reduces clear space. These are concept drawings. Structural, electrical, plumbing and approval drawings require professional design.</p>
    </div>
    <div hidden={view!=='edit'}>{children}</div>
  </section>
}
