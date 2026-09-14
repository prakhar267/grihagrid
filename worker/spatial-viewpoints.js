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

export async function saveViewpoints({request,body,db,project,rows,session,helpers,assertBase,projection,latestRows}){
  const {HttpError,json,digestHex,normalizeIdempotencyKey}=helpers;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedInputRevision','expectedSpatialRevision','expectedCameraRevision','viewpoints'].includes(key)))throw new HttpError(400,'Unsupported camera-library fields','invalid_camera_library');
  if(!Number.isSafeInteger(body.expectedCameraRevision)||body.expectedCameraRevision<0)throw new HttpError(400,'A camera-library revision is required','invalid_camera_library');
  if(!rows.model)throw new HttpError(409,'Save the spatial concept before saving cameras','spatial_model_required');
  const model=JSON.parse(rows.model.model_json),previous=rows.cameras?JSON.parse(rows.cameras.viewpoints_json):[];
  const key=await digestHex(session.user_id+':'+normalizeIdempotencyKey(request)),hash=await digestHex(JSON.stringify(body));
  const replay=await db.prepare('SELECT request_hash FROM spatial_camera_revisions WHERE project_id=? AND request_key=?').bind(project.id,key).first();
  if(replay){if(replay.request_hash!==hash)throw new HttpError(409,'This request key was already used','idempotency_conflict');return json(projection(project,rows));}
  if(!validateViewpoints(body.viewpoints,model,previous))throw new HttpError(400,'Camera names, references or viewpoints are invalid','invalid_camera_library');
  assertBase(body,project,rows.model,HttpError);
  const result=await db.prepare(`INSERT INTO spatial_camera_revisions (project_id,revision,spatial_revision,input_revision,viewpoints_json,request_key,request_hash)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND status!='archived' AND input_revision=?)
    AND COALESCE((SELECT MAX(revision) FROM spatial_camera_revisions WHERE project_id=?),0)=?
    AND (SELECT MAX(revision) FROM spatial_revisions WHERE project_id=?)=?`)
    .bind(project.id,body.expectedCameraRevision+1,model.revision,project.input_revision,JSON.stringify(body.viewpoints),key,hash,
      project.id,session.user_id,body.expectedInputRevision,project.id,body.expectedCameraRevision,project.id,body.expectedSpatialRevision).run();
  if(result.meta.changes!==1)throw new HttpError(409,'The camera library changed. Reload before saving.','camera_revision_conflict');
  return json(projection(project,await latestRows(db,project.id)),201);
}
