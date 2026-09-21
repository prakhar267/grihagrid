import { normalizeHouseBrief, assessHouseBrief } from '../src/spatial/house-brief.js';

export async function handleHouseBrief({ request, body, action, db, project, rows, session, h, projection, latestRows }) {
  const { HttpError, json, digestHex, normalizeIdempotencyKey } = h;
  const fields = ['expectedInputRevision', 'expectedSpatialRevision', 'expectedBriefRevision', 'brief', ...(action === 'brief' ? ['acceptedImpact'] : [])];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new HttpError(400, 'Unsupported house brief fields', 'invalid_house_brief');
  for (const key of ['expectedInputRevision', 'expectedSpatialRevision', 'expectedBriefRevision']) if (!Number.isSafeInteger(body[key]) || body[key] < (key === 'expectedInputRevision' ? 1 : 0)) throw new HttpError(400, 'Valid source revisions are required', 'invalid_house_brief');
  let brief;
  try { brief = normalizeHouseBrief(body.brief); } catch (error) { throw new HttpError(400, error.message, 'invalid_house_brief'); }
  const key = action === 'brief' ? await digestHex(session.user_id + ':' + normalizeIdempotencyKey(request)) : null;
  const hash = await digestHex(JSON.stringify(body));
  const replay = async () => {
    if (!key) return null;
    const previous = await db.prepare('SELECT request_hash FROM house_brief_revisions WHERE project_id=? AND request_key=?').bind(project.id, key).first();
    if (!previous) return null;
    if (previous.request_hash !== hash) throw new HttpError(409, 'This request key was already used for a different brief', 'idempotency_conflict');
    return json(projection(project, await latestRows(db, project.id)));
  };
  const replayed = await replay(); if (replayed) return replayed;
  if (body.expectedInputRevision !== Number(project.input_revision) || body.expectedSpatialRevision !== Number(rows.model?.revision || 0) || body.expectedBriefRevision !== Number(rows.brief?.revision || 0)) throw new HttpError(409, 'The house changed. Reload before saving your brief.', 'house_brief_conflict');
  if (rows.brief?.brief_json === JSON.stringify(brief) && Number(rows.brief.input_revision) === Number(project.input_revision)) throw new HttpError(400, 'Change a requirement before saving another brief revision', 'house_brief_unchanged');
  if (action === 'brief-preview') return json({ brief, baseRevision: body.expectedBriefRevision, proposedRevision: body.expectedBriefRevision + 1, review: assessHouseBrief(brief, rows.model ? JSON.parse(rows.model.model_json) : null), changeStudy: { summary: 'Save an immutable house brief revision. Existing geometry and tours will require review. Earlier planning estimates and reports stay unchanged.' } });
  if (body.acceptedImpact !== true) throw new HttpError(400, 'Review and accept the brief Change Study first', 'impact_acceptance_required');
  const inserted = await db.prepare(`INSERT INTO house_brief_revisions (project_id,revision,input_revision,brief_json,request_key,request_hash)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND status!='archived' AND input_revision=?)
    AND COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=?),0)=?
    AND COALESCE((SELECT MAX(revision) FROM spatial_revisions WHERE project_id=?),0)=?`)
    .bind(project.id, body.expectedBriefRevision + 1, body.expectedInputRevision, JSON.stringify(brief), key, hash, project.id, session.user_id, body.expectedInputRevision, project.id, body.expectedBriefRevision, project.id, body.expectedSpatialRevision).run();
  if (inserted.meta.changes !== 1) { const concurrent = await replay(); if (concurrent) return concurrent; throw new HttpError(409, 'The house changed. Reload before saving.', 'house_brief_conflict'); }
  return json(projection(project, await latestRows(db, project.id)), 201);
}
