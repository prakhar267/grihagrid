/** Required immutable spatial storage, shared by readiness and release evidence. */
export const SPATIAL_SCHEMA = Object.freeze({
  tables: ['spatial_revisions', 'spatial_tour_revisions', 'spatial_camera_revisions'],
  triggers: ['spatial_revisions_immutable', 'spatial_tours_immutable', 'spatial_cameras_immutable',
    'spatial_revisions_active', 'spatial_tours_active', 'spatial_cameras_active'],
  columns: {
    spatial_revisions: ['project_id', 'revision', 'input_revision', 'model_json', 'request_key', 'request_hash', 'created_at'],
    spatial_tour_revisions: ['project_id', 'revision', 'spatial_revision', 'input_revision', 'tour_json', 'request_key', 'request_hash', 'created_at'],
    spatial_camera_revisions: ['project_id', 'revision', 'spatial_revision', 'input_revision', 'viewpoints_json', 'request_key', 'request_hash', 'created_at'],
  },
});
