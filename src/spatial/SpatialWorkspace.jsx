import { AiConsent, aiProviders } from '../AiConsent.jsx';
import SceneFileImport from './SceneFileImport.jsx'
import SectionControls from './SectionControls.jsx'
import DrawingStudio from './DrawingStudio.jsx';
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spatialUUID } from './ids.js'
import { ArrowLeft, ArrowRight, ArrowsOut, Blueprint, Buildings, Camera, Check, Compass, DownloadSimple, Eye, FloppyDisk, House, List, Pause, Play, Plus, ArrowClockwise, Sparkle, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { api } from '../api.js';
import { registerNavigationGuard } from '../navigation-guard.js';
import { createDemoBuilding, createMultiFloorDemo, validateBuilding, resizeBuilding } from './model.js';
import { defaultTourRoomIds, generateTour, parseTourIntent, retimeTour, isTourStale, getShotStatuses } from './tours.js';
import DrawingImport from './DrawingImport.jsx';
import LayoutEditor from './LayoutEditor.jsx';
import RenderPanel from './RenderPanel.jsx';
import CameraLibraryReview from './CameraLibraryReview.jsx';
import TourRevisionReview from './TourRevisionReview.jsx';
import HouseBrief from './HouseBrief.jsx';
import { defaultHouseBrief } from './house-brief.js';
import { generateBriefLayout } from './brief-layout.js';
import { validateConnectivity } from './navigation.js';
import { roomOnFloor, roomLabel } from './workspace-navigation.js';
import {reviewCameraMerge, resolveCameraMerge} from './camera-library.js';
import './spatial.css';

const WorldCanvas = lazy(() => import('./WorldCanvas.jsx'));
const unsavedWarning = 'Leave the spatial studio? Unsaved house brief, layout, tour or camera changes in this tab will be lost. Save your project changes or download the scene to keep a copy.';
const tabs = [['brief', 'House brief', List], ['explore', '3D Explore', Buildings], ['plan', '2D Plan', Blueprint], ['tour', 'Camera Tour', Camera], ['export', 'Render / Export', DownloadSimple]];
const area = room => Math.abs(room.polygon.reduce((a, p, i, points) => { const next = points[(i + 1) % points.length]; return a + p[0] * next[1] - next[0] * p[1]; }, 0)) / 2e6;
const centroid = room => room.polygon.reduce((a, p) => [a[0] + p[0] / room.polygon.length, a[1] + p[1] / room.polygon.length], [0, 0]);
const bounds = model => { const points = model.rooms.flatMap(r => r.polygon); return { x0: Math.min(...points.map(p => p[0])), x1: Math.max(...points.map(p => p[0])), y0: Math.min(...points.map(p => p[1])), y1: Math.max(...points.map(p => p[1])) }; };
const seconds = value => `${Math.floor((value || 0) / 60)}:${String(Math.floor((value || 0) % 60)).padStart(2, '0')}`;
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); }

class SceneBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch() { this.props.onError?.('3D rendering is unavailable on this device. The floor plan remains available.'); }
  render() { return this.state.error ? <div className="sp-empty"><Blueprint size={32}/><h2>Your floor plan is still available.</h2><p>Open 2D Plan to continue inspecting this concept.</p></div> : this.props.children; }
}

function Plan({ model, selectedRoomId, onSelect, compact = false, floorId }) {
  model = {...model, rooms:model.rooms.filter(r=>!floorId||r.floorId===floorId), walls:model.walls.filter(w=>!floorId||(w.floorId||model.rooms.find(r=>w.roomIds.includes(r.id))?.floorId)===floorId)};
  if(!model.rooms.length)return <p className="sp-muted">No rooms on this floor yet.</p>;
  const b = bounds(model), pad = compact ? 160 : 1300;
  return <svg className={`sp-plan ${compact ? 'sp-plan--mini' : ''}`} viewBox={`${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`} role="group" aria-label={compact ? 'Floor plan navigator' : 'Editable concept floor plan; choose a room to inspect'}>
    <defs><pattern id={compact ? 'small-grid' : 'plan-grid'} width="500" height="500" patternUnits="userSpaceOnUse"><path d="M 500 0 L 0 0 0 500" fill="none" stroke="#d8cfc0" strokeWidth="12"/></pattern></defs>
    {!compact && <rect x={b.x0 - pad} y={b.y0 - pad} width={b.x1 - b.x0 + pad * 2} height={b.y1 - b.y0 + pad * 2} fill="url(#plan-grid)"/>}
    {model.rooms.map(room => { return <g key={room.id} tabIndex={0} role="button" aria-pressed={selectedRoomId===room.id} aria-label={`Select ${room.name}`} onClick={() => onSelect(room.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(room.id); } }} className={selectedRoomId === room.id ? 'is-selected' : ''}>
      <polygon points={room.polygon.map(p => p.join(',')).join(' ')} fill={selectedRoomId === room.id ? '#ddc1a8' : room.color || '#eee7d9'} stroke="#7b6e5e" strokeWidth={compact ? 35 : 25}/>
    </g>; })}
    {!compact && model.furniture.map(item => <rect key={item.id} x={item.position[0] - item.size[0] / 2} y={item.position[1] - item.size[1] / 2} width={item.size[0]} height={item.size[1]} rx="50" fill="#c8b9a6" stroke="#978875" strokeWidth="20" opacity=".7" transform={`rotate(${(item.rotation || 0) * 180 / Math.PI},${item.position[0]},${item.position[1]})`} style={{pointerEvents:'none'}}/>)}
    {model.walls.map(wall => <g key={wall.id} style={{pointerEvents:'none'}}><line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke="#3f3932" strokeWidth={wall.thickness}/>{(wall.openings || []).map(opening => { const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]); const dx = (wall.end[0] - wall.start[0]) / length, dy = (wall.end[1] - wall.start[1]) / length; return <line key={opening.id} x1={wall.start[0] + dx * opening.offset} y1={wall.start[1] + dy * opening.offset} x2={wall.start[0] + dx * (opening.offset + opening.width)} y2={wall.start[1] + dy * (opening.offset + opening.width)} stroke={opening.kind === 'window' ? '#b4c9c8' : '#f3efe6'} strokeWidth={wall.thickness + 15}/>; })}</g>)}
    {!compact && model.rooms.map(r=>{const c=centroid(r);return <g key={`label-${r.id}`} style={{pointerEvents:'none'}}><rect x={c[0]-1200} y={c[1]-390} width="2400" height="780" fill="#f3efe6" opacity=".88"/><text x={c[0]} y={c[1]-30} textAnchor="middle" fontSize="300">{r.name}</text><text x={c[0]} y={c[1]+250} textAnchor="middle" fontSize="210" fill="#746c62">{area(r).toFixed(1)} m²</text></g>})}
    {!compact && <><text x={(b.x0 + b.x1) / 2} y={b.y0 - 530} fontSize="200" textAnchor="middle">{((b.x1 - b.x0) / 1000).toFixed(2)} m</text><text x={b.x1 + 500} y={(b.y0 + b.y1) / 2} fontSize="180" textAnchor="middle" transform={`rotate(90,${b.x1 + 500},${(b.y0 + b.y1) / 2})`}>{((b.y1 - b.y0) / 1000).toFixed(2)} m</text></>}
  </svg>;
}

