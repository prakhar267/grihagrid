/** Required immutable spatial storage, shared by readiness and release evidence. */
export const SPATIAL_SCHEMA = Object.freeze({
  tables: ['spatial_revisions', 'spatial_tour_revisions', 'spatial_camera_revisions', 'house_brief_revisions'],
  triggers: ['spatial_revisions_immutable', 'spatial_tours_immutable', 'spatial_cameras_immutable',
    'house_briefs_immutable', 'house_briefs_active', 'spatial_brief_source_guard', 'spatial_revisions_active', 'spatial_tours_active', 'spatial_cameras_active'],
  columns: {
    house_brief_revisions: ['project_id', 'revision', 'input_revision', 'brief_json', 'request_key', 'request_hash', 'created_at'],
    spatial_revisions: ['brief_revision', 'project_id', 'revision', 'input_revision', 'model_json', 'request_key', 'request_hash', 'created_at'],
    spatial_tour_revisions: ['project_id', 'revision', 'spatial_revision', 'input_revision', 'tour_json', 'request_key', 'request_hash', 'created_at'],
    spatial_camera_revisions: ['project_id', 'revision', 'spatial_revision', 'input_revision', 'viewpoints_json', 'request_key', 'request_hash', 'created_at'],
  },
});
