import { validateViewpoints } from '../src/spatial/viewpoints.js';
export { validateViewpoints } from '../src/spatial/viewpoints.js';

export async function saveViewpoints({request,body,db,project,rows,session,helpers,assertBase,projection,latestRows}){
  const {HttpError,json,digestHex,normalizeIdempotencyKey}=helpers;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedBriefRevision','expectedInputRevision','expectedSpatialRevision','expectedCameraRevision','viewpoints'].includes(key)))throw new HttpError(400,'Unsupported camera-library fields','invalid_camera_library');
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
    AND (SELECT MAX(revision) FROM spatial_revisions WHERE project_id=?)=?
    AND COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=?),0)=?`)
    .bind(project.id,body.expectedCameraRevision+1,model.revision,project.input_revision,JSON.stringify(body.viewpoints),key,hash,
      project.id,session.user_id,body.expectedInputRevision,project.id,body.expectedCameraRevision,project.id,body.expectedSpatialRevision,project.id,Number(rows.brief?.revision||0)).run();
  if(result.meta.changes!==1)throw new HttpError(409,'The camera library changed. Reload before saving.','camera_revision_conflict');
  return json(projection(project,await latestRows(db,project.id)),201);
}
