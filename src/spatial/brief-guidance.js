import { assessHouseBrief } from './house-brief.js';

// Navigation advice only. The shared assessment and layout generator remain
// authoritative; being ready to try a layout is not a promise that it will fit.
export function briefIssueAction(id) {
  if (id === 'city') return { step: 'site', target: 'hb-city', label: 'Add your location' };
  if (['setbacks', 'envelope'].includes(id)) return { step: 'site', target: 'hb-setbacks', label: 'Review plot-edge spaces' };
  if (id === 'rules') return { step: 'site', target: 'hb-local-rules', label: 'Review local limits' };
  if (id === 'road') return { step: 'site', target: 'hb-road-width', label: 'Add road width' };
  if (id === 'climate') return { step: 'site', target: 'hb-climate', label: 'Review site climate' };
  if (/^(empty|fit)-\d+$/.test(id)) return { step: 'rooms', target: `hb-floor-${id.split('-')[1]}`, label: 'Edit this floor’s rooms' };
  if (['far', 'coverage', 'ground-bed', 'ground-bath'].includes(id)) return { step: 'rooms', label: 'Review rooms and areas' };
  if (id === 'height') return { step: 'rooms', target: 'hb-floors', label: 'Review floor count' };
  if (['north', 'vastu'].includes(id)) return { step: 'needs', target: 'hb-north', label: 'Review north and Vastu' };
  if (id === 'budget') return { step: 'needs', target: 'hb-budget', label: 'Review your budget' };
  if (['parking', 'access', 'lift'].includes(id) || id.startsWith('service-')) return { step: 'needs', label: 'Review lifestyle needs' };
  if (['survey', 'corner', 'renovation', 'units', 'buyer'].includes(id)) return { destination: 'drawing', label: 'Bring a measured drawing' };
  if (id.startsWith('model-') || id.startsWith('entry-') || id.startsWith('window-')) return { destination: 'plan', label: 'Review the floor plan' };
  return null;
}

export function briefGenerationGuidance(brief) {
  // Never let an unrelated existing/example model decide whether a new study
  // can be attempted. Its own comparison remains visible in the review.
  const assessment = assessHouseBrief(brief);
  if (!assessment.valid) return { kind: 'invalid', title: 'Check your house details', detail: assessment.issues[0].title };
  const manualReasons = [];
  if (brief.shape !== 'rectangular') manualReasons.push('this plot shape');
  if (brief.projectType !== 'new_build') manualReasons.push('this project type');
  if (brief.rooms.some(room => ['courtyard', 'balcony', 'terrace'].includes(room.kind))) manualReasons.push('open courtyards, balconies or terraces');
  if (manualReasons.length) return { kind: 'drawing', title: 'Continue with a measured drawing', detail: `The automatic starter does not handle ${manualReasons.join(' or ')}. Keep your requirements and bring a drawing to review and edit.`, action: { destination: 'drawing', label: 'Import a drawing' } };
  if (!assessment.setbacksKnown) return { kind: 'details', title: 'Add the spaces around your plot', detail: 'Enter the open space needed at all four plot edges before creating a layout. Unknown values stay blank; zero is an explicit assumption of no gap.', action: briefIssueAction('setbacks') };
  const blocker = assessment.issues.find(issue => issue.status === 'blocked');
  if (blocker) return { kind: 'details', title: blocker.title, detail: blocker.detail, action: briefIssueAction(blocker.id) };
  return { kind: 'ready', title: 'Ready to try a layout', detail: 'Create a first layout from your rooms and entered limits, then review it before accepting. Fit, access and local approvals still need checking.' };
}
