import { validateBuilding } from './model.js'
import { validateTour } from './tours.js'
import { validateViewpoints } from './viewpoints.js'
import { validateHouseBrief } from './house-brief.js'

export const MAX_SCENE_BYTES = 2 * 1024 * 1024
export function parseSceneFile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SCENE_BYTES) throw new Error('Choose a scene JSON file smaller than 2 MB.')
  let scene
  try { scene = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  if (!scene || Array.isArray(scene) || typeof scene !== 'object' || Object.keys(scene).some(key => !['model','tour','viewpoints','houseBrief'].includes(key))) throw new Error('Choose a GrihaGrid scene export containing a model, tour and viewpoints.')
  try {
    if (!validateBuilding(scene.model).valid) throw new Error()
  } catch { throw new Error('The scene contains unsupported or invalid building geometry.') }
  try {
    if (!validateTour(scene.model,scene.tour).valid) throw new Error()
  } catch { throw new Error('The saved tour does not match this building. Export a rebuilt tour from its original study.') }
  if (!validateViewpoints(scene.viewpoints === undefined ? [] : scene.viewpoints,scene.model)) throw new Error('The saved cameras do not match this concept revision.')
  if (Object.hasOwn(scene, 'houseBrief') && !validateHouseBrief(scene.houseBrief).valid) throw new Error('The saved house brief is invalid.')
  return {...scene,viewpoints:scene.viewpoints||[]}
}
