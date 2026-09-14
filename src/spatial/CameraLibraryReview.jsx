import {useEffect, useRef} from 'react';
import './camera-library.css';

export default function CameraLibraryReview({review, busy, onFetch, onChoose, onApply, onDownload, onLoadProject, onCancel}) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [review.latest]);
  const unresolved = review.entries?.some(item => item.conflict && !review.choices[item.id]);
  return <section className="sp-camera-review" aria-labelledby="camera-review-title">
    <h2 id="camera-review-title" ref={heading} tabIndex={-1}>Review the camera library conflict.</h2>
    <p>Your camera draft is still here. Another session saved changes before yours.</p>
    {!review.latest ? <button className="sp-primary" disabled={busy} onClick={onFetch}>Review latest camera library</button> : review.projectChanged ? <>
      <p>The project, concept or archive status also changed. Download your camera draft before loading the latest project. Loading replaces all unsaved layout, tour and camera changes in this tab.</p>
      <button className="sp-secondary" disabled={busy} onClick={onLoadProject}>Load latest project and replace local drafts</button>
    </> : <>
      <p>Compare your draft with saved revision {review.latest.cameraRevision || 0}. Changes to different cameras are combined below. Choose a version where both sessions changed the same camera. Applying this review prepares a draft; use Save camera library to commit it.</p>
      <ul>{review.entries.map(item => <li key={item.id}>
        {item.conflict ? <fieldset disabled={busy}><legend>{item.base?.name || item.draft?.name || item.saved?.name} — both sessions changed this camera</legend>
          <label><input type="radio" name={`camera-conflict-${item.id}`} checked={review.choices[item.id] === 'draft'} onChange={() => onChoose(item.id, 'draft')}/> My edit: {item.draft?.name || 'Delete camera'}</label>
          <label><input type="radio" name={`camera-conflict-${item.id}`} checked={review.choices[item.id] === 'saved'} onChange={() => onChoose(item.id, 'saved')}/> Saved edit: {item.saved?.name || 'Delete camera'}</label>
        </fieldset> : <span>{item.view?.name || `Delete ${item.name}`} <small>· {item.source === 'draft' ? 'your draft' : 'saved version'}</small></span>}
      </li>)}</ul>
      <button className="sp-primary" disabled={busy || unresolved} onClick={onApply}>Apply reviewed camera merge</button>
    </>}
    <div className="sp-camera-review-actions"><button className="sp-secondary" onClick={onDownload}>Download my camera draft</button><button className="sp-text-button" disabled={busy} onClick={onCancel}>Keep editing my draft</button></div>
  </section>;
}
