// Form-only provenance. Never spread a draft into the persisted building model.
const sourceOf = item => JSON.stringify([
  item.id, item.floorId, item.kind, item.label, item.position, item.size,
  item.rotation, item.system, item.notes, item.loadWatts ?? null,
])

export function componentForm(item) {
  return {...structuredClone(item), position:item.position.map(String), size:item.size.map(String),
    rotation:String(item.rotation*180/Math.PI), loadWatts:item.loadWatts??'',
    pending:false, source:sourceOf(item), conflict:null}
}

export function newComponentForm(model,floorId,kind='column') {
  const room=model.rooms.find(r=>r.floorId===floorId&&!r.exterior)
  const center=room?room.polygon.reduce((p,q)=>[p[0]+q[0]/room.polygon.length,p[1]+q[1]/room.polygon.length],[0,0]):[0,0]
  return {id:null,kind,label:'',floorId,position:[...center.map(v=>String(Math.round(v/50)*50)),'0'],
    size:['','',''],rotation:'0',system:'',notes:'',loadWatts:'',pending:false,source:null,conflict:null}
}

export function reconcileComponentForm(model,draft) {
  if(!model.floors.some(f=>f.id===draft.floorId))return null
  if(!draft.id)return draft
  const current=model.coordination?.find(item=>item.id===draft.id&&item.floorId===draft.floorId)
  if(!draft.pending) {
    if(!current)return newComponentForm(model,draft.floorId,draft.kind)
    return sourceOf(current)===draft.source?draft:componentForm(current)
  }
  const conflict=!current?'removed':sourceOf(current)!==draft.source?'changed':null
  return conflict===draft.conflict?draft:{...draft,conflict}
}

export function reconcileComponentForms(model,drafts) {
  let changed=false
  const next={}
  for(const [floorId,draft] of Object.entries(drafts)) {
    const result=reconcileComponentForm(model,draft)
    if(result)next[floorId]=result
    if(result!==draft)changed=true
  }
  return changed?next:drafts
}
