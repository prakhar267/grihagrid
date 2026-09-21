import { sectionPlane } from './building-sections.js'

export default function SectionControls({ model, value, onChange, children }) {
  const plane = sectionPlane(model, value)
  return <div className="ds-section-controls" role="group" aria-label="Building section controls">
    <label>Section direction<select aria-label="Section direction" value={value.axis} onChange={e => onChange({ ...value, axis: e.target.value })}>
      <option value="y">A–A · across width</option><option value="x">B–B · along depth</option>
    </select></label>
    <label className="ds-section-position">Cut position · {Math.round(plane.coordinate)} mm from model origin
      <input aria-label="Section cut position" aria-valuetext={`${value.percent} percent, ${Math.round(plane.coordinate)} millimetres`} type="range" min="5" max="95" step="1" value={value.percent} onChange={e => onChange({ ...value, percent: Number(e.target.value) })}/>
    </label>
    <output aria-live="polite">{plane.name} · {value.percent}% · looking {plane.direction}</output>{children}
  </div>
}
