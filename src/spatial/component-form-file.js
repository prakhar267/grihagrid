import { COMPONENTS } from './coordination.js'
import { reconcileComponentForms } from './component-drafts.js'

export const MAX_COMPONENT_FORM_BYTES = 64 * 1024
const fields = ['id','kind','label','floorId','position','size','rotation','system','notes','loadWatts','pending','source','conflict']
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key))
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
const text = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const numberEntry = value => typeof value === 'string' && value.length <= 64
  && /^(?:|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(value)
const vector = value => Array.isArray(value) && value.length === 3 && value.every(numberEntry)

function checkedForm(form) {
  if (!exact(form,fields) || !(form.id === null || identifier(form.id)) || !identifier(form.floorId)
    || typeof form.kind!=='string' || !Object.hasOwn(COMPONENTS,form.kind) || !text(form.label,60) || /[\t\r\n]/.test(form.label)
    || !text(form.system,40) || /[\t\r\n]/.test(form.system) || !text(form.notes,300)
    || !vector(form.position) || !vector(form.size) || !numberEntry(form.rotation)
    || !(numberEntry(form.loadWatts) || typeof form.loadWatts === 'number' && Number.isFinite(form.loadWatts))
    || form.pending !== true || ![null,'changed','removed'].includes(form.conflict)
    || !(form.id === null ? form.source === null : typeof form.source === 'string' && form.source.length > 0 && form.source.length <= 4096)) {
    throw new Error('The component file contains unsupported form fields. Open an original GrihaGrid component-form download.')
  }
  // File flags never decide whether an existing source is safe to edit.
  return {...structuredClone(form), pending:true, conflict:null}
}

function checkedPacket(value) {
  let forms,buildingName=null
  if (exact(value,['kind','buildingId','form']) && value.kind === 'grihagrid-component-form') forms=[value.form]
  else if (exact(value,['kind','version','buildingId','buildingName','forms']) && value.kind === 'grihagrid-component-forms' && value.version === 1) {
    forms=value.forms;buildingName=value.buildingName
    if (!(buildingName===null || text(buildingName,120)&&buildingName.trim().length>0)) throw new Error('The saved house name is invalid.')
  }
  else throw new Error('Choose a GrihaGrid component-form file, not a scene or schedule.')
  if (!identifier(value.buildingId) || !Array.isArray(forms) || forms.length < 1 || forms.length > 4) throw new Error('A component-form file must contain one to four floor forms for one house.')
  const checked=forms.map(checkedForm)
  if (new Set(checked.map(form=>form.floorId)).size !== checked.length) throw new Error('This file contains more than one form for the same floor.')
  return {kind:'grihagrid-component-forms',version:1,buildingId:value.buildingId,buildingName,forms:checked}
}

export function parseComponentFormFile(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_COMPONENT_FORM_BYTES) throw new Error('Choose a component-form JSON file no larger than 64 KB.')
  let value
  try { value=JSON.parse(source) } catch { throw new Error('This component-form file is not valid JSON.') }
  return checkedPacket(value)
}

export function componentFormFile(model,drafts) {
  const packet=checkedPacket({kind:'grihagrid-component-forms',version:1,buildingId:model.id,buildingName:model.name,forms:Object.values(drafts).filter(form=>form.pending)})
  const result=JSON.stringify(packet,null,2)
  if (new TextEncoder().encode(result).length > MAX_COMPONENT_FORM_BYTES) throw new Error('These form entries exceed the 64 KB recovery-file limit.')
  return result
}

export function reviewComponentFormFile(model,value) {
  const packet=checkedPacket(value)
  if (packet.buildingId !== model.id || packet.buildingName!==null && packet.buildingName!==model.name) throw new Error('These forms belong to a different house. Reopen their original saved house before restoring them.')
  if (packet.forms.some(form=>!model.floors.some(floor=>floor.id===form.floorId))) throw new Error('A saved form refers to a floor missing from this house. Reopen the house version containing that floor. Your current forms are unchanged.')
  return reconcileComponentForms(model,Object.fromEntries(packet.forms.map(form=>[form.floorId,form])))
}

export function restoreComponentFormFile(model,current,value,{legacyConfirmed=false}={}) {
  if (Object.values(current).some(form=>form.pending)) throw new Error('Apply or discard your current component forms before restoring another file. Download them first to keep a copy.')
  const packet=checkedPacket(value)
  if(packet.buildingName===null&&legacyConfirmed!==true)throw new Error('This older file has no house name. Confirm that you reopened its original house before restoring forms.')
  return {...current,...reviewComponentFormFile(model,packet)}
}
