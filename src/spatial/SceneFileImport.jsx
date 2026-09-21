import { useEffect, useRef, useState } from 'react'
import { MAX_SCENE_BYTES, parseSceneFile } from './scene-file.js'

export default function SceneFileImport({ onOpen, disabled }) {
  const [scene,setScene]=useState(null),[error,setError]=useState(''),[reading,setReading]=useState(false)
  const input=useRef(null),trigger=useRef(null),review=useRef(null)
  useEffect(()=>{if(scene)review.current?.focus()},[scene])
  async function choose(event) {
    const file=event.target.files?.[0];if(!file)return
    setScene(null);setError('');setReading(true)
    try { if(file.size>MAX_SCENE_BYTES)throw new Error('Choose a scene JSON file smaller than 2 MB.');setScene(parseSceneFile(await file.text())) }
    catch(error){setError(error.message)}finally{setReading(false);event.target.value=''}
  }
  return <div className="sp-scene-import">
    <input ref={input} type="file" accept=".json,application/json" aria-label="Saved scene JSON file" hidden onChange={choose}/>
    <button ref={trigger} type="button" className="sp-secondary" disabled={disabled||reading} onClick={()=>input.current.click()}>{reading?'Checking scene…':'Open saved scene JSON'}</button>
    {error&&<p role="alert">{error}</p>}
    {scene&&<div ref={review} tabIndex={-1} className="sp-scene-review" role="region" aria-label="Review saved scene"><strong>{scene.model.name}</strong><p>Revision {scene.model.revision} · {scene.model.floors.length} floors · {scene.model.rooms.length} rooms · {scene.viewpoints.length} saved cameras.</p><p>Opening replaces this demo tab. Download your current scene first to keep it. The file stays on this computer.</p>{!scene.houseBrief&&<p>This older export has no house brief. North and site requirements will be unconfirmed.</p>}<button type="button" className="sp-primary" disabled={disabled} onClick={()=>{onOpen(scene);setScene(null);}}>Open this saved study</button><button type="button" className="sp-text-button" onClick={()=>{setScene(null);trigger.current?.focus()}}>Cancel</button></div>}
  </div>
}
