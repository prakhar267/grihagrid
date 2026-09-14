const boundedId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
const point=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=200000);

export function validateViewpoints(views,model,previous=[]){
  if(!Array.isArray(views)||views.length>40)return false;
  const ids=new Set();
  return views.every(view=>{
    if(!view||typeof view!=='object'||Array.isArray(view)||Object.keys(view).some(key=>!['id','name','buildingId','sourceRevision','floorId','position','target','fov'].includes(key)))return false;
    if(!boundedId(view.id)||ids.has(view.id)||typeof view.name!=='string'||view.name.trim().length<1||view.name.length>80||/[\u0000-\u001f]/.test(view.name))return false;
    ids.add(view.id);
    if(!boundedId(view.buildingId)||!Number.isSafeInteger(view.sourceRevision)||view.sourceRevision<1||!point(view.position)||!point(view.target)||Math.hypot(...view.position.map((n,i)=>n-view.target[i]))<1||!Number.isFinite(view.fov)||view.fov<20||view.fov>110)return false;
    if(view.floorId!==undefined&&!boundedId(view.floorId))return false;
    if(view.buildingId!==model.id||view.sourceRevision!==model.revision){
      // Retain a stale camera only if its stored geometry is unchanged. It can
      // be renamed/deleted, but it cannot be repurposed as a new stale pose.
      const old=previous.find(item=>item.id===view.id);
      if(!old)return false;
      return ['id','buildingId','sourceRevision','floorId','fov'].every(key=>old[key]===view[key])&&['position','target'].every(key=>old[key].every((n,i)=>n===view[key][i]));
    }
    return view.floorId===undefined||model.floors.some(floor=>floor.id===view.floorId);
  });
}
