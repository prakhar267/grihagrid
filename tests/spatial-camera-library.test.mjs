import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCameraMerge, resolveCameraMerge} from '../src/spatial/camera-library.js';

const view = (id, name = id) => ({id, name, position:[1,2,3], target:[0,0,0]});
test('three-way camera merge preserves independent edits, additions and deletions', () => {
  const base = [view('a'), view('b'), view('c')];
  const review = reviewCameraMerge(base, [view('a','My A'), view('b'), view('mine')], [view('a'), view('b','Saved B'), view('c'), view('saved')]);
  assert.equal(review.some(item => item.conflict), false);
  assert.deepEqual(resolveCameraMerge(review).map(item => [item.id,item.name]), [['a','My A'],['b','Saved B'],['saved','saved'],['mine','mine']]);
});
test('same-camera rename/delete races require an explicit version choice', () => {
  const review = reviewCameraMerge([view('a'),view('b')], [view('a','Mine')], [view('a','Saved'),view('b','Other rename')]);
  assert.equal(review.filter(item => item.conflict).length, 2);
  assert.throws(() => resolveCameraMerge(review, {a:'draft'}), /every conflicting camera/);
  assert.deepEqual(resolveCameraMerge(review, {a:'draft',b:'saved'}).map(item=>item.name), ['Mine','Other rename']);
  assert.deepEqual(resolveCameraMerge(review, {a:'saved',b:'draft'}).map(item=>item.name), ['Saved']);
});
test('identical concurrent edits and key ordering do not create false conflicts', () => {
  const a = view('a');
  const review = reviewCameraMerge([a], [{...a,name:'Same'}], [{name:'Same',target:a.target,id:'a',position:a.position}]);
  assert.equal(review[0].conflict, undefined);
  assert.equal(resolveCameraMerge(review)[0].name, 'Same');
});
test('merge respects the 40-camera limit', () => {
  const review = reviewCameraMerge([],Array.from({length:21},(_,i)=>view(`mine-${i}`)),Array.from({length:20},(_,i)=>view(`saved-${i}`)));
  assert.throws(()=>resolveCameraMerge(review), /more than 40/);
});
