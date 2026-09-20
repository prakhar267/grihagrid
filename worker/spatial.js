import { handleHouseBrief } from './house-brief.js';
import { validateBuilding } from '../src/spatial/model.js';
import { validateConnectivity } from '../src/spatial/navigation.js';
import { validateTour } from '../src/spatial/tours.js';
import {validateSpatialIntent,providerIntentContext,tourIntentResponseSchema,preservesRequestedDirection,spatialIntentPrompt} from './spatial-intent.js';
import {saveViewpoints} from './spatial-viewpoints.js';
export {validateSpatialIntent} from './spatial-intent.js';

const positive = n => Number.isSafeInteger(n) && n > 0;
function exact(body, fields, HttpError) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k)))
    throw new HttpError(400, 'Unsupported spatial request fields', 'invalid_spatial_request');
}
function assertBase(body, project, revision, HttpError) {
  if (!positive(body.expectedInputRevision) || !Number.isSafeInteger(body.expectedSpatialRevision) || body.expectedSpatialRevision < 0)
    throw new HttpError(400, 'A valid source revision is required', 'invalid_spatial_request');
  if (body.expectedInputRevision !== Number(project.input_revision) || body.expectedSpatialRevision !== Number(revision?.revision || 0))
    throw new HttpError(409, 'The project changed. Reload before saving this study.', 'spatial_revision_conflict');
}
function normalizeModel(value, nextRevision, HttpError) {
  if (JSON.stringify(value)?.length > 48000) throw new HttpError(400, 'The spatial model is too large', 'invalid_spatial_model');
  const result = validateBuilding(value);
  if (!result.valid) throw new HttpError(400, 'Invalid spatial model: ' + result.errors.slice(0, 3).join('; '), 'invalid_spatial_model');
  const connectivity = validateConnectivity(value);
  if (!connectivity.valid) throw new HttpError(400, 'Every room needs a traversable connection. Check the doors and furniture.', 'invalid_spatial_model');
  return { ...value, revision: nextRevision };
}
async function latestRows(db, projectId) {
  const [model, tour, cameras, brief] = await Promise.all([
    db.prepare('SELECT * FROM spatial_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId).first(),
    db.prepare('SELECT * FROM spatial_tour_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId).first(),
    db.prepare('SELECT * FROM spatial_camera_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId).first(),
    db.prepare('SELECT * FROM house_brief_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId).first(),
  ]);
  return { model, tour, cameras, brief };
}
function projection(project, rows, history) {
  return {
    project: { id: project.id, name: project.name, status: project.status, inputRevision: Number(project.input_revision), input: JSON.parse(project.input_json || "{}") },
    houseBrief: rows.brief ? JSON.parse(rows.brief.brief_json) : null,
    briefRevision: Number(rows.brief?.revision || 0),
    briefStale: Boolean(rows.brief && Number(rows.brief.input_revision)!==Number(project.input_revision)),
    spatialRevision: Number(rows.model?.revision || 0), tourRevision: Number(rows.tour?.revision || 0),
    model: rows.model ? JSON.parse(rows.model.model_json) : null,
    tour: rows.tour ? JSON.parse(rows.tour.tour_json) : null,
    cameraRevision:Number(rows.cameras?.revision||0),
    viewpoints:rows.cameras?JSON.parse(rows.cameras.viewpoints_json):[],
    sourceInputRevision: rows.model ? Number(rows.model.input_revision) : null,
    sourceBriefRevision: rows.model ? Number(rows.model.brief_revision || 0) : null,
    stale: Boolean(rows.model && (Number(rows.model.input_revision) !== Number(project.input_revision) || Number(rows.model.brief_revision || 0) !== Number(rows.brief?.revision || 0))),
    tourStale: Boolean(rows.tour && (Number(rows.tour.spatial_revision) !== Number(rows.model?.revision) || Number(rows.tour.input_revision) !== Number(project.input_revision) || Number(rows.model?.brief_revision || 0) !== Number(rows.brief?.revision || 0))),
    ...(history ? { history } : {}),
  };
}

export async function handleSpatialRequest(request, env, projectId, action, h) {
  const { HttpError, json, requireDatabase, getSession, ownedProject, requireActiveProject,
    requireTrustedOrigin, requireCsrf, readJson, digestHex, normalizeIdempotencyKey,
    requireAbuseControl, rateLimit } = h;
  const allowed = action === '' ? ['GET', 'POST'] : ['POST'];
  if (!allowed.includes(request.method)) return h.methodNotAllowed(allowed);
  const db = requireDatabase(env);
  if (request.method !== 'GET') requireTrustedOrigin(request, env);
  const session = await getSession(request, env);
  if (request.method !== 'GET') await requireCsrf(request, session);
  const project = await ownedProject(db, projectId, session.user_id);
  const rows = await latestRows(db, projectId);
  if (request.method === 'GET') {
    const history = await db.prepare('SELECT revision,input_revision AS inputRevision,brief_revision AS briefRevision,created_at AS createdAt FROM spatial_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 20').bind(projectId).all();
    return json(projection(project, rows, history.results || []));
  }
  requireActiveProject(project);
  requireAbuseControl(env);
  await rateLimit(request, env, `spatial:${session.user_id}`, 60, 3600);
  const body = await readJson(request);
  if(action==='brief'||action==='brief-preview')return handleHouseBrief({request,body,action,db,project,rows,session,h,projection,latestRows});
  const fields = ['expectedInputRevision', 'expectedSpatialRevision', 'expectedBriefRevision'];
  if(body.expectedBriefRevision!==undefined&&(!Number.isSafeInteger(body.expectedBriefRevision)||body.expectedBriefRevision<0))throw new HttpError(400,'A valid house brief source revision is required','invalid_spatial_request');
  if((body.expectedBriefRevision??0)!==Number(rows.brief?.revision||0))throw new HttpError(409,'The house brief changed. Reload and review it before saving.','house_brief_conflict');
  if ((action === 'tour' || action === 'tour-intent' || action === 'viewpoints') && rows.model && (Number(rows.model.input_revision) !== Number(project.input_revision)||Number(rows.model.brief_revision||0)!==Number(rows.brief?.revision||0)))
    throw new HttpError(409, 'The brief changed. Review and accept the spatial concept before directing a tour.', 'spatial_source_stale');
  if(action==='viewpoints')return saveViewpoints({request,body,db,project,rows,session,helpers:h,assertBase,projection,latestRows});
  if (action === 'tour-intent') {
    exact(body, [...fields, 'acceptedAiTerms', 'intent'], HttpError);
    assertBase(body, project, rows.model, HttpError);
    if (body.acceptedAiTerms !== true) throw new HttpError(400, 'Consent to sending room stops and timing is required', 'ai_terms_required');
    if (!rows.model) throw new HttpError(409, 'Save the spatial concept before requesting AI direction', 'spatial_model_required');
    const model = JSON.parse(rows.model.model_json);
    if (!validateSpatialIntent(body.intent, model)) throw new HttpError(400, 'Choose known rooms and a duration between 10 and 180 seconds', 'invalid_tour_intent');
    const config = h.requireGeminiConfig(env);
    const sourceHash = await digestHex(rows.model.model_json);
    const lease = await h.acquireAiGenerationAdmission(db, projectId, session.user_id, sourceHash);
    try {
      const context=providerIntentContext(model,body.intent);
      const sanitized=context.data;
      const provider = typeof env.GEMINI_FETCH === 'function' ? env.GEMINI_FETCH : fetch;
      let response;
      try { response = await provider('https://generativelanguage.googleapis.com/v1/interactions', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({ model: config.model, store: false,
          input: spatialIntentPrompt + JSON.stringify(sanitized),
          generation_config: { max_output_tokens: 2400, thinking_level: 'low' },
          response_format: { type: 'text', mime_type: 'application/json', schema:tourIntentResponseSchema(sanitized) },
        }), signal: AbortSignal.timeout(25000),
      }); } catch { throw new HttpError(503, 'AI direction is temporarily unavailable. Manual tours remain available.', 'tour_ai_unavailable'); }
      if (!response.ok) throw new HttpError(503, 'AI direction is temporarily unavailable. Manual tours remain available.', 'tour_ai_unavailable');
      if (!response.body) throw new HttpError(502, 'The AI response was empty', 'invalid_tour_intent');
      const reader = response.body.getReader(); let text = ''; let bytes = 0; const decoder = new TextDecoder();
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65536) throw new Error('size'); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      catch { await reader.cancel().catch(() => {}); throw new HttpError(502, 'The AI response could not be validated', 'invalid_tour_intent'); }
      let intent;
      try { intent = JSON.parse(h.extractGeminiText(JSON.parse(text))); } catch { throw new HttpError(502, 'The AI response could not be validated', 'invalid_tour_intent'); }
      intent=context.fromProvider(intent);
      if (!validateSpatialIntent(intent, model)||!preservesRequestedDirection(intent,body.intent)) throw new HttpError(502, 'The AI direction did not preserve the requested rooms, subjects or timing', 'invalid_tour_intent');
      const current = await ownedProject(db, projectId, session.user_id);
      const currentRows = await latestRows(db, projectId);
      requireActiveProject(current); assertBase(body, current, currentRows.model, HttpError);
      if((body.expectedBriefRevision??0)!==Number(currentRows.brief?.revision||0))throw new HttpError(409,'The house brief changed during camera direction. Review the current brief.','house_brief_conflict');
      return json({ intent, source: 'gemini', sourceRevision: model.revision });
    } finally { await h.releaseAiGenerationLease(db, projectId, session.user_id, lease); }
  }
  if (action === 'tour') {
    exact(body, [...fields, 'expectedTourRevision', 'tour'], HttpError);
    assertBase(body, project, rows.model, HttpError);
    if (!rows.model) throw new HttpError(409, 'Save a spatial concept first', 'spatial_model_required');
    if (!Number.isSafeInteger(body.expectedTourRevision) || body.expectedTourRevision < 0) throw new HttpError(400, 'A tour revision is required', 'invalid_spatial_request');
    const model = JSON.parse(rows.model.model_json);
    const result = validateTour(model, body.tour);
    if (!result.valid) throw new HttpError(400, 'The tour is invalid or stale', 'invalid_spatial_tour');
    const key = await digestHex(session.user_id + ':' + normalizeIdempotencyKey(request));
    const hash = await digestHex(JSON.stringify(body));
    const replay = await db.prepare('SELECT request_hash FROM spatial_tour_revisions WHERE project_id=? AND request_key=?').bind(projectId, key).first();
    if (replay) { if (replay.request_hash !== hash) throw new HttpError(409, 'This request key was already used', 'idempotency_conflict'); return json(projection(project, rows)); }
    const resultInsert = await db.prepare(`INSERT INTO spatial_tour_revisions (project_id,revision,spatial_revision,input_revision,tour_json,request_key,request_hash)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND status!='archived' AND input_revision=?)
      AND COALESCE((SELECT MAX(revision) FROM spatial_tour_revisions WHERE project_id=?),0)=?
      AND (SELECT MAX(revision) FROM spatial_revisions WHERE project_id=?)=?
      AND COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=?),0)=?`)
      .bind(projectId, body.expectedTourRevision + 1, rows.model.revision, project.input_revision, JSON.stringify(body.tour), key, hash,
        projectId, session.user_id, body.expectedInputRevision, projectId, body.expectedTourRevision, projectId, body.expectedSpatialRevision, projectId, Number(rows.brief?.revision||0)).run();
    if (resultInsert.meta.changes !== 1) throw new HttpError(409, 'The tour changed. Reload before saving.', 'spatial_revision_conflict');
    return json(projection(project, await latestRows(db, projectId)), 201);
  }
  exact(body, [...fields, 'model', ...(action === '' ? ['acceptedImpact'] : [])], HttpError);
  const model = normalizeModel(body.model, body.expectedSpatialRevision + 1, HttpError);
  if (action === 'preview') {
    assertBase(body, project, rows.model, HttpError);
    return json({ model, baseRevision: body.expectedSpatialRevision, proposedRevision: body.expectedSpatialRevision + 1,
      changeStudy: { summary: rows.model ? 'The spatial layout will become a new immutable concept revision. Existing tours will need review.' : 'Save this reviewed layout as the first spatial concept for this project.', rooms: model.rooms.length, existingToursBecomeStale: Boolean(rows.tour), estimateUnchanged: true } });
  }
  if (body.acceptedImpact !== true) throw new HttpError(400, 'Review and accept the Change Study first', 'impact_acceptance_required');
  const key = await digestHex(session.user_id + ':' + normalizeIdempotencyKey(request));
  const hash = await digestHex(JSON.stringify(body));
  const replay = await db.prepare('SELECT request_hash FROM spatial_revisions WHERE project_id=? AND request_key=?').bind(projectId, key).first();
  if (replay) { if (replay.request_hash !== hash) throw new HttpError(409, 'This request key was already used', 'idempotency_conflict'); return json(projection(project, rows)); }
  assertBase(body, project, rows.model, HttpError);
  const inserted = await db.prepare(`INSERT INTO spatial_revisions (project_id,revision,input_revision,model_json,request_key,request_hash,brief_revision)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND status!='archived' AND input_revision=?)
    AND COALESCE((SELECT MAX(revision) FROM spatial_revisions WHERE project_id=?),0)=?
    AND COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=?),0)=?`)
    .bind(projectId, body.expectedSpatialRevision + 1, project.input_revision, JSON.stringify(model), key, hash, Number(rows.brief?.revision||0),
      projectId, session.user_id, body.expectedInputRevision, projectId, body.expectedSpatialRevision, projectId, Number(rows.brief?.revision||0)).run();
  if (inserted.meta.changes !== 1) throw new HttpError(409, 'The project changed. Reload before saving.', 'spatial_revision_conflict');
  return json(projection(project, await latestRows(db, projectId)), 201);
}
