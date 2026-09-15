import assert from 'node:assert/strict';
import fixture from './fixtures/spatial-release.json' with { type: 'json' };

/** Runs only on the exact synthetic project already owned by the release canary. */
export async function runSpatialReleaseCanary(call, projectId, inputRevision) {
  assert.match(projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.ok(Number.isSafeInteger(inputRevision) && inputRevision > 0);
  const path = `/api/projects/${projectId}/spatial`;
  const post = (route, body, expected = [201]) => call(route, {
    method: 'POST', headers: { 'idempotency-key': `release-spatial-${crypto.randomUUID()}` }, body: JSON.stringify(body),
  }, expected);
  const empty = await call(path);
  assert.equal(empty.spatialRevision, 0);
  assert.equal(empty.tourRevision, 0);
  assert.equal(empty.cameraRevision, 0);
  // Privileged deploy runners have Node and Wrangler, not project dependencies.
  // The reviewed fixture is validated by the real server before persistence.
  // Exercise the full edited-model format before retaining the legacy persistence
  // journey below. A preview must validate geometry without creating a revision.
  const v2Preview = await post(`${path}/preview`, {
    expectedInputRevision: inputRevision, expectedSpatialRevision: 0, model: structuredClone(fixture.v2Model),
  }, [200]);
  assert.equal(v2Preview.model.schemaVersion, 2);
  assert.equal(v2Preview.proposedRevision, 1);
  assert.deepEqual(v2Preview.model, { ...fixture.v2Model, revision: 1 });
  assert.deepEqual(await call(path), empty);
  const initial = { expectedInputRevision: inputRevision, expectedSpatialRevision: 0, model: structuredClone(fixture.model) };
  const preview = await post(`${path}/preview`, initial, [200]);
  assert.equal(preview.proposedRevision, 1);
  const conceptBody = { ...initial, model: preview.model, acceptedImpact: true };
  const concept = await post(path, conceptBody);
  assert.equal(concept.project.id, projectId);
  assert.equal(concept.spatialRevision, 1);
  assert.deepEqual(concept.model, preview.model);
  const base = { expectedInputRevision: inputRevision, expectedSpatialRevision: 1 };
  const tour = structuredClone(fixture.tour);
  const tourBody = { ...base, expectedTourRevision: 0, tour };
  const directed = await post(`${path}/tour`, tourBody);
  assert.equal(directed.tourRevision, 1);
  assert.deepEqual(directed.tour, tour);
  const viewpoints = [{ ...structuredClone(fixture.viewpoint), id: crypto.randomUUID() }];
  const cameraBody = { ...base, expectedCameraRevision: 0, viewpoints };
  const cameras = await post(`${path}/viewpoints`, cameraBody);
  assert.equal(cameras.cameraRevision, 1);
  const loaded = await call(path);
  const preserved = value => ({ model: value.model, tour: value.tour, viewpoints: value.viewpoints,
    spatialRevision: value.spatialRevision, tourRevision: value.tourRevision, cameraRevision: value.cameraRevision });
  assert.deepEqual(preserved(loaded), { model: concept.model, tour, viewpoints, spatialRevision: 1, tourRevision: 1, cameraRevision: 1 });
  assert.equal(loaded.stale, false);
  assert.equal(loaded.tourStale, false);
  // Stale revisions must fail even before archive changes the project state.
  await post(`${path}/viewpoints`, cameraBody, [409]);
  await call(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
  const archived = await call(path);
  assert.equal(archived.project.status, 'archived');
  for (const [route, body] of [[path, { ...conceptBody, ...base }], [`${path}/preview`, { ...initial, ...base }],
    [`${path}/tour`, { ...tourBody, expectedTourRevision: 1 }], [`${path}/viewpoints`, { ...cameraBody, expectedCameraRevision: 1 }]]) {
    const rejected = await post(route, body, [409]);
    assert.equal(rejected.code, 'project_archived');
  }
  assert.deepEqual(preserved(await call(path)), preserved(loaded));
  return { v2PreviewVerified: true, persistenceVerified: true, archiveFenceVerified: true, staleRevisionRejected: true,
    spatialRevision: 1, tourRevision: 1, cameraRevision: 1 };
}
