const canonical = value => value === undefined ? 'undefined' : JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const same = (left, right) => canonical(left) === canonical(right);

/** Three-way merge of whole camera records. A deletion is an explicit version. */
export function reviewCameraMerge(base, draft, saved) {
  const maps = [base, draft, saved].map(list => new Map(list.map(view => [view.id, view])));
  const ids = [...new Set([...saved, ...draft, ...base].map(view => view.id))];
  return ids.map(id => {
    const [before, local, latest] = maps.map(map => map.get(id));
    const name=before?.name||local?.name||latest?.name||id;
    if (same(local, before)) return {id, name, view: latest, source: 'saved'};
    if (same(latest, before) || same(local, latest)) return {id, name, view: local, source: 'draft'};
    return {id, conflict: true, base: before, draft: local, saved: latest};
  });
}

export function resolveCameraMerge(review, choices = {}) {
  const unresolved = review.filter(item => item.conflict && !['draft', 'saved'].includes(choices[item.id]));
  if (unresolved.length) throw new Error('Choose your edit or the saved edit for every conflicting camera.');
  const views = review.map(item => item.conflict ? item[choices[item.id]] : item.view).filter(Boolean);
  if (views.length > 40) throw new Error('This merge has more than 40 viewpoints. Keep editing your draft and remove some before merging.');
  return views;
}
