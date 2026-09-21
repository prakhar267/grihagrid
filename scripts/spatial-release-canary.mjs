import assert from 'node:assert/strict';
import fixture from './fixtures/spatial-release.json' with { type: 'json' };
import houses from './fixtures/house-release.json' with { type: 'json' };

// Fixtures keep the privileged release runner independent of npm dependencies.
// Both cities run on the one synthetic project that the caller cleans up.
async function verifyHouses(call, post, path, inputRevision, initial) {
  let loaded = initial;
  const results = [];
  for (const house of houses) {
    const base = { expectedInputRevision: inputRevision, expectedSpatialRevision: loaded.spatialRevision,
      expectedBriefRevision: loaded.briefRevision };
    const briefBody = { ...base, brief: house.brief };
    const briefPreview = await post(`${path}/brief-preview`, briefBody, [200]);
    assert.equal(briefPreview.proposedRevision, base.expectedBriefRevision + 1);
    assert.deepEqual(briefPreview.brief, house.brief);
    assert.deepEqual(await call(path), loaded);
    const key = `release-house-${crypto.randomUUID()}`;
    const acceptedBrief = { ...briefBody, acceptedImpact: true };
    const briefSaved = await post(`${path}/brief`, acceptedBrief, [201], key);
    assert.deepEqual(await post(`${path}/brief`, acceptedBrief, [200], key), briefSaved);
    assert.equal(briefSaved.briefRevision, base.expectedBriefRevision + 1);
    assert.equal(briefSaved.project.inputRevision, inputRevision);
    assert.equal(briefSaved.stale, true);
    assert.equal(briefSaved.tourStale, true);
    assert.deepEqual(briefSaved.model, loaded.model);
    const stale = await post(path, { ...base, model: loaded.model, acceptedImpact: true }, [409]);
    assert.equal(stale.code, 'house_brief_conflict');
    base.expectedBriefRevision = briefSaved.briefRevision;
    const staleTour = await post(`${path}/tour`, { ...base, expectedTourRevision: loaded.tourRevision, tour: loaded.tour }, [409]);
    assert.equal(staleTour.code, 'spatial_source_stale');
    const preview = await post(`${path}/preview`, { ...base, model: house.model }, [200]);
    assert.deepEqual(preview.model, house.model);
    const { history: ignoredHistory, ...afterPreview } = await call(path);
    assert.deepEqual(afterPreview, briefSaved);
    const saved = await post(path, { ...base, model: preview.model, acceptedImpact: true });
    assert.equal(saved.spatialRevision, loaded.spatialRevision + 1);
    assert.equal(saved.sourceBriefRevision, briefSaved.briefRevision);
    base.expectedSpatialRevision = saved.spatialRevision;
    await post(`${path}/tour`, { ...base, expectedTourRevision: loaded.tourRevision, tour: house.tour });
    await post(`${path}/viewpoints`, { ...base, expectedCameraRevision: loaded.cameraRevision, viewpoints: house.viewpoints });
    const previous = loaded;
    loaded = await call(path);
    assert.deepEqual(loaded.houseBrief, house.brief);
    assert.deepEqual(loaded.model, house.model);
    assert.deepEqual(loaded.tour, house.tour);
    assert.deepEqual(loaded.viewpoints, house.viewpoints);
    assert.equal(loaded.spatialRevision, saved.spatialRevision);
    assert.equal(loaded.tourRevision, previous.tourRevision + 1);
    assert.equal(loaded.cameraRevision, previous.cameraRevision + 1);
    assert.equal(loaded.stale, false);
    assert.equal(loaded.tourStale, false);
    const floorIds = loaded.model.floors.map(floor => floor.id).sort();
    assert.equal(floorIds.length, 3);
    assert.deepEqual([...new Set(loaded.viewpoints.map(view => view.floorId))].sort(), floorIds);
    const roomFloor = new Map(loaded.model.rooms.map(room => [room.id, room.floorId]));
    assert.deepEqual([...new Set(loaded.tour.shots.map(shot => roomFloor.get(shot.roomId)).filter(Boolean))].sort(), floorIds);
    results.push({ city: house.brief.city, floors: floorIds.length, rooms: loaded.model.rooms.length,
      stairs: loaded.model.stairs.length, cameraFloors: floorIds.length, tourFloors: floorIds.length,
      briefRevision: loaded.briefRevision, spatialRevision: loaded.spatialRevision,
      persistenceVerified: true, readOnlyPreviewVerified: true, briefReplayVerified: true, staleBriefRejected: true });
  }
  return { loaded, results };
}

/** Runs only on the exact synthetic project already owned by the release canary. */
export async function runSpatialReleaseCanary(call, projectId, inputRevision) {
  assert.match(projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.ok(Number.isSafeInteger(inputRevision) && inputRevision > 0);
  const path = `/api/projects/${projectId}/spatial`;
  const post = (route, body, expected = [201], key = `release-spatial-${crypto.randomUUID()}`) => call(route, {
    method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify(body),
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
  const multiStorey = await verifyHouses(call, post, path, inputRevision, loaded);
  await call(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
  const archived = await call(path);
  assert.equal(archived.project.status, 'archived');
  for (const [route, body] of [[path, { ...conceptBody, ...base }], [`${path}/preview`, { ...initial, ...base }],
    [`${path}/tour`, { ...tourBody, expectedTourRevision: 1 }], [`${path}/viewpoints`, { ...cameraBody, expectedCameraRevision: 1 }],
    [`${path}/brief-preview`, { ...base, expectedBriefRevision: multiStorey.loaded.briefRevision, brief: houses[0].brief }],
    [`${path}/brief`, { ...base, expectedBriefRevision: multiStorey.loaded.briefRevision, brief: houses[0].brief, acceptedImpact: true }]]) {
    const rejected = await post(route, body, [409]);
    assert.equal(rejected.code, 'project_archived');
  }
  const afterArchive = await call(path);
  assert.deepEqual(preserved(afterArchive), preserved(multiStorey.loaded));
  assert.deepEqual(afterArchive.houseBrief, multiStorey.loaded.houseBrief);
  assert.equal(afterArchive.briefRevision, multiStorey.loaded.briefRevision);
  return { v2PreviewVerified: true, persistenceVerified: true, archiveFenceVerified: true, staleRevisionRejected: true,
    houses: multiStorey.results, spatialRevision: afterArchive.spatialRevision,
    tourRevision: afterArchive.tourRevision, cameraRevision: afterArchive.cameraRevision };
}
