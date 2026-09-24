import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPONENTS } from './coordination.js'
import { MAX_COMPONENT_FORM_BYTES, parseComponentFormFile, reviewComponentFormFile } from './component-form-file.js'

export default function ComponentFormFiles({model,pending,disabled,onRestore,onDownload}) {
  const [packet,setPacket]=useState(null),[reading,setReading]=useState(false),[error,setError]=useState(''),[legacyConfirmed,setLegacyConfirmed]=useState(false)
  const input=useRef(null),trigger=useRef(null),reviewRef=useRef(null),errorRef=useRef(null),sequence=useRef(0)
  useEffect(()=>()=>{sequence.current++},[])
  useEffect(()=>{if(packet)reviewRef.current?.focus()},[packet])
  useEffect(()=>{if(error)errorRef.current?.focus()},[error])
  const review=useMemo(()=>{
    if(!packet)return null
    try{return {forms:Object.values(reviewComponentFormFile(model,packet))}}
    catch(e){return {error:e.message}}
  },[packet,model])
  async function choose(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    const request=++sequence.current
    setPacket(null);setError('');setLegacyConfirmed(false);setReading(true)
    try {
      if(file.size>MAX_COMPONENT_FORM_BYTES)throw new Error('Choose a component-form JSON file no larger than 64 KB.')
      const result=parseComponentFormFile(await file.text())
      if(sequence.current===request)setPacket(result)
    }catch(e){if(sequence.current===request)setError(e.message)}
    finally{if(sequence.current===request)setReading(false)}
  }
  function restore() {
    if(disabled||pending||!packet||packet.buildingName===null&&!legacyConfirmed)return
    try{onRestore(packet,{legacyConfirmed});setPacket(null);setError('')}
    catch(e){setError(e.message)}
  }
  return <div className="cs-form-files">
    <div className="cs-actions"><button type="button" disabled={!pending} onClick={onDownload}>Download component forms</button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="Saved component forms file" hidden onChange={choose}/>
      <button ref={trigger} type="button" disabled={disabled||reading} onClick={()=>input.current.click()}>{reading?'Reading forms…':'Open saved component forms'}</button></div>
    <p className="cs-instruction">Keep unfinished entries from every floor in a local file. Save the house separately; a form file does not include its geometry. Reopen that house before restoring forms.</p>
    {error&&<p ref={errorRef} className="cs-error" role="alert" tabIndex={-1}>{error}</p>}
    {review&&<section ref={reviewRef} className="cs-form-review" role="region" aria-label="Review saved component forms" tabIndex={-1}>
      <h3>Review saved forms</h3>
      <p>Saved house: {packet.buildingName||'Not recorded in this older file'}.</p>
      {review.error?<p role="alert">{review.error}</p>:<><p>{review.forms.length} floor {review.forms.length===1?'form':'forms'} for {model.name}. Restoring fills the forms only. Nothing is applied to the house until you review and apply each component.</p>
        <ul>{review.forms.map(form=><li key={form.floorId}><details><summary>{model.floors.find(f=>f.id===form.floorId).name} · {form.label||'Unnamed component'} · {COMPONENTS[form.kind].name}</summary>
          <p>{form.id?(form.conflict==='removed'?'Original component missing — conflict review required.':form.conflict==='changed'?'Original component changed — conflict review required.':'Original component matches.'): 'New component — review its placement and dimensions.'}</p>
          <p>Centre / base: {form.position.map(v=>v===''?'Unfinished':v).join(' / ')} mm. Size X / Y / Z: {form.size.map(v=>v===''?'Unfinished':v).join(' / ')} mm. Rotation: {form.rotation===''?'Unfinished':form.rotation}°.</p>
          <p>System / circuit: {form.system||'Unspecified'}.{COMPONENTS[form.kind].discipline==='electrical'&&` Entered load: ${form.loadWatts===''?'Unspecified':`${form.loadWatts} W`}.`}</p>
          <p className="cs-form-notes">{form.notes||'No design notes.'}</p></details></li>)}</ul></>}
      {packet.buildingName===null&&!review.error&&<label className="cs-legacy-confirm"><input type="checkbox" checked={legacyConfirmed} onChange={event=>setLegacyConfirmed(event.target.checked)}/> I have reopened the original house for these older forms. The file has no house name to check.</label>}
      {pending&&<p className="cs-instruction">Apply or discard the current component forms before restoring another file. Download them first to keep a copy.</p>}
      <div className="cs-actions"><button type="button" className="sp-primary" disabled={disabled||pending||Boolean(review.error)||packet.buildingName===null&&!legacyConfirmed} onClick={restore}>Restore forms for review</button><button type="button" onClick={()=>{setPacket(null);setError('');trigger.current?.focus()}}>Cancel form import</button></div>
    </section>}
  </div>
}