export default function SpatialWorkspace({ projectId, onNavigate, logoutConfirmed = false }) {
  const initial = useMemo(() => createDemoBuilding(), []);
  const [houseBrief,setHouseBrief]=useState(defaultHouseBrief),[savedBrief,setSavedBrief]=useState(defaultHouseBrief),[briefStudy,setBriefStudy]=useState(null);
  const briefDirty=JSON.stringify(houseBrief)!==JSON.stringify(savedBrief),briefDirtyRef=useRef(false);
  briefDirtyRef.current=briefDirty;

  const [model, setModel] = useState(initial), [accepted, setAccepted] = useState(initial);
  const [tab, setTab] = useState(()=>['plan','brief'].includes(window.history.state?.initialView)?window.history.state.initialView:'explore'), [mode, setMode] = useState('overview');
  const [importing,setImporting]=useState(false),[activeFloorId,setActiveFloorId]=useState(initial.floors[0].id),[isolateFloor,setIsolateFloor]=useState(false);
  const [componentPending,setComponentPending]=useState(false),[componentReview,setComponentReview]=useState(0);
  const [section,setSection]=useState({axis:'y',percent:50}),[sectionEnabled,setSectionEnabled]=useState(false);
  const [eyeHeight,setEyeHeight]=useState(1650),[shotPreferences,setShotPreferences]=useState([]),[viewsDirty,setViewsDirty]=useState(false);
  const cameraRequest=useRef(null),tourRequest=useRef(null),viewsDirtyRef=useRef(false);
  const [cameraConflict,setCameraConflict]=useState(null);
  const [tourConflict,setTourConflict]=useState(null);
  viewsDirtyRef.current=viewsDirty;
  const [selected, setSelected] = useState(initial.rooms[0].id), [hovered, setHovered] = useState(null);
  const [tour, setTour] = useState(() => generateTour(initial, {duration: 30}));
  const [cleanTour,setCleanTour]=useState(tour);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [speed, setSpeed] = useState(1);
  const [stops, setStops] = useState(tour.roomIds), [duration, setDuration] = useState(30);
  const [quality, setQuality] = useState('balanced'), [metrics, setMetrics] = useState(null), [views, setViews] = useState([]);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [renderError, setRenderError] = useState('');
  const [busy, setBusy] = useState(''), [dirty, setDirty] = useState(false), [study, setStudy] = useState(null);
  const [instruction, setInstruction] = useState('Show the living room, kitchen and courtyard in 30 seconds.');
  const [consent, setConsent] = useState(false), [allowGemini, setAllowGemini] = useState(false), [remote, setRemote] = useState(null), [loading, setLoading] = useState(Boolean(projectId));
  const [history, setHistory] = useState([{revision: 1, createdAt: new Date().toISOString()}]);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const viewer = useRef(null), requestKey = useRef(null), loadRequest=useRef({sequence:0,controller:null}), dims = bounds(model);
  const [width, setWidth] = useState((dims.x1 - dims.x0) / 1000), [depth, setDepth] = useState(initial.bounds.max[1] / 1000);
  const room = model.rooms.find(r => r.id === selected && r.floorId === activeFloorId), hoverRoom = model.rooms.find(r => r.id === hovered);
  const briefOnly = Boolean(projectId && !remote?.model && !dirty);
  const stale = dirty || Boolean(tour && isTourStale(model,tour)) || Boolean(remote?.stale || remote?.tourStale);
  const pendingItinerary = JSON.stringify(stops)!==JSON.stringify(tour.roomIds)||Math.abs(Number(duration)-tour.duration)>.01||Math.abs(eyeHeight-(tour.eyeHeight||1650))>1||JSON.stringify(shotPreferences)!==JSON.stringify(tour.shotPreferences||[]);
  const tourDraftChanged=useMemo(()=>JSON.stringify(tour)!==JSON.stringify(cleanTour),[tour,cleanTour]);
  const hasUnsavedChanges=componentPending||briefDirty||Boolean(briefStudy)||dirty||pendingItinerary||tourDraftChanged||viewsDirty||Boolean(!projectId&&(model.revision!==initial.revision||views.length));
  useEffect(()=>{
    if(!hasUnsavedChanges)return undefined;
    const warn=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    const unregister=registerNavigationGuard(()=>window.confirm(unsavedWarning));
    return()=>{window.removeEventListener('beforeunload',warn);unregister();};
  },[hasUnsavedChanges]);
  useEffect(()=>{if(study)document.getElementById('sp-study-heading')?.focus();},[study]);
  useEffect(()=>{if(briefStudy&&!briefStudy.attempted)document.getElementById('hb-study-heading')?.focus();},[briefStudy]);
  function leaveStudio(destination){
    if(hasUnsavedChanges&&!window.confirm(unsavedWarning))return;
    onNavigate(typeof destination==='string'?destination:projectId?`/projects/${projectId}`:'/dashboard');
  }
  const archived = remote?.project?.status === 'archived';
  const shotStates=useMemo(()=>getShotStatuses(model,tour),[model,tour]);
  const currentShot=tour.shots.find(shot=>time<shot.startTime+shot.duration)||tour.shots.at(-1);
  const currentTourRoom=model.rooms.find(room=>room.id===currentShot?.roomId);
  const activeFloor=model.floors.find(f=>f.id===activeFloorId)||model.floors[0];
  const visibleRooms=model.rooms.filter(r=>r.floorId===activeFloor?.id);
  const populatedFloors=model.floors.filter(f=>model.rooms.some(r=>r.floorId===f.id));
  const tourFloorCount=populatedFloors.filter(f=>stops.some(id=>model.rooms.some(r=>r.id===id&&r.floorId===f.id))).length;
  const needsAcceptance=dirty||Boolean(projectId&&remote?.stale);
  const tourBlockTitle=needsAcceptance?'Accept the layout before touring':stale?'Tour needs rebuilding':pendingItinerary?'Itinerary has pending edits':'';
  const tourBlockHint=needsAcceptance?'Review Change Study, accept the concept, then rebuild the tour.':stale?'Rebuild for this concept revision':pendingItinerary?'Rebuild to apply the new stops':'';
  const base = () => ({expectedInputRevision: remote?.project?.inputRevision, expectedSpatialRevision: remote?.spatialRevision || 0, expectedBriefRevision: remote?.briefRevision || 0});

  const applyRemote = useCallback((data,{resetCameras=false}={}) => {
    if(resetCameras)setTourConflict(null);
    if(resetCameras||!briefDirtyRef.current){const nextBrief=data.houseBrief||defaultHouseBrief(data.project?.input||{});setHouseBrief(nextBrief);setSavedBrief(nextBrief);setBriefStudy(null);}

    const keepCameras=viewsDirtyRef.current&&!resetCameras;
    setRemote(current=>keepCameras?{...data,cameraRevision:current?.cameraRevision||0,viewpoints:current?.viewpoints||[]}:data); if (data.model) { setModel(data.model); setAccepted(data.model); const b = bounds(data.model); setWidth((b.x1-b.x0)/1000);setDepth(data.model.schemaVersion===2?(b.y1-b.y0)/1000:data.model.bounds.max[1]/1000); }
    if (data.tour) {setTour(data.tour);setCleanTour(data.tour);setStops(data.tour.roomIds);setDuration(data.tour.duration);setEyeHeight(data.tour.eyeHeight||1650);setShotPreferences(data.tour.shotPreferences||[]);} else if(data.model){try{const nextTour=generateTour(data.model,{duration:30});setTour(nextTour);setCleanTour(nextTour);setStops(nextTour.roomIds);setDuration(nextTour.duration);setShotPreferences([]);}catch(e){setStops(defaultTourRoomIds(data.model));setError(e.message);}}
    if(!keepCameras){setViews(data.viewpoints||[]);setViewsDirty(false);viewsDirtyRef.current=false;cameraRequest.current=null;setCameraConflict(null);}
    if(data.model){setActiveFloorId(current=>data.model.floors.some(f=>f.id===current)?current:data.model.floors[0].id);setSelected(current=>data.model.rooms.some(r=>r.id===current)?current:data.model.rooms[0].id);}
    if(data.history)setHistory(data.history);else if(data.model)setHistory(current=>current.some(r=>r.revision===data.model.revision)?current:[{revision:data.model.revision,createdAt:new Date().toISOString()},...current]); setDirty(false);setStudy(null);setPlaying(false);
  }, []);
  const load = useCallback(async () => {
    loadRequest.current.controller?.abort();
    const controller=new AbortController(),sequence=loadRequest.current.sequence+1;
    loadRequest.current={sequence,controller};setLoading(true);setError('');
    try{const data=await api(`/api/projects/${encodeURIComponent(projectId)}/spatial`,{signal:controller.signal});if(sequence===loadRequest.current.sequence)applyRemote(data,{resetCameras:true});}
    catch(e){if(sequence===loadRequest.current.sequence&&e.name!=='AbortError')setError(e.message);}
    finally{if(sequence===loadRequest.current.sequence)setLoading(false);}
  }, [projectId, applyRemote]);
  useEffect(() => { if (projectId) load();return()=>{loadRequest.current.controller?.abort();loadRequest.current.sequence++;}; }, [projectId, load]);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const changed = () => setReduced(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const pause = useCallback(() => {setPlaying(false);}, []);
  const selectRoom = useCallback(id => {setSelected(id);const target=model.rooms.find(r=>r.id===id);if(target)setActiveFloorId(target.floorId);setPlaying(false);setMode('room'); if(tab==='plan')return; viewer.current?.focusRoom(id);}, [tab,model]);
  function selectFloor(id){setActiveFloorId(id);setPlaying(false);const first=roomOnFloor(model,id);setSelected(first?.id||null);setMode('overview');}
  const setCameraMode = value => {
    if(value==='walk'){const target=roomOnFloor(model,activeFloor.id,selected);if(!target)return;setSelected(target.id);}
    setPlaying(false);setMode(value);if(value==='overview')viewer.current?.reset();
  };
  const handleError = useCallback(value => {setRenderError(String(value));if(value)setPlaying(false);}, []);

  function regenerate(nextStops = stops, nextDuration = duration, source = 'manual', preferences=shotPreferences, height=eyeHeight) {
    if(tourConflict){setError('Finish reviewing the tour conflict or choose Keep editing my tour before rebuilding.');return null;}
    if(needsAcceptance){setMessage('');setError(tourBlockHint);return null;}
    try { const connected=validateConnectivity(model);if(!connected.valid)throw new Error(connected.errors[0]+' Open 2D Plan and check doors, stairs and clear landing space.');const next = generateTour(model, {roomIds: nextStops, duration: Number(nextDuration),shotPreferences:preferences,eyeHeight:height});setTour({...next,source});setStops(next.roomIds);setDuration(next.duration);setShotPreferences(next.shotPreferences||preferences);setEyeHeight(next.eyeHeight||height);setTime(0);setPlaying(false);setRemote(current => current ? {...current,tourStale:false} : current);setMessage(['gemini','cloudflare'].includes(source)?`${source==='cloudflare'?'Cloudflare Workers AI':'Google Gemini'} direction validated. Camera paths are calculated from the scene.`:'Tour rebuilt from the current floor plan.');setError('');return next; } catch(e){setMessage('');setError(e.message);return null;}
  }
  function playTour() { if(pendingItinerary){setError('Rebuild the tour to apply your stop and timing changes.');return;} if(stale){setError(tourBlockHint);return;}setTab('tour');setMode('tour');if(time >= (tour?.duration || 30))setTime(0);setPlaying(v=>!v); }
  function editModel(next){
    const proposal={...next,revision:accepted.revision+1};
    const validation=validateBuilding(proposal);if(!validation.valid){setError(validation.errors.slice(0,3).join('; '));return;}
    const extent=bounds(proposal);setWidth((extent.x1-extent.x0)/1000);setDepth(proposal.schemaVersion===2?(extent.y1-extent.y0)/1000:proposal.bounds.max[1]/1000);
    setModel(proposal);setDirty(true);setStudy(null);setPlaying(false);setMode('overview');setError('');requestKey.current=null;
    setStops(current=>{if(JSON.stringify(current)===JSON.stringify(defaultTourRoomIds(model)))return defaultTourRoomIds(proposal);const kept=current.filter(id=>proposal.rooms.some(r=>r.id===id));return kept.length?kept:defaultTourRoomIds(proposal);});
    setShotPreferences(current=>current.filter(s=>proposal.rooms.some(r=>r.id===s.roomId)&&(!s.subjectId||proposal.furniture.some(f=>f.id===s.subjectId))));
    setSelected(current=>roomOnFloor(proposal,proposal.floors.some(f=>f.id===activeFloorId)?activeFloorId:proposal.floors[0].id,current)?.id||null);
    setActiveFloorId(current=>proposal.floors.some(f=>f.id===current)?current:proposal.floors[0].id);
    setMessage('Layout study updated in 2D and 3D. Review before accepting.');
  }
  function reviewComponentForms() {setImporting(false);setTab('plan');setComponentReview(n=>n+1);}
  function unresolvedComponentForms() {
    if(!componentPending)return false;
    reviewComponentForms();setError('Apply or discard pending Structure & services form changes before replacing or discarding this layout.');return true;
  }
  function discardStudy() {
    if(unresolvedComponentForms())return;
    const next=accepted,extent=bounds(next),knownRooms=new Set(next.rooms.map(room=>room.id));
    const retainedStops=stops.filter(id=>knownRooms.has(id)),tourStops=tour.roomIds.filter(id=>knownRooms.has(id));
    const nextStops=retainedStops.length?retainedStops:tourStops.length?tourStops:defaultTourRoomIds(next);
    const nextRoom=next.rooms.find(room=>room.id===selected&&room.floorId===activeFloorId)||next.rooms.find(room=>room.floorId===activeFloorId)||next.rooms.find(room=>room.id===selected)||next.rooms[0];
    setModel(next);setWidth((extent.x1-extent.x0)/1000);setDepth(next.schemaVersion===2?(extent.y1-extent.y0)/1000:next.bounds.max[1]/1000);
    setSelected(nextRoom.id);setActiveFloorId(nextRoom.floorId);setStops(nextStops);
    setShotPreferences(current=>current.filter(preference=>nextStops.includes(preference.roomId)&&(!preference.subjectId||next.furniture.some(item=>item.id===preference.subjectId&&item.roomId===preference.roomId))));
    // Keep unrelated duration, eye-height, camera-library and valid tour drafts.
    setDirty(false);setStudy(null);setPlaying(false);setMode('overview');requestKey.current=null;setError('');setMessage('Layout study discarded. The accepted concept and its available rooms are restored.');
  }
  function generateFromBrief(brief) {
    if(unresolvedComponentForms())return;
    const result=generateBriefLayout(brief,{id:'brief-house',name:remote?.project?.name||(brief.city.trim()?`${brief.city.trim().slice(0,80)} house study`:'Your house study'),revision:accepted.revision+1});
    const connected=validateConnectivity(result.model);
    if(!connected.valid)throw new Error('The starter could not connect every room. Revise the programme or import a measured drawing.');
    if(dirty&&!window.confirm('Replace the current unsaved layout study? The accepted concept remains in history.'))return;
    editModel(result.model);setTab('plan');window.requestAnimationFrame(()=>document.getElementById('sp-plan-heading')?.focus());
    const unmatched=result.review.checks.filter(c=>c.status!=='matched');
    setMessage(`Created a layout from ${brief.rooms.length} requested rooms across ${brief.floors} floor${brief.floors===1?'':'s'}. ${unmatched.length?`${unmatched.length} direction or area requirements still need review in House brief. `:''}Review the Change Study before accepting.`);
  }
  async function previewHouseBrief(){
    if(!projectId||archived||busy)return;
    setBusy('brief-preview');setError('');
    try{const body={...base(),brief:structuredClone(houseBrief)};
      const preview=await api(`/api/projects/${projectId}/spatial/brief-preview`,{method:'POST',body});
      setBriefStudy({preview,body,key:spatialUUID(),attempted:false});
    }catch(e){setError(e.message);}finally{setBusy('');}
  }
  async function saveHouseBrief(){
    if(!briefStudy||busy||briefStudy.conflict)return;
    setBusy('brief-save');setError('');setBriefStudy(current=>({...current,attempted:true}));
    try{
      const response=await api(`/api/projects/${projectId}/spatial/brief`,{method:'POST',headers:{'idempotency-key':briefStudy.key},body:{...briefStudy.body,acceptedImpact:true}});
      const next=response.houseBrief;
      setSavedBrief(next);setHouseBrief(next);setBriefStudy(null);
      setRemote(current=>({...current,houseBrief:next,briefRevision:response.briefRevision,briefStale:response.briefStale,stale:Boolean(current.spatialRevision),tourStale:Boolean(current.tourRevision)}));
      setStudy(null);requestKey.current=null;
      setMessage('House requirements saved privately. Review the concept against this brief. Earlier planning estimates, reports and accepted geometry remain unchanged.');
    }catch(e){if(e.status===409)setBriefStudy(current=>({...current,conflict:true}));setError(e.message+' Your brief draft is preserved. Retry the exact save, or reload the project after downloading your draft.');}finally{setBusy('');}
  }
  function previewDimensions() {
    try {
      const multi=model.schemaVersion===2,minWidth=multi?2:11,maxWidth=multi?40:18,minDepth=multi?2:9.5,maxDepth=multi?40:15;
      if(!Number.isFinite(Number(width))||!Number.isFinite(Number(depth))||width<minWidth||width>maxWidth||depth<minDepth||depth>maxDepth)throw new Error(`Choose a width of ${minWidth}–${maxWidth} metres and a depth of ${minDepth}–${maxDepth} metres.`);
      const next=resizeBuilding(model,{width:Number(width)*1000,depth:Number(depth)*1000});editModel(next);
    }catch(e){setError(e.message);}
  }
  async function reviewStudy() {
    if(componentPending){setTab('plan');setError('Apply or discard pending Structure & services form changes before reviewing the study.');return;}
    if(projectId&&(briefDirty||remote?.briefStale)){setTab('brief');setError('Review and save the house brief first, so this concept is tied to the correct requirements.');return;}
    setBusy('study');setError('');try { if(projectId){setStudy(await api(`/api/projects/${projectId}/spatial/preview`,{method:'POST',body:{...base(),model}}));} else {const connected=validateConnectivity(model);if(!connected.valid)throw new Error(connected.errors[0]+' Connect rooms and floors in 2D Plan before accepting the concept.');setStudy({model:structuredClone(model),changeStudy:{summary:'Accept this layout as a new concept revision. Existing camera tours will need to be rebuilt.',estimateUnchanged:true}});} }catch(e){setError(e.message);}finally{setBusy('');}
  }
  async function acceptStudy() {
    if(componentPending){setTab('plan');setStudy(null);setError('Apply or discard pending component form changes before accepting the study.');return;}
    if(projectId&&(briefDirty||remote?.briefStale)){setTab('brief');setStudy(null);setError('Review and save the house brief before accepting the concept.');return;}
    setBusy('save');setError('');try { if(projectId){requestKey.current ||= spatialUUID(); const result=await api(`/api/projects/${projectId}/spatial`,{method:'POST',headers:{'idempotency-key':requestKey.current},body:{...base(),model:study.model,acceptedImpact:true}});applyRemote(result);requestKey.current=null;}else{setModel(study.model);setAccepted(study.model);setDirty(false);setStudy(null);setHistory(current=>[{revision:study.model.revision,createdAt:new Date().toISOString()},...current]);}setMessage('Concept revision accepted. Rebuild the tour to use the updated layout.');}catch(e){setError(e.message);}finally{setBusy('');}
  }
  async function saveTour() {
    if(!projectId){setMessage('Demo tour is held in this open tab. Export the scene to keep a copy.');return;}
    if(tourConflict){setError('Review the latest tour revision before saving this draft.');return;}
    const serialized=JSON.stringify({...base(),expectedTourRevision:remote?.tourRevision||0,tour});
    setBusy('tour-save');setError('');setMessage('');try {
      if(tourRequest.current?.body!==serialized)tourRequest.current={body:serialized,key:spatialUUID()};
      const request=tourRequest.current;
      const result=await api(`/api/projects/${projectId}/spatial/tour`,{method:'POST',headers:{'idempotency-key':request.key},body:JSON.parse(request.body)});tourRequest.current=null;applyRemote(result);setMessage('A separate camera-tour revision has been saved.');}catch(e){if(e.status===409)setTourConflict({draft:tour,baseRevision:remote?.tourRevision||0});setError(e.message);}finally{setBusy('');}
  }
  const compatibleSource=latest=>latest.project.inputRevision===remote.project.inputRevision&&latest.briefRevision===remote.briefRevision&&latest.spatialRevision===remote.spatialRevision&&latest.model?.id===accepted.id&&latest.model?.revision===accepted.revision&&latest.project.status!=='archived'&&!latest.stale;
  async function reviewTourConflict(){
    if(!tourConflict)return;
    setBusy('tour-review');setError('');setMessage('');
    try{const latest=await api(`/api/projects/${encodeURIComponent(projectId)}/spatial`);setTourConflict(current=>({...current,latest,projectChanged:!compatibleSource(latest)}));}
    catch(e){setError(e.message);}finally{setBusy('');}
  }
  function resolveTourConflict(useSaved){
    if(!tourConflict?.latest||tourConflict.projectChanged)return;
    if(!compatibleSource(tourConflict.latest)){setTourConflict(current=>({...current,latest:null}));setError('The local concept changed during this tour review. Review the latest tour again.');return;}
    const next=useSaved?tourConflict.latest.tour:tourConflict.draft;
    if(!next)return;
    const latest=tourConflict.latest;
    setTour(next);setCleanTour(latest.tour);setStops(next.roomIds);setDuration(next.duration);setShotPreferences(next.shotPreferences||[]);setEyeHeight(next.eyeHeight||1650);setTime(0);setPlaying(false);
    setRemote(current=>({...current,tourRevision:latest.tourRevision||0,tour:latest.tour,tourStale:isTourStale(accepted,next)}));
    tourRequest.current=null;setTourConflict(null);setError('');
    setMessage(useSaved?'The latest saved tour is now open. Your other drafts are unchanged.':'Your tour draft is ready. Save tour revision to append it after the reviewed revision.');
  }
  async function interpret(useAi) {
    setError('');setBusy('intent');try { const intent=parseTourIntent(instruction,model); const normalized={roomIds:intent.roomIds,duration:intent.duration||duration,shotPreferences:intent.shotPreferences||[],eyeHeight:intent.eyeHeight||eyeHeight};if(useAi){if(!projectId||!remote?.spatialRevision)throw new Error('Open a saved project and save its spatial concept to use AI direction. Local instruction parsing is available in this demo.');const result=await api(`/api/projects/${projectId}/spatial/tour-intent`,{method:'POST',timeoutMs:45000,body:{...base(),acceptedAiTerms:consent,aiProviders:aiProviders(allowGemini),intent:normalized}});regenerate(result.intent.roomIds,result.intent.duration,result.source,result.intent.shotPreferences||[],result.intent.eyeHeight||eyeHeight);}else{const next=regenerate(normalized.roomIds,normalized.duration,'local-rules',normalized.shotPreferences,normalized.eyeHeight);if(next)setMessage('Camera direction matched locally to rooms, subjects and pacing. No AI request was made. '+(intent.warnings||[]).join(' '));}}catch(e){setError(e.message);}finally{setBusy('');}
  }
  function moveStop(index,delta) {const next=[...stops];[next[index],next[index+delta]]=[next[index+delta],next[index]];setStops(next);}
  function removeStop(index) {
    const next=stops.filter((_,i)=>i!==index);setStops(next);
    setShotPreferences(current=>current.filter(preference=>next.includes(preference.roomId)));
  }
  async function persistViews(next=views){
    if(!projectId){setViews(next);setViewsDirty(false);setMessage('Demo viewpoints are included in scene export. Open a private project to save them across devices.');return;}
    if(cameraConflict){setError('Review the latest camera library before saving this draft.');return;}
    if(dirty||!remote?.spatialRevision||remote.stale){setError('Accept the current concept before saving viewpoints.');return;}
    const body={...base(),expectedCameraRevision:remote.cameraRevision||0,viewpoints:next},serialized=JSON.stringify(body);
    setBusy('camera-save');setError('');setMessage('');
    try{
      if(cameraRequest.current?.body!==serialized)cameraRequest.current={body:serialized,key:spatialUUID()};
      const data=await api(`/api/projects/${projectId}/spatial/viewpoints`,{method:'POST',headers:{'idempotency-key':cameraRequest.current.key},body});setViews(data.viewpoints);setViewsDirty(false);viewsDirtyRef.current=false;setRemote(current=>({...current,cameraRevision:data.cameraRevision,viewpoints:data.viewpoints}));cameraRequest.current=null;setMessage('Camera library saved privately. It is available when you reopen this project on another device.');}catch(e){setViews(next);setViewsDirty(true);viewsDirtyRef.current=true;if(e.status===409)setCameraConflict({draft:next,base:remote.viewpoints||[],baseRevision:remote.cameraRevision||0,choices:{}});setError(e.message);}finally{setBusy('');}
  }
  async function reviewCameraConflict(){
    if(!cameraConflict)return;
    setBusy('camera-review');setError('');
    try{
      const latest=await api(`/api/projects/${encodeURIComponent(projectId)}/spatial`);
      const projectChanged=!compatibleSource(latest);
      setCameraConflict(current=>({...current,latest,projectChanged,entries:projectChanged?[]:reviewCameraMerge(current.base,current.draft,latest.viewpoints||[]),choices:{}}));
    }catch(e){setError(e.message);}finally{setBusy('');}
  }
  function applyCameraReview(){
    if(!cameraConflict?.latest||cameraConflict.projectChanged)return;
    if(!compatibleSource(cameraConflict.latest)){setError('The local concept changed during this camera review. Review the latest library again.');setCameraConflict(current=>({...current,latest:null}));return;}
    try{
      const next=resolveCameraMerge(cameraConflict.entries,cameraConflict.choices),latest=cameraConflict.latest;
      setViews(next);setViewsDirty(true);viewsDirtyRef.current=true;cameraRequest.current=null;
      setRemote(current=>({...current,cameraRevision:latest.cameraRevision||0,viewpoints:latest.viewpoints||[]}));
      setCameraConflict(null);setError('');setMessage('Reviewed cameras are ready. Save camera library to commit this merged draft.');
    }catch(e){setError(e.message);}
  }
  function saveView(){
    if(views.length>=40){setError('The camera library supports up to 40 viewpoints. Remove one before adding another.');return;}
    const view=viewer.current?.getView();if(!view){setError('Let the 3D scene finish loading before saving a viewpoint.');return;}
    try {
      const next=[...views,{id:spatialUUID(),name:`View ${views.length+1}`,buildingId:model.id,sourceRevision:model.revision,floorId:activeFloor.id,position:view.position,target:view.target,fov:view.fov}];
      void persistViews(next);
    } catch(e) { setError(e.message); }
  }
  function changeViews(next){setViews(next);setViewsDirty(true);viewsDirtyRef.current=true;cameraRequest.current=null;}

  function openScene(scene) {
    if(projectId||unresolvedComponentForms())return;
    const next=scene.model,extent=bounds(next),brief=scene.houseBrief||defaultHouseBrief();
    setModel(next);setAccepted(next);setTour(scene.tour);setCleanTour(scene.tour);setStops(scene.tour.roomIds);setDuration(scene.tour.duration);setEyeHeight(scene.tour.eyeHeight||1650);setShotPreferences(scene.tour.shotPreferences||[]);
    setViews(scene.viewpoints);setViewsDirty(false);viewsDirtyRef.current=false;setHouseBrief(brief);setSavedBrief(brief);setBriefStudy(null);
    setActiveFloorId(next.floors[0].id);setSelected(next.rooms.find(r=>r.floorId===next.floors[0].id)?.id||next.rooms[0].id);setWidth((extent.x1-extent.x0)/1000);setDepth((extent.y1-extent.y0)/1000);
    setDirty(false);setStudy(null);setPlaying(false);setTime(0);setMode('overview');setTab('plan');setSectionEnabled(false);setImporting(false);setError('');setHovered(null);
    setHistory([{revision:next.revision,createdAt:new Date().toISOString()}]);requestAnimationFrame(()=>document.getElementById('sp-plan-heading')?.focus());setMessage('Saved study opened locally. Its geometry, tour and current cameras are restored.');
  }

  const currentViewpoints = views.filter(view => view.buildingId === model.id && view.sourceRevision === model.revision);
  const olderViewpointCount = views.length - currentViewpoints.length;
  const exportScene = () => download(new Blob([JSON.stringify({model,tour,viewpoints:currentViewpoints,houseBrief},null,2)],{type:'application/json'}),'grihagrid-scene.json');
  const exportCameraLibrary = () => download(new Blob([JSON.stringify({kind:'grihagrid-camera-library',viewpoints:views},null,2)],{type:'application/json'}),'grihagrid-camera-library.json');
  async function exportGLB() {setBusy('glb');try{const blob=await viewer.current?.exportGLB(currentViewpoints);if(!blob)throw new Error('Open 3D Explore and let the scene load first.');download(blob,'grihagrid-house.glb');setMessage(`The complete scene was exported with room identifiers and ${currentViewpoints.length} saved camera${currentViewpoints.length===1?'':'s'}.`);}catch(e){setError(e.message);}finally{setBusy('');}}

  if(loading)return <main className="sp-empty"><h1>Opening your spatial studio…</h1></main>;
  if(projectId&&!remote)return <main className="sp-empty"><h1>The project could not be opened.</h1><p role="alert">{error}</p><button onClick={load}>Retry</button><button onClick={()=>onNavigate('/dashboard')}>My houses</button></main>;

  return <main className="sp-studio">
    <header className="sp-topbar"><button className="sp-brand" onClick={()=>{if(projectId)leaveStudio('/');else {setTab('explore');setMode('overview')}}} aria-label="GrihaGrid studio"><House size={23}/><span>GrihaGrid</span></button><div className="sp-breadcrumb">{projectId?'Private house':'Example house'}<span>/</span>Spatial studio</div><nav className="sp-primary-nav" aria-label="Studio navigation"><button onClick={()=>leaveStudio('/dashboard')}>My houses</button>{projectId&&<button onClick={leaveStudio}>Project details</button>}<button className="sp-new-house" onClick={()=>leaveStudio('/houses/new')}><Plus/> New house</button><button className="sp-guide-link" onClick={()=>leaveStudio('/about')}>Studio guide</button></nav></header>
    {logoutConfirmed&&<p className="logout-confirmation" role="status"><Check/> You’re logged out. Private workspace data was cleared from this tab.</p>}
    <section className="sp-heading"><div><div className="sp-eyebrow"><span className="sp-dot"/> {projectId?'Project concept':'Interactive demonstration'} <span className="sp-heading-divider">/</span> {briefOnly?`${houseBrief.floors} floor${houseBrief.floors===1?'':'s'} requested`:model.floors.length===1?'Single storey':`${model.floors.length} floors`}</div><h1>{projectId?remote.project.name:model.id===initial.id?'The Courtyard House':model.name}<span>.</span></h1><p>Edit the plan. Explore every room. Direct the camera tour.</p></div><div className="sp-heading-meta"><span>{briefOnly?'WORKING BRIEF':`CONCEPT ${String(model.revision).padStart(2,'0')}`}</span>{briefOnly?<><strong>{houseBrief.rooms.length} <small>rooms requested</small></strong><small>No geometry saved</small></>:<><strong>{model.rooms.reduce((a,r)=>a+area(r),0).toFixed(0)} <small>m²</small></strong><small>{model.rooms.length} spaces · {projectId&&remote.spatialRevision&&!dirty?'Saved concept':model.id===initial.id?'Sample geometry':dirty?'Unaccepted geometry':'Reviewed geometry'}</small></>}</div></section>
    {projectId&&!remote.model&&!dirty&&<p className="sp-first-model-note">Your brief is saved. Open House brief to create a sized layout study, or import a drawing in 2D Plan. The example below is not your proposed house.</p>}
    <div className="sp-tabbar"><nav aria-label="Spatial workspace views">{tabs.map(([id,label,Icon])=><button key={id} aria-current={tab===id?'page':undefined} className={tab===id?'is-active':''} onClick={()=>{setTab(id);if(id!=='tour')setPlaying(false);}}><Icon/>{label}</button>)}</nav><span className="sp-tab-note">{dirty?'Unaccepted layout study':archived?'Archived · read only':projectId&&remote.stale?'Brief changed · review required':`Concept planning · ${activeFloor.name}`}</span></div>
    {componentPending&&<div className="sp-mode-notice" role="status"><div><strong>Unapplied component forms</strong><p>Your entries stay in this tab. Apply or discard them in Structure &amp; services before accepting or replacing the layout. Drawings, 3D and exports show applied geometry.</p></div><button type="button" className="sp-secondary" onClick={reviewComponentForms}>Review component forms</button></div>}
    <div className={tab==='brief'?'sp-workspace sp-workspace--brief':'sp-workspace'}>
      {tab==='brief'&&<section className="sp-brief-page">{remote?.briefStale&&<p className="sp-notice">Project planning details changed after this house brief was saved. Reconcile the site dimensions and requirements, then review and save the brief again.</p>}<HouseBrief value={houseBrief} onChange={next=>{setHouseBrief(next);setBriefStudy(null);}} model={briefOnly?null:model} initialStep={model.id==='brief-house'?'review':'site'} onGenerate={generateFromBrief} onSave={projectId?previewHouseBrief:undefined} saved={!briefDirty&&Boolean(remote?.houseBrief)&&!remote?.briefStale} isPrivate={Boolean(projectId)} disabled={archived||Boolean(busy)||Boolean(briefStudy)} onSelectRoom={id=>{setTab('plan');selectRoom(id);}}/>
      {briefStudy&&<section className="hb-save-study" aria-label="House brief Change Study"><span className="sp-eyebrow">CHANGE STUDY</span><h2 id="hb-study-heading" tabIndex={-1}>Save these house requirements?</h2><p>{briefStudy.preview.changeStudy?.summary}</p><p>Saved geometry is preserved and marked for review against this brief. The earlier planning estimate and reports retain their own inputs; use Project details to revise those separately.</p>{briefStudy.conflict?<button type="button" className="sp-secondary" onClick={()=>{if(window.confirm('Reload the saved project? Download this brief first to retain your draft. Unsaved layout and camera edits will be replaced.'))load();}}>Reload saved project</button>:<button type="button" className="sp-primary" disabled={Boolean(busy)} onClick={saveHouseBrief}>{briefStudy.attempted?'Retry exact brief save':'Accept & save brief revision'}</button>}{!briefStudy.attempted&&<button type="button" className="sp-text-button" onClick={()=>setBriefStudy(null)}>Keep editing</button>}</section>}</section>}<>

      <aside className="sp-sidebar" hidden={tab==='brief'}><div className="sp-floor-controls"><label>Floor<select aria-label="Active floor" value={activeFloor.id} onChange={e=>selectFloor(e.target.value)}>{model.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label><input type="checkbox" disabled={sectionEnabled&&tab==='explore'&&mode==='overview'} checked={isolateFloor} onChange={e=>setIsolateFloor(e.target.checked)}/> Isolate this floor</label></div><div className="sp-sidebar-title"><span>THE SPACES</span><span>{String(model.rooms.length).padStart(2,'0')}</span></div><div className="sp-room-list">{visibleRooms.map((r,i)=><button key={r.id} className={selected===r.id?'is-selected':''} aria-pressed={selected===r.id} onClick={()=>selectRoom(r.id)}><span className="sp-room-number">{String(i+1).padStart(2,'0')}</span><span><strong>{r.name}</strong><small>{area(r).toFixed(1)} m²</small></span><ArrowRight/></button>)}</div><div className="sp-mini-plan"><span>{activeFloor.name.toUpperCase()}</span><Plan floorId={activeFloor.id} model={model} selectedRoomId={selected} onSelect={selectRoom} compact/><div className="sp-north"><Compass/> N <span>{houseBrief.northDegrees===null?'North unconfirmed':`${houseBrief.northDegrees}° clockwise from +Y`}</span></div></div><div className="sp-sidebar-note"><span className="sp-dot"/> Every view uses the same spatial model.</div></aside>
      <section className="sp-main" hidden={tab==='brief'}>
        {tab!=='plan'&&tourBlockTitle&&<div className="sp-mode-notice" role="status"><div><strong>{tourBlockTitle}</strong><p>{tourBlockHint}</p></div>{needsAcceptance?<button className="sp-secondary" onClick={reviewStudy} disabled={archived||Boolean(busy)}>Review layout before touring</button>:<button className="sp-secondary" onClick={()=>{setTab('tour');regenerate();}} disabled={archived||Boolean(busy)||Boolean(tourConflict)}>Rebuild and review tour</button>}</div>}
        {tab!=='plan'&&error&&<p className="sp-notice" role="alert">{error}</p>}

        <div className="sp-plan-page" hidden={tab!=='plan'}><div className="sp-panel-heading"><div><span className="sp-eyebrow">01 / THE PLAN</span><h2 id="sp-plan-heading" tabIndex={-1}>Everything in its place.</h2></div><span>Measured geometry</span></div><div className="sp-plan-actions">{!projectId&&<SceneFileImport onOpen={openScene} disabled={Boolean(busy)||componentPending}/>}<button className="sp-secondary" disabled={archived||Boolean(busy)} onClick={()=>setImporting(true)}><Plus/> Import a drawing or floor plan</button><span className="sp-muted">PNG, JPEG, SVG or PDF · recognition stays on this device</span>{!dirty&&model.id===initial.id&&!remote?.model&&<button className="sp-text-button" disabled={archived||Boolean(busy)||importing||componentPending} onClick={()=>editModel(createMultiFloorDemo())}>Study a two-floor example <ArrowRight/></button>}</div>{importing&&<DrawingImport model={model} blockedReason={componentPending?'Apply or discard pending Structure & services forms before creating a model from this drawing.':null} onChange={next=>{if(componentPending)throw new Error('Resolve pending component forms before replacing the layout.');editModel(next);setImporting(false);}} onStatus={setMessage} onCancel={()=>setImporting(false)}/>}<div hidden={importing}><DrawingStudio componentReview={componentReview} onChange={editModel} onStatus={setMessage} onPendingChange={setComponentPending} onExplore={()=>{setTab('explore');setCameraMode('overview');}} resetKey={`${accepted.id}:${accepted.revision}:${history[0]?.createdAt}`} disabled={archived||Boolean(busy)} model={model} floorId={activeFloor.id} northDegrees={houseBrief.northDegrees} section={section} onSectionChange={setSection} onExploreSection={()=>{setSectionEnabled(true);setIsolateFloor(false);setCameraMode('overview');setTab('explore');}}><LayoutEditor key={`${accepted.id}:${accepted.revision}:${history[0]?.createdAt}`} model={model} onChange={archived?()=>{}:editModel} onStatus={setMessage} selectedRoomId={selected} onSelectRoom={selectRoom} activeFloorId={activeFloor.id} onActiveFloorChange={selectFloor} disabled={archived||Boolean(busy)}/></DrawingStudio></div><details className="sp-global-dimensions"><summary>Scale overall dimensions</summary><div className="sp-dimensions"><label>Overall width <span><input aria-label="Overall width in metres" type="number" step=".25" min={model.schemaVersion===2?2:11} max={model.schemaVersion===2?40:18} value={width} onChange={e=>setWidth(e.target.value)} disabled={archived||Boolean(busy)}/> m</span></label><label>{model.schemaVersion===2?'Overall depth':'Interior depth'} <span><input aria-label="Interior depth in metres" type="number" step=".25" min={model.schemaVersion===2?2:9.5} max={model.schemaVersion===2?40:15} value={depth} onChange={e=>setDepth(e.target.value)} disabled={archived||Boolean(busy)}/> m</span></label><button className="sp-primary" onClick={previewDimensions} disabled={archived||Boolean(busy)}>Preview dimensions <ArrowRight/></button></div><p className="sp-muted">Walls, room boundaries and furniture positions move together. Door sizes follow the plan; furniture keeps its original dimensions.</p></details></div>{tab==='explore'&&mode==='overview'&&<div className="sp-section-toolbar"><button type="button" className="sp-secondary" aria-pressed={sectionEnabled} onClick={()=>{setSectionEnabled(v=>!v);setIsolateFloor(false);}}>{sectionEnabled?'Close building section':'Cut a building section'}</button>{sectionEnabled&&<><SectionControls model={model} value={section} onChange={setSection}/><p className="sp-muted">All storeys at their actual levels. The matching section is under 2D Plan → Building section. Close the section to save a camera viewpoint.</p></>}</div>}{!['plan','brief'].includes(tab)&&<div className="sp-viewport" data-camera-mode={mode}>
          <SceneBoundary onError={handleError}><Suspense fallback={<div className="sp-empty"><Compass className="sp-loading"/><p>Assembling the house…</p></div>}><WorldCanvas ref={viewer} model={model} mode={mode} section={sectionEnabled&&tab==='explore'&&mode==='overview'?section:null} activeFloorId={activeFloor.id} isolateFloor={isolateFloor} eyeHeight={eyeHeight} onFloorChange={setActiveFloorId} selectedRoomId={selected} onRoomHover={setHovered} onRoomSelect={selectRoom} tour={tour} tourPlaying={playing} tourTime={time} playbackRate={speed} onTourTime={setTime} onTourPause={pause} quality={quality} reducedMotion={reduced} onError={handleError} onMetrics={setMetrics} onModeChange={setMode}/></Suspense></SceneBoundary>
          {!visibleRooms.length&&mode==='overview'&&<div className="sp-empty-floor"><h2>{activeFloor.name} has no rooms yet.</h2><p>Add a layout or room before entering this floor.</p><button className="sp-primary" onClick={()=>setTab('plan')}>Plan this floor <ArrowRight/></button></div>}
          <div className="sp-view-label"><span className="sp-dot"/>{mode==='overview'?(sectionEnabled&&tab==='explore'?'Building section · all storeys':'Dollhouse overview'):mode==='walk'?'Walking at eye level':mode==='tour'?`Tour · ${currentTourRoom?.name||'Exterior overview'}`:room?.name||'Room viewpoint'}</div>
          <div className="sp-view-tools"><button title="Reset overview" aria-label="Reset overview" onClick={()=>setCameraMode('overview')}><ArrowsOut/></button><button title={sectionEnabled&&tab==='explore'&&mode==='overview'?'Close the building section to save a camera viewpoint':'Save viewpoint'} aria-label="Save viewpoint" disabled={(sectionEnabled&&tab==='explore'&&mode==='overview')||Boolean(busy)||Boolean(cameraConflict)||archived||dirty||Boolean(projectId&&(!remote?.spatialRevision||remote.stale))} onClick={saveView}><Camera/></button></div>
          {hoverRoom&&mode==='overview'&&<div className="sp-hover-label">{hoverRoom.name}<span>{area(hoverRoom).toFixed(1)} m² · select to enter</span></div>}
          <div className="sp-camera-switch" aria-label="Camera mode"><button className={mode==='overview'?'is-active':''} aria-pressed={mode==='overview'} onClick={()=>setCameraMode('overview')}><Buildings/>Overview</button><button className={mode==='walk'?'is-active':''} aria-pressed={mode==='walk'} onClick={()=>setCameraMode('walk')} disabled={!visibleRooms.length||Boolean(renderError)}><Eye/>Walk inside</button><button className={mode==='tour'?'is-active':''} aria-pressed={mode==='tour'} onClick={playTour} disabled={stale||pendingItinerary||Boolean(renderError)}><Play/>Guided tour</button></div>
          <div className="sp-view-caption">{mode==='walk'?'W A S D to move · drag to look · use the touch pad on mobile':'Drag to orbit · scroll to zoom · select a room to enter'}</div>
        </div>}
        {tab!=='plan'&&<div className="sp-transport"><button className="sp-play" aria-label={playing?'Pause tour':time>0&&time<tour.duration?'Resume tour':'Play tour'} onClick={playTour} disabled={stale||pendingItinerary||Boolean(renderError)}>{playing?<Pause weight="fill"/>:<Play weight="fill"/>}</button><div className="sp-transport-label"><span>{tourBlockTitle|| (mode==='tour'?currentTourRoom?.name||'Exterior overview':'A walk through the house')}</span><small>{tourBlockHint||(playing?'Playing · take control to pause':time>0&&time<tour.duration?'Paused · resume from here':'Guided tour · ready when you are')}</small></div><input aria-label="Tour progress" disabled={stale||pendingItinerary} type="range" min="0" max={tour?.duration||30} step=".1" value={Math.min(time,tour?.duration||30)} onChange={e=>{setPlaying(false);setMode('tour');setTime(Number(e.target.value));}}/><span className="sp-time">{seconds(time)} / {seconds(tour?.duration)}</span><select aria-label="Tour playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option></select><button aria-label="Restart tour" disabled={stale||pendingItinerary} onClick={()=>{setTime(0);setMode('tour');setPlaying(false);}}><ArrowClockwise/></button></div>}
        {renderError&&<p className="sp-notice" role="alert">{renderError} <button onClick={()=>setTab('plan')}>Open 2D Plan</button></p>}
        {tab==='tour'&&<section className="sp-tour-editor"><div className="sp-panel-heading"><div><span className="sp-eyebrow">02 / CAMERA DIRECTION</span><h2>Choose the journey.</h2></div><button onClick={()=>regenerate()} className="sp-primary" disabled={needsAcceptance||archived||Boolean(busy)||Boolean(tourConflict)}><ArrowClockwise/> Rebuild tour</button></div><div className="sp-tour-coverage"><span>Direction: {tour.source==='cloudflare'?'Cloudflare Workers AI':tour.source==='gemini'?'Google Gemini':'Local planning'}</span><span>Tour visits {tourFloorCount} of {populatedFloors.length} populated floors · up to 12 stops</span>{populatedFloors.length>1&&<button className="sp-text-button" disabled={archived||Boolean(busy)||Boolean(tourConflict)} onClick={()=>{setStops(defaultTourRoomIds(model));setShotPreferences([]);setPlaying(false);}}>Use whole-house route</button>}</div><div className="sp-tour-columns"><div><div className="sp-tour-stops">{stops.map((id,i)=><div key={`${id}-${i}`}><span>{String(i+1).padStart(2,'0')}</span><strong>{roomLabel(model,id)}</strong><button disabled={i===0||archived||Boolean(busy)||Boolean(tourConflict)} aria-label={`Move stop ${i+1} up`} onClick={()=>moveStop(i,-1)}>↑</button><button disabled={i===stops.length-1||archived||Boolean(busy)||Boolean(tourConflict)} aria-label={`Move stop ${i+1} down`} onClick={()=>moveStop(i,1)}>↓</button><button disabled={stops.length<2||archived||Boolean(busy)||Boolean(tourConflict)} aria-label={`Remove stop ${i+1}`} onClick={()=>removeStop(i)}><X/></button></div>)}</div><div className="sp-tour-options"><select aria-label="Add a tour stop" value="" disabled={archived||Boolean(busy)||Boolean(tourConflict)} onChange={e=>setStops(v=>[...v,e.target.value])}><option value="" disabled>Add a room…</option>{model.rooms.map(r=><option key={r.id} value={r.id}>{roomLabel(model,r.id)}</option>)}</select><label>Duration <input aria-label="Tour duration in seconds" disabled={archived||Boolean(busy)||Boolean(tourConflict)} type="number" min="10" max="180" value={duration} onChange={e=>setDuration(Number(e.target.value))}/> sec</label></div><label className="sp-eye-height">Walking eye height <input aria-label="Walking eye height in centimetres" disabled={archived||Boolean(busy)||Boolean(tourConflict)} type="number" min="150" max="180" value={eyeHeight/10} onChange={e=>setEyeHeight(Number(e.target.value)*10)}/> cm</label>{shotPreferences.length>0&&<p className="sp-muted">{shotPreferences.map((s,i)=>`${i+1}. ${s.pace} ${s.kind} · ${model.furniture.find(f=>f.id===s.subjectId)?.name||model.rooms.find(r=>r.id===s.roomId)?.name}`).join(" / ")}</p>}<details className="sp-shot-editor"><summary>Shot timing and preview ({tour.shots.length})</summary>{tour.shots.map(shot=><div key={shot.id}><button disabled={stale||pendingItinerary} onClick={()=>{setMode('tour');setTime(shot.startTime);setPlaying(false);}}>{shot.kind} · {shot.roomId?roomLabel(model,shot.roomId):'Exterior'}{shotStates.find(s=>s.id===shot.id)?.stale?' · needs review':''}</button><label><input aria-label={`Duration for ${shot.id}`} type="number" min=".5" max="60" step=".5" value={Math.round(shot.duration*100)/100} disabled={archived||Boolean(busy)||Boolean(tourConflict)} onChange={e=>{try{const updated=retimeTour(tour,shot.id,Number(e.target.value));setTour(updated);setDuration(updated.duration);setPlaying(false);}catch(err){setError(err.message);}}}/> sec</label></div>)}</details><button className="sp-text-button" onClick={saveTour} disabled={archived||stale||pendingItinerary||Boolean(busy)||Boolean(tourConflict)}><FloppyDisk/> Save tour revision</button></div><div className="sp-direction"><label htmlFor="camera-direction">Describe your camera tour</label><textarea id="camera-direction" rows="3" maxLength="1200" value={instruction} onChange={e=>setInstruction(e.target.value)} disabled={archived||Boolean(busy)||Boolean(tourConflict)}/><button className="sp-secondary" onClick={()=>interpret(false)} disabled={needsAcceptance||Boolean(busy)||archived||Boolean(tourConflict)}>Match room names locally <ArrowRight/></button><p>Try “Slowly reveal the kitchen island, orbit the dining table, then linger in the main bedroom for a 40 second tour.” Choose one directed subject per room. Room names, objects, pacing and timing are interpreted locally; your original text stays here.</p><AiConsent checked={consent} onChange={setConsent} allowGemini={allowGemini} onGeminiChange={setAllowGemini} disabled={archived||Boolean(busy)||Boolean(tourConflict)} camera/><button className="sp-text-button" onClick={()=>interpret(true)} disabled={needsAcceptance||!consent||Boolean(busy)||archived||Boolean(tourConflict)}><Sparkle/> {busy==='intent'?'Preparing direction…':'Use AI direction'}</button></div></div></section>}
        {tab==='export'&&<section className="sp-export"><span className="sp-eyebrow">03 / TAKE THE CONCEPT WITH YOU</span><h2>From an experience to a film.</h2>{views.length>0&&<p className="sp-muted">Scene, GLB and render exports include {currentViewpoints.length} saved camera{currentViewpoints.length===1?'':'s'} for this concept.{olderViewpointCount>0&&<> {olderViewpointCount} older viewpoint{olderViewpointCount===1?' remains':'s remain'} in your library. Download the camera library below to keep every saved pose.</>}</p>}<div className="sp-export-grid"><article><Blueprint/><h3>Editable scene</h3><p>{tourBlockHint||'The shared building model, camera sequence and saved viewpoints.'}</p><button className="sp-secondary" onClick={exportScene} disabled={stale||pendingItinerary}><DownloadSimple/> Download scene JSON</button></article><article><Buildings/><h3>3D model</h3><p>The complete house in GLB, including room and object identifiers.</p><button className="sp-secondary" onClick={exportGLB} disabled={Boolean(busy)}><DownloadSimple/> {busy==='glb'?'Exporting…':'Download GLB'}</button></article><article><RenderPanel model={model} tour={tour} viewpoints={currentViewpoints} disabled={stale||pendingItinerary||dirty||archived}/></article></div></section>}
        {tab==='explore'&&<div className="sp-space-details"><div><span className="sp-eyebrow">{room?`SPACE ${String(model.rooms.indexOf(room)+1).padStart(2,'0')}`:'THE HOUSE'}</span><h2>{room?.name||'Make yourself at home.'}</h2></div><p>{room?'Select a space to step inside, or follow the guided tour to see how the rooms connect.':'Explore the furnished rooms, then shape the plan around your ideas.'}</p><button className="sp-secondary" disabled={archived||Boolean(busy)} onClick={()=>{setTab('tour');regenerate();}}>Direct a camera tour <ArrowRight/></button></div>}
      </section>
      </>
    </div>
    <footer className="sp-statusbar"><span><span className="sp-dot"/>{dirty?'Layout study · not yet accepted':projectId?`Spatial revision ${remote?.spatialRevision||0}`:'Demonstration · changes stay in this tab'}</span><div><label>Detail <select aria-label="Rendering quality" value={quality} onChange={e=>setQuality(e.target.value)}><option value="low">Light</option><option value="balanced">Balanced</option><option value="high">High</option></select></label>{metrics&&<span>{metrics.renderMode==='demand'?'On demand':`${Math.round(metrics.fps||0)} fps`}</span>}<button onClick={()=>setReduced(v=>!v)} aria-pressed={reduced}>Reduced motion {reduced?'on':'off'}</button></div></footer>
    {(dirty||projectId&&remote?.stale)&&!archived&&<div className="sp-study-bar"><span><strong>{dirty?'A new layout study.':remote?.stale?'Review this concept against the updated brief.':'Begin your spatial concept.'}</strong> Review its impact before accepting a saved revision.</span><button className="sp-primary" onClick={reviewStudy} disabled={Boolean(busy)}>Review Change Study <ArrowRight/></button>{dirty&&<button className="sp-text-button" disabled={Boolean(busy)} onClick={discardStudy}>Discard study</button>}</div>}
    {study&&<section className="sp-study" aria-label="Spatial Change Study"><div><span className="sp-eyebrow">CHANGE STUDY</span><h2 id="sp-study-heading" tabIndex={-1}>Review this concept revision.</h2><p>{study.changeStudy.summary}</p><p>The planning estimate and purchased reports remain tied to their original brief. This spatial concept does not establish construction feasibility.</p></div><button className="sp-primary" onClick={acceptStudy} disabled={Boolean(busy)}><Check/> Accept concept revision</button><button className="sp-text-button" onClick={()=>setStudy(null)}>Cancel</button></section>}
    {views.length>0&&<section className="sp-saved-views" aria-label="Saved camera library"><div><span className="sp-eyebrow">SAVED VIEWPOINTS</span><p className="sp-muted">{projectId?`Private camera library · revision ${remote.cameraRevision||0}`:'Demo viewpoints · download the library to keep every pose'}</p><button type="button" className="sp-secondary" onClick={exportCameraLibrary}><DownloadSimple/> Download camera library</button></div>{views.map(v=>{const outdated=v.sourceRevision!==model.revision||v.buildingId!==model.id;return <div className="sp-camera-entry" key={v.id}><input aria-label={`Name for viewpoint ${v.id}`} maxLength={80} value={v.name} disabled={archived||Boolean(busy)||Boolean(cameraConflict)} onChange={e=>changeViews(views.map(item=>item.id===v.id?{...item,name:e.target.value}:item))}/><button disabled={outdated||['plan','brief'].includes(tab)} aria-label={`Go to ${v.name}`} onClick={()=>{setPlaying(false);if(v.floorId)setActiveFloorId(v.floorId);setMode('room');viewer.current?.setView(v);}}><Camera/>{outdated?'Older concept':'Go to view'}</button><button aria-label={`Delete ${v.name}`} disabled={archived||Boolean(busy)||Boolean(cameraConflict)} onClick={()=>changeViews(views.filter(item=>item.id!==v.id))}><Trash/></button></div>})}{viewsDirty&&<button className="sp-primary" onClick={()=>persistViews()} disabled={archived||Boolean(busy)||Boolean(cameraConflict)||Boolean(projectId&&(dirty||remote.stale))}><FloppyDisk/> Save camera library</button>}</section>}
    {viewsDirty&&!views.length&&<div className="sp-saved-views"><p>All viewpoints removed from this draft.</p><button className="sp-primary" onClick={()=>persistViews()} disabled={archived||Boolean(busy)||Boolean(cameraConflict)||Boolean(projectId&&(dirty||remote.stale))}>Save camera library</button></div>}
    {cameraConflict&&<CameraLibraryReview review={cameraConflict} busy={Boolean(busy)} onFetch={reviewCameraConflict} onChoose={(id,choice)=>setCameraConflict(current=>({...current,choices:{...current.choices,[id]:choice}}))} onApply={applyCameraReview} onDownload={()=>download(new Blob([JSON.stringify({kind:'grihagrid-camera-draft',projectId,baseCameraRevision:cameraConflict.baseRevision,viewpoints:cameraConflict.draft},null,2)],{type:'application/json'}),'grihagrid-camera-draft.json')} onLoadProject={load} onCancel={()=>{setCameraConflict(null);setError('');setMessage('Your camera draft is unchanged. Saving again will check for newer revisions.');}}/>}
    {tourConflict&&<TourRevisionReview review={tourConflict} model={model} busy={Boolean(busy)} onFetch={reviewTourConflict} onUseDraft={()=>resolveTourConflict(false)} onUseSaved={()=>resolveTourConflict(true)} onDownload={()=>download(new Blob([JSON.stringify({kind:'grihagrid-tour-draft',projectId,baseTourRevision:tourConflict.baseRevision,tour:tourConflict.draft},null,2)],{type:'application/json'}),'grihagrid-tour-draft.json')} onLoadProject={load} onCancel={()=>{setTourConflict(null);setError('');setMessage('Your tour draft is unchanged. Saving again will check for newer revisions.');}}/>}
    <div className="sp-messages" aria-live="polite">{message&&<p><Check/>{message}<button aria-label="Dismiss message" onClick={()=>setMessage('')}><X/></button></p>}{error&&<p className="is-error" role="alert"><WarningCircle/>{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X/></button></p>}</div>
    <div className="sp-footnote"><span>GrihaGrid / Spatial studio</span><p>Concept visualization. Site conditions, structure and statutory requirements need professional review.</p><details><summary>Revision record ({history.length})</summary>{history.map(item=><p key={item.revision}>Concept {item.revision} · {new Date(item.createdAt).toLocaleString()}</p>)}</details></div>
  </main>;
}
