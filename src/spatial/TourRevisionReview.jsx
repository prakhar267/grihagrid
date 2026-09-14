import {useEffect, useRef} from 'react';
import './camera-library.css';

export default function TourRevisionReview({review, model, busy, onFetch, onUseDraft, onUseSaved, onDownload, onLoadProject, onCancel}) {
  const heading=useRef(null);
  useEffect(()=>{heading.current?.focus();},[review.latest]);
  const describe=tour=>tour?.roomIds.map(id=>model.rooms.find(room=>room.id===id)?.name||id).join(' → ');
  return <section className="sp-camera-review" aria-labelledby="tour-review-title">
    <h2 id="tour-review-title" ref={heading} tabIndex={-1}>Review the tour revision conflict.</h2>
    <p>Your tour draft is still here. Another session saved a revision before yours.</p>
    {!review.latest?<button className="sp-primary" disabled={busy} onClick={onFetch}>Review latest tour revision</button>:review.projectChanged?<>
      <p>The project, concept or archive status also changed. Download your tour draft before loading the latest project. Loading replaces all unsaved layout, tour and camera changes in this tab.</p>
      <button className="sp-secondary" disabled={busy} onClick={onLoadProject}>Load latest project and replace local drafts</button>
    </>:<>
      <div className="sp-tour-review-versions">{[['Your draft',review.draft],['Latest saved tour',review.latest.tour]].map(([label,tour])=><article key={label}>
        <h3>{label}</h3><p>{tour?`${tour.duration} seconds · ${tour.shots.length} shots · eye height ${(tour.eyeHeight||1650)/10} cm`:'No saved tour'}</p><p>{describe(tour)}</p>
        {tour&&<details><summary>{label} shot details</summary><ol>{tour.shots.map(shot=><li key={shot.id}>{shot.kind} · {model.rooms.find(room=>room.id===shot.roomId)?.name||'Exterior'} · {Math.round(shot.duration*10)/10} sec</li>)}</ol></details>}
      </article>)}</div>
      <p>Choosing your draft prepares it against saved tour revision {review.latest.tourRevision||0}. Save tour revision then appends a new revision. Choosing the saved tour replaces only your local tour; camera and layout drafts stay here.</p>
      <div className="sp-camera-review-actions"><button className="sp-primary" disabled={busy} onClick={onUseDraft}>Keep my tour as the draft</button><button className="sp-secondary" disabled={busy||!review.latest.tour} onClick={onUseSaved}>Use latest saved tour</button></div>
    </>}
    <div className="sp-camera-review-actions"><button className="sp-secondary" onClick={onDownload}>Download my tour draft</button><button className="sp-text-button" disabled={busy} onClick={onCancel}>Keep editing my tour</button></div>
  </section>;
}
