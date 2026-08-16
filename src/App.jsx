import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise, ArrowLeft, ArrowRight, ArrowSquareOut, ArrowsLeftRight, Blueprint, Buildings,
  Check, CheckCircle, Compass, Copy, CurrencyInr, DownloadSimple, Eye, FileText, FloppyDisk,
  House, LinkSimple, List, LockKey, MapPin, PencilSimple, Plus, Receipt, Ruler, SealCheck,
  ShareNetwork, ShieldCheck, SignOut, Sparkle, Stack, Trash, UploadSimple, UserCircle,
  WarningCircle, X, XCircle,
} from "@phosphor-icons/react";
import { api, ApiError, copyText, formatDate, formatDateTime, formatLakh, idempotencyKey, publicApi, trackEvent } from "./api.js";
import {
  LOGOUT_CHANNEL_NAME, LOGOUT_FAILURE_MESSAGE, broadcastLogout, clearLocalLogoutState, confirmLogout,
  isApplicationUnauthenticated, isCurrentSessionRevalidationTarget, isLogoutBroadcast,
  isLogoutChannelMessage, privateRouteAfterUnauthenticated, shouldRevalidateSession,
} from "./logout.js";
import { reportFeedbackConcernState, resolveArchivedReportFeedback } from "./report-feedback-state.js";
import {
  ESTIMATOR_CITIES,
  ESTIMATOR_FLOORS,
  ESTIMATOR_QUALITIES,
  consumePublicEstimatorAttribution,
  estimatorAuthContinuationState,
  estimatorRequestKey,
  isPublicEstimatorAttribution,
  normalizePublicEstimateEnvelope,
  parseStoredEstimatorScenario,
  publicEstimatorAttributionHeaders,
  safeSessionStorage,
  selectAuthPendingProjectDraft,
  selectAuthProjectCreationKey,
  selectEstimatorScenario,
  storeEstimatorHandoff,
  validProjectCreationKey,
  validateEstimatorScenario,
} from "./public-estimator.js";

const cityFactors = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: .98, Chennai: 1.02, Jaipur: .88, Other: .95 };
const qualityRates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };
const floorFactors = { G: .72, "G+1": 1.22, "G+2": 1.65 };
const decisionPlanIds = ["decision_compare"];
const familyRoles = [
  ["spouse", "Spouse / partner"],
  ["parent", "Parent"],
  ["sibling", "Sibling"],
  ["advisor", "Trusted advisor"],
  ["other", "Other family member"],
];
const familyConfidence = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const familyReasons = [
  ["budget", "Budget"],
  ["space", "Usable space"],
  ["parking", "Parking"],
  ["accessibility", "Accessibility"],
  ["future_expansion", "Future expansion"],
  ["construction_complexity", "Construction complexity"],
];
const familyStatusCopy = {
  no_responses: ["Waiting for the first response", "Share the private review link with up to five family members."],
  split: ["The family is split", "Both directions have meaningful support. Use the reasons below to frame the next conversation."],
  leaning_a: ["The family is leaning toward Option A", "There is a preference, but not yet a strong shared direction."],
  leaning_b: ["The family is leaning toward Option B", "There is a preference, but not yet a strong shared direction."],
  aligned_a: ["The family is aligned on Option A", "Every recorded preference points to the same direction."],
  aligned_b: ["The family is aligned on Option B", "Every recorded preference points to the same direction."],
  not_ready: ["The family is not ready to choose", "The responses suggest more information or another conversation is needed."],
};

function useCommerceCatalog() {
  const [availability,setAvailability]=useState({});
  useEffect(()=>{let active=true;api('/api/commerce/catalog').then(result=>{if(active)setAvailability(Object.fromEntries((result.plans||[]).map(plan=>[plan.id,Boolean(plan.acceptingOrders)])))}).catch(()=>{if(active)setAvailability({})});return()=>{active=false}},[]);
  return availability;
}

function usePrivateUploadCapability() {
  const [state,setState]=useState({phase:"loading",enabled:false});
  useEffect(()=>{
    const controller=new AbortController();
    api('/api/readiness',{signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)setState({phase:"ready",enabled:result?.capabilities?.privateUploads===true});
    }).catch(()=>{
      if(controller.signal.aborted)return;
      setState({phase:"unavailable",enabled:false});
    });
    return()=>controller.abort();
  },[]);
  return state;
}

function route(path, state = {}) {
  window.history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const hash = path.includes("#") ? path.slice(path.indexOf("#") + 1) : "";
  if (hash) window.requestAnimationFrame(() => document.getElementById(safeDecodePathSegment(hash))?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function replaceRoute(path, state = {}) {
  window.history.replaceState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function completePublicEstimatorHandoff() {
  consumePublicEstimatorAttribution(safeSessionStorage());
  removeSessionValue("grihagrid.projectCreationKey");
}

function abandonPendingProjectHandoff() {
  removeSessionValue("grihagrid.pendingProject");
  completePublicEstimatorHandoff();
}

function setSessionValue(key, value) {
  try { const storage=safeSessionStorage();if(!storage)return false;storage.setItem(key,value);return true; } catch { return false; }
}

function removeSessionValue(key) {
  try { safeSessionStorage()?.removeItem(key); } catch { /* Browser storage cleanup is ancillary. */ }
}

function pendingProjectValue() {
  return selectAuthPendingProjectDraft(safeSessionStorage(), window.history.state);
}

function pendingAuthContinuationState() {
  return estimatorAuthContinuationState(
    safeSessionStorage(),
    window.history.state,
    pendingProjectValue(),
    window.history.state?.projectCreationKey,
  );
}

function useProjectCreationKey(recoverStored = false) {
  const [key] = useState(() => validProjectCreationKey(window.history.state?.projectCreationKey)
    || (recoverStored ? selectAuthProjectCreationKey(safeSessionStorage(), window.history.state) : null)
    || crypto.randomUUID());
  useEffect(() => {
    if (window.history.state?.projectCreationKey === key) return;
    window.history.replaceState({ ...(window.history.state || {}), projectCreationKey: key }, "", window.location.href);
  }, [key]);
  return key;
}

function isPrivateAccountPath(pathname) {
  return /^\/(?:dashboard|orders(?:\/|$)|projects\/|report\/|checkout\/return)/u.test(pathname);
}

function safeDecodePathSegment(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function Brand({ inverted = false, disabled = false, onHome = null }) {
  return <button className={`brand ${inverted ? "brand--inverted" : ""}`} disabled={disabled} onClick={() => onHome ? onHome() : route("/")} aria-label="GrihaGrid home">GrihaGrid</button>;
}

function Header({ user }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return <header className="site-header"><div className="header-inner">
    <Brand/>
    <nav id="primary-navigation" className={`main-nav ${open ? "main-nav--open" : ""}`} aria-label="Primary navigation">
      <button onClick={() => { route("/#how"); setOpen(false); }}>How it works</button>
      <button onClick={() => { route("/plans"); setOpen(false); }}>Sample plan</button>
      <button onClick={() => { route("/pricing"); setOpen(false); }}>Pricing</button>
      <button onClick={() => { route("/about"); setOpen(false); }}>About</button>
    </nav>
    <div className="header-actions">
      <button className="quiet-action header-login" onClick={() => route(user ? "/dashboard" : "/login")}>{user ? "My projects" : "Log in"}</button>
      <button className="copper-button header-cta" onClick={() => route("/start")}>Plan my home</button>
      <button className="menu-trigger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}>{open ? <X/> : <List/>}</button>
    </div>
  </div></header>;
}

function WorkspaceAccount({ user, onLogout }) {
  const [phase,setPhase]=useState("idle");
  const inFlight=useRef(false);
  const buttonRef=useRef(null);
  const errorId=useId();
  const failed=phase==="error";
  const pending=phase==="pending";
  async function logout(){
    if(inFlight.current)return;
    inFlight.current=true;setPhase("pending");
    try{
      await confirmLogout();
    }catch{
      inFlight.current=false;setPhase("error");
      window.requestAnimationFrame(()=>buttonRef.current?.focus({preventScroll:true}));
      return;
    }
    clearLocalLogoutState();
    broadcastLogout();
    onLogout();
    replaceRoute("/", { logoutConfirmed: true });
  }
  return <div className="workspace-account"><p>{user?.name||user?.email}</p><button ref={buttonRef} type="button" disabled={pending} aria-busy={pending} aria-describedby={failed?errorId:undefined} onClick={logout}><SignOut/> {pending?'Logging out…':failed?'Retry logout':'Log out'}</button><span className="workspace-account__status" role="status" aria-live="polite">{pending?'Logging out…':''}</span>{failed&&<p className="workspace-account__error" id={errorId} role="alert">{LOGOUT_FAILURE_MESSAGE}</p>}</div>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main">
    <div className="footer-intro"><Brand/><p>A clear concept, a credible budget, and a better first conversation with your architect.</p><span><ShieldCheck/> Private by default</span></div>
    <div><h4>Explore</h4><button onClick={() => route("/start")}>Plan my home</button><button onClick={() => route("/plans")}>Sample plan</button><button onClick={() => route("/pricing")}>Pricing</button></div>
    <div><h4>Company</h4><button onClick={() => route("/about")}>About</button><a href="mailto:hello@grihagrid.in">Contact</a><a href="mailto:architects@grihagrid.in">Architect network</a></div>
    <div><h4>Legal</h4><button onClick={() => route("/privacy")}>Privacy</button><button onClick={() => route("/terms")}>Terms</button><button onClick={() => route("/refund")}>Refunds</button></div>
  </div><div className="footer-meta"><span>© 2026 GrihaGrid Labs</span><span>Concept planning—not municipal or structural approval.</span><span>Made for India</span></div></footer>;
}

function SectionHeading({ kicker, title, copy, align = "left" }) {
  return <div className={`section-heading section-heading--${align}`}>{kicker && <span className="kicker">{kicker}</span>}<h2>{title}</h2>{copy && <p>{copy}</p>}</div>;
}

function EstimateInstrument({ condensed = false, initial }) {
  const defaultScenario = { width: 30, length: 50, city: "Bengaluru", floors: "G+1", quality: "Signature" };
  const startingScenario = parseStoredEstimatorScenario({ ...defaultScenario, ...initial }) || defaultScenario;
  const [width, setWidth] = useState(String(startingScenario.width));
  const [length, setLength] = useState(String(startingScenario.length));
  const [city, setCity] = useState(startingScenario.city);
  const [floors, setFloors] = useState(startingScenario.floors);
  const [quality, setQuality] = useState(startingScenario.quality);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ phase: "loading", requestKey: "", envelope: null, message: "" });
  const latestRequestKey = useRef("");
  const retryFocusRequested = useRef(false);
  const retryFocusRequestKey = useRef("");
  const statusRef = useRef(null);
  const widthErrorId = useId();
  const lengthErrorId = useId();
  const scenarioErrorId = useId();
  const scenario = useMemo(() => ({
    width: width === "" ? null : Number(width),
    length: length === "" ? null : Number(length),
    city,
    floors,
    quality,
  }), [width, length, city, floors, quality]);
  const validation = useMemo(() => validateEstimatorScenario(scenario), [scenario]);
  const requestKey = validation.valid ? estimatorRequestKey(validation.request) : "";
  latestRequestKey.current = requestKey;
  if (retryFocusRequestKey.current && retryFocusRequestKey.current !== requestKey) {
    retryFocusRequested.current = false;
    retryFocusRequestKey.current = "";
  }

  useEffect(() => {
    if (!validation.valid) return undefined;
    const requestedScenario = validation.request;
    const controller = new AbortController();
    let active = true;
    setResult(current => ({
      phase: current.requestKey === requestKey && current.phase === "retrying" ? "retrying" : "loading",
      requestKey,
      envelope: null,
      message: "",
    }));
    const timer = window.setTimeout(async () => {
      try {
        const response = await publicApi("/api/estimate", {
          method: "POST",
          body: requestedScenario,
          signal: controller.signal,
          timeoutMs: 8_000,
        });
        const envelope = normalizePublicEstimateEnvelope(response, requestedScenario);
        if (!active || controller.signal.aborted || latestRequestKey.current !== requestKey) return;
        setResult({ phase: "ready", requestKey, envelope, message: "" });
        if (retryFocusRequested.current && retryFocusRequestKey.current === requestKey) {
          retryFocusRequested.current = false;
          retryFocusRequestKey.current = "";
          window.requestAnimationFrame(() => statusRef.current?.focus({ preventScroll: true }));
        }
      } catch (error) {
        if (!active || controller.signal.aborted || latestRequestKey.current !== requestKey) return;
        const message = error instanceof ApiError && error.status === 408
          ? "The check took too long. Retry when your connection is steadier."
          : "We could not confirm this range right now. Your plot details can still continue safely.";
        setResult({ phase: "error", requestKey, envelope: null, message });
      }
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, retry]);

  const phase = !validation.valid
    ? "invalid"
    : result.requestKey === requestKey ? result.phase : "loading";
  const envelope = phase === "ready" ? result.envelope : null;
  const scenarioErrors = Object.entries(validation.errors)
    .filter(([field]) => !["width", "length"].includes(field))
    .map(([, message]) => message);
  const status = {
    invalid: { label: "Check inputs", Icon: WarningCircle },
    loading: { label: "Updating…", Icon: ArrowClockwise },
    retrying: { label: "Retrying…", Icon: ArrowClockwise },
    ready: { label: "Calculation checked", Icon: SealCheck },
    error: { label: "Unavailable", Icon: WarningCircle },
  }[phase];
  const StatusIcon = status.Icon;

  function continueWithScenario() {
    if (!validation.valid) return;
    const projectCreationKey = crypto.randomUUID();
    storeEstimatorHandoff(safeSessionStorage(), validation.request, projectCreationKey);
    route("/start", {
      estimatorScenario: validation.request,
      estimatorSource: "public_estimator",
      projectCreationKey,
    });
  }

  function retryEstimate() {
    if (phase === "retrying") return;
    retryFocusRequested.current = true;
    retryFocusRequestKey.current = requestKey;
    setResult(current => ({ ...current, phase: "retrying", envelope: null, message: "" }));
    setRetry(value => value + 1);
  }

  return <div className={`estimate-instrument ${condensed ? "estimate-instrument--condensed" : ""}`}>
    <div className="instrument-title"><span>Plot–cost estimator</span><span ref={statusRef} tabIndex="-1" className={`instrument-status instrument-status--${phase}`} role="status" aria-live="polite"><StatusIcon aria-hidden="true"/> {status.label}</span></div>
    <div className="instrument-inputs">
      <label className="instrument-input instrument-input--plot"><span>Plot size</span><div className="dimension-inputs"><input aria-label="Plot width in feet" aria-invalid={Boolean(validation.errors.width)} aria-describedby={validation.errors.width ? widthErrorId : undefined} inputMode="decimal" type="number" min="10" max="500" step="0.1" value={width} onChange={e => setWidth(e.target.value)}/><b>×</b><input aria-label="Plot length in feet" aria-invalid={Boolean(validation.errors.length)} aria-describedby={validation.errors.length ? lengthErrorId : undefined} inputMode="decimal" type="number" min="10" max="500" step="0.1" value={length} onChange={e => setLength(e.target.value)}/><em>ft</em></div></label>
      <label className="instrument-input"><span>Location</span><select aria-label="Location" value={city} onChange={e => setCity(e.target.value)}>{ESTIMATOR_CITIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="instrument-input"><span>Floors</span><select aria-label="Number of floors" value={floors} onChange={e => setFloors(e.target.value)}>{ESTIMATOR_FLOORS.map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="instrument-input"><span>Finish</span><select aria-label="Finish level" value={quality} onChange={e => setQuality(e.target.value)}>{ESTIMATOR_QUALITIES.map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className={`instrument-output instrument-output--${phase}`} aria-busy={["loading", "retrying"].includes(phase)}>
      <span>Indicative construction range</span>
      {phase === "ready"&&<><strong>{formatLakh(envelope.estimate.lowInr)} – {formatLakh(envelope.estimate.highInr)}</strong><small>{envelope.estimate.builtUpSqft.toLocaleString("en-IN")} sq ft likely built-up · {envelope.input.quality} finish · Internal directional benchmark; current local quotes not verified</small></>}
      {phase === "loading"&&<><strong>Checking current basis…</strong><small>Waiting for a server-confirmed range.</small></>}
      {phase === "invalid"&&<><strong>Complete the plot details</strong><div className="instrument-errors" role="alert">{validation.errors.width&&<span id={widthErrorId}>{validation.errors.width}</span>}{validation.errors.length&&<span id={lengthErrorId}>{validation.errors.length}</span>}{scenarioErrors.length>0&&<span id={scenarioErrorId}>{scenarioErrors.join(" ")}</span>}</div></>}
      {["error", "retrying"].includes(phase)&&<><strong>{phase === "retrying" ? "Checking current basis…" : "Range temporarily unavailable"}</strong><small>{phase === "retrying" ? "Retrying the server check without changing your details." : result.message}</small><button type="button" className="instrument-retry" aria-disabled={phase === "retrying"} aria-busy={phase === "retrying"} onClick={retryEstimate}>{phase === "retrying" ? "Checking again…" : "Retry server check"}</button></>}
    </div>
    {envelope&&<details className="instrument-basis"><summary>Basis and exclusions</summary><div><p><strong>Area method:</strong> {envelope.basis.areaMethod}. {envelope.estimate.plotSqft.toLocaleString("en-IN")} sq ft plot × {envelope.basis.floorFactor.toLocaleString("en-IN", { maximumFractionDigits: 2 })} floor factor = <strong>{envelope.estimate.builtUpSqft.toLocaleString("en-IN")} sq ft</strong> likely built-up.</p><p><strong>Cost method:</strong> {envelope.basis.costMethod}. ₹{envelope.basis.finishRateInrPerSqft.toLocaleString("en-IN")}/sq ft internal finish benchmark × {envelope.basis.cityFactor.toLocaleString("en-IN", { maximumFractionDigits: 2 })} city factor, with a {envelope.basis.lowFactor.toLocaleString("en-IN", { maximumFractionDigits: 2 })}×–{envelope.basis.highFactor.toLocaleString("en-IN", { maximumFractionDigits: 2 })}× directional band.</p><p>Calculation rule published {formatDate(envelope.basis.rulePublishedDate)} · v{envelope.basis.ruleVersion}. Current-market calibration has not been independently verified. Taxes and statutory fees are excluded.</p><p>{envelope.basis.marketWarning}</p><ul>{envelope.basis.exclusions.map(item => <li key={item}>{item}</li>)}</ul><p>{envelope.estimate.disclaimer}</p></div></details>}
    <button type="button" className="text-link" disabled={!validation.valid} onClick={continueWithScenario}>{phase === "ready" ? "Use calculation-checked details" : phase === "error" ? "Continue without a range" : "Continue with these details"} <ArrowRight/></button>
  </div>;
}

function HomePage({ user }) {
  const availability=useCommerceCatalog();
  const loggedOut=user===null&&window.history.state?.logoutConfirmed===true;
  return <main>
    {loggedOut&&<p className="logout-confirmation" role="status"><CheckCircle/> You’re logged out. Private workspace data was cleared from this tab.</p>}
    <section className="monograph-hero">
      <div className="monograph-copy">
        <span className="kicker">AI home planning for Indian plots</span>
        <h1>Know what fits.<br/>Know what it costs.</h1>
        <p>Enter your plot details. See the evidence gaps and programme pressure, get an indicative construction range, and walk into your first architect meeting prepared.</p>
        <div className="hero-actions"><button className="copper-button copper-button--large" onClick={() => route("/start")}>Plan my home <ArrowRight/></button><button className="underlined-action" onClick={() => route("/plans")}>See a sample plan</button></div>
        <EstimateInstrument condensed/>
        <div className="hero-steps" aria-label="How GrihaGrid works">
          <div><span>01</span><UploadSimple/><p>Share plot<br/>details</p></div>
          <div><span>02</span><Blueprint/><p>Check the brief<br/>& likely cost</p></div>
          <div><span>03</span><UserCircle/><p>Consult an architect<br/><em>optional</em></p></div>
        </div>
        <div className="hero-trust"><span><ShieldCheck/> Your saved project is account-scoped by default</span><span>Concept first. Professionals before construction.</span></div>
      </div>
      <div className="monograph-visual">
        <img width="1536" height="1024" src="/assets/v2/monograph-house-v2.jpg" onError={e => { e.currentTarget.src = "/assets/grihagrid-hero.jpg"; }} alt="Contemporary Indian home with an overlaid 30 by 50 foot plot plan"/>
      </div>
    </section>

    <section id="how" className="editorial-section editorial-section--split">
      <SectionHeading kicker="Before the first drawing" title="A confident brief changes every conversation." copy="GrihaGrid turns scattered wishes into a measured starting point: a plot envelope, a room programme, a live budget range, and the questions a professional needs to answer."/>
      <div className="editorial-list">
        {[['01','Brief Check','See which key facts are known, which remain missing, and where the programme is under pressure.'],['02','Cost intelligence','Explore a transparent range by city, size and finish—not a false fixed quote.'],['03','Professional handoff','Carry one coherent brief into architect, contractor and family conversations.']].map(([n,t,c]) => <article key={n}><span>{n}</span><div><h3>{t}</h3><p>{c}</p></div></article>)}
      </div>
    </section>

    <section className="report-story">
      <div className="report-story-image"><img loading="lazy" width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Warm modern independent home elevation concept"/><span>Elevation direction · Warm modern</span></div>
      <div className="report-story-copy"><span className="kicker">Your decision book</span><h2>Useful before it becomes technical.</h2><p>A concise report that helps your family align on the home—and helps your architect begin with context instead of a blank page.</p>
        <dl><div><dt>Brief Check</dt><dd>Enough to explore</dd></div><div><dt>Likely built-up</dt><dd>1,830 sq ft</dd></div><div><dt>Planning range</dt><dd>₹37L–₹44L</dd></div><div><dt>Key unknown</dt><dd>Road width and local setbacks</dd></div></dl>
        <button className="underlined-action" onClick={() => route("/plans")}>Open the sample plan <ArrowRight/></button>
      </div>
    </section>

    <section className="editorial-section process-section"><SectionHeading kicker="The process" title="From a plot to an architect-ready brief." align="center"/>
      <div className="process-line">{[[Ruler,'Map the plot','Dimensions, road edge, facing and city context.'],[House,'Shape the home','Family needs, floors, parking and preferences.'],[CurrencyInr,'See the range','A city- and finish-adjusted planning budget.'],[Blueprint,'Choose a direction','Compare two real alternatives before drawings begin.']].map(([Icon,t,c],i) => <div key={t}><span>0{i+1}</span><Icon/><h3>{t}</h3><p>{c}</p></div>)}</div>
    </section>

    <section className="pricing-editorial"><div><span className="kicker">Simple, one-project pricing</span><h2>Start with clarity.<br/><i>Buy detail when it matters.</i></h2><p>No subscription. Your free Brief Check remains yours.</p></div><div className="pricing-lines">
      {[['Brief Check','Free','Evidence gaps, room programme and an indicative concept-planning range.',null],['Decision Compare','₹999','Two versioned options, one chosen direction and a secure shared comparison.','decision_compare']].map(([name,price,copy,sku],i)=>{const accepting=!sku||availability[sku];return <article key={name}><span>0{i+1}</span><div><h3>{name}</h3><p>{copy}</p></div><strong>{price}{sku&&!accepting&&<small>Opening soon</small>}</strong><button disabled={!accepting} onClick={() => {if(sku)sessionStorage.setItem('grihagrid.plan',sku);route('/start')}} aria-label={accepting?`Choose ${name}`:`${name} is not accepting orders`}><ArrowRight/></button></article>})}
      <button className="underlined-action" onClick={() => route('/pricing')}>Compare every inclusion</button>
    </div></section>

    <section className="principle-quote"><blockquote>“The first value of a plan is not the drawing. It is making the right decisions visible.”</blockquote><p>GrihaGrid is built for that moment—before commitments become expensive.</p><button className="copper-button copper-button--large" onClick={() => route('/start')}>Start with my plot <ArrowRight/></button></section>

    <FaqSection/>
  </main>;
}

function FaqSection() {
  const faqs = [
    ["Is this an architectural or sanction drawing?", "No. It is a concept-stage decision brief. A licensed local architect and structural engineer must validate every drawing, site assumption and construction decision."],
    ["How is the cost range calculated?", "We combine the likely built-up area with finish-level benchmarks and a city factor, then show a planning band. It is transparent guidance—not a contractor quotation."],
    ["Can I keep my project private?", "Yes. Projects are account-scoped and sessions use secure cookies. When private upload storage is enabled for a release, files are served through authenticated access rather than public links; the product checks availability before showing a file picker."],
    ["Can I involve my family?", "Yes. Every saved comparison can open one free seven-day Family Alignment room for up to five structured responses. A purchased Decision Compare separately supports an expiring, revocable artifact link for family or your architect."],
  ];
  return <section className="faq-editorial"><SectionHeading kicker="Questions worth asking" title="Clear boundaries build trust."/><div>{faqs.map(([q,a],i)=><details key={q} open={i===0}><summary><span>0{i+1}</span>{q}<Plus/></summary><p>{a}</p></details>)}</div></section>;
}

const plans = [
  {name:"Brief Check",price:"Free",lead:"Answer the first questions.",items:["Evidence-gap assessment","Room programme","City-adjusted planning range","Private saved project","7-day Family Alignment room · up to five structured responses"],eta:"Immediate",sku:null},
  {name:"Decision Compare",price:"₹999",lead:"Choose between two real alternatives.",items:["Exactly two versioned options","Area and cost differences","Trade-offs and recommendation","Five architect questions","Immutable artifact and expiring share"],eta:"Immediate",featured:true,sku:"decision_compare"},
];

function PricingPage() {
  const availability=useCommerceCatalog();
  return <main className="page-main"><section className="page-hero"><span className="kicker">One plot · one payment</span><h1>Choose with evidence, not guesswork.</h1><p>Begin with a free Brief Check. Upgrade the same private project only when two competing directions need one clear decision.</p></section><section className="plan-table">{plans.map((p,i)=>{const accepting=!p.sku||availability[p.sku];return <article className={p.featured?"featured":""} key={p.name}><div className="plan-index">0{i+1}</div><div className="plan-name">{p.featured&&<span>Recommended</span>}<h2>{p.name}</h2><p>{p.lead}</p></div><div className="plan-price"><strong>{p.price}</strong><small>{p.sku&&!accepting?'Opening soon':p.eta}</small></div><ul>{p.items.map(x=><li key={x}><Check/>{x}</li>)}</ul><button disabled={!accepting} className={p.featured?"copper-button":"outline-button"} onClick={()=>{if(p.sku)sessionStorage.setItem('grihagrid.plan',p.sku);route('/start')}}>{i===0?'Start free':accepting?'Choose plan':'Not accepting orders'} {accepting&&<ArrowRight/>}</button></article>})}</section><section className="scope-note"><WarningCircle/><div><h2>Planning before permission.</h2><p>Neither offer replaces the licensed professionals, soil investigation, structural design or municipal approval required to build safely.</p></div></section></main>;
}

function AboutPage() {
  return <main className="page-main"><section className="about-editorial"><span className="kicker">Why GrihaGrid exists</span><h1>Every home begins as a family conversation.</h1><p className="lead">But too often that conversation is forced into drawings, quotes and commitments before the family understands what is possible.</p><div className="about-columns"><p>GrihaGrid creates a calmer first step. Plot dimensions and family needs become an honest Brief Check, a visible planning range and a structured record that a professional can challenge and improve.</p><p>AI helps us make exploration fast and affordable. Licensed people remain responsible for the decisions that affect safety, permission and construction.</p></div></section><section className="values-rule">{[['Clarity over theatre','Assumptions and ranges stay visible.'],['Context over templates','Indian plots, cities and family patterns shape the brief.'],['Professionals at the right moment','Automation explores; experts validate.']].map(([t,c],i)=><article key={t}><span>0{i+1}</span><h2>{t}</h2><p>{c}</p></article>)}</section><section className="principle-quote"><blockquote>Help every family ask better questions before the first expensive answer.</blockquote><p>That is the standard we use to choose what GrihaGrid builds.</p></section></main>;
}

function SamplePlanPage() {
  return <main className="sample-page"><section className="sample-cover"><div><span className="kicker">Sample decision book · Pune</span><h1>A 30 × 50 ft<br/>family home.</h1><p>East-facing · G+1 · Three bedrooms · Signature finish</p><div className="sample-cover__actions"><button className="copper-button" onClick={()=>route('/start')}>Create mine <ArrowRight/></button><button className="underlined-action" onClick={()=>route('/compare/sample')}>See two options compared</button></div></div><img width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Sample warm modern home elevation"/></section><section className="sample-facts"><div><span>Brief Check</span><strong>Programme under tension</strong><small>Parking and circulation need testing</small></div><div><span>Built-up</span><strong>1,830 sq ft</strong><small>Likely concept area</small></div><div><span>Planning range</span><strong>₹37L–₹44L</strong><small>Signature finish · Pune</small></div></section><section className="sample-narrative"><div><span className="kicker">Executive readout</span><h2>There is enough to explore—with one important tension.</h2></div><div><p>Three bedrooms and generous common spaces are worth testing across two floors. Ground-floor parking width remains unresolved; a compact stair and vertically aligned wet areas may protect usable space and cost.</p><p><strong>Direction to test:</strong> Ask a licensed local architect whether the east entry, southeast kitchen and southwest primary bedroom can work after verified setbacks, access and circulation.</p></div></section></main>;
}

const wizardSteps = ["Plot", "Home", "Context", "Review"];
const plotShapeOptions = [
  ["unknown", "Not sure"],
  ["regular", "Regular / rectangular"],
  ["irregular", "Irregular"],
  ["corner", "Corner plot"],
];
const accessibilityOptions = [
  ["unknown", "Not sure"],
  ["none", "No specific requirement"],
  ["step_free", "Step-free movement"],
  ["wheelchair_ready", "Wheelchair-ready"],
];
const futureUseOptions = [
  ["unknown", "Not sure"],
  ["none", "One family home"],
  ["rental", "Rental portion"],
  ["home_office", "Home office"],
  ["vertical_expansion", "Future upper floor"],
];

function StructuredSelect({ label, value, options, onChange, help }) {
  return <label>{label}<select value={value} onChange={event=>onChange(event.target.value)}>{options.map(([optionValue,optionLabel])=><option value={optionValue} key={optionValue}>{optionLabel}</option>)}</select>{help&&<small>{help}</small>}</label>;
}

function projectRequestBody(value={}) {
  const body={...value};
  if(typeof body.bedrooms==="string"&&body.bedrooms!=="5+"&&/^\d{1,2}$/u.test(body.bedrooms))body.bedrooms=Number(body.bedrooms);
  return body;
}

function StartPage({ user }) {
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [files,setFiles]=useState([]);
  const privateUploads=usePrivateUploadCapability();
  const projectCreationKey=useProjectCreationKey();
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  const [data,setData]=useState(()=>{const scenario=selectEstimatorScenario(safeSessionStorage(),window.history.state)||{};return {name:"My family home",width:30,length:50,city:"Pune",facing:"East",floors:"G+1",bedrooms:3,bathrooms:null,parking:"1 car",roadWidthFt:null,plotShape:"unknown",accessibility:"unknown",futureUse:"unknown",budgetLakh:null,style:"Warm modern",quality:"Signature",...scenario}});
  const update=(key,value)=>setData(prev=>({...prev,[key]:value}));
  const abandon=()=>{abandonPendingProjectHandoff();route('/')};
  async function createProject(){
    const request=projectRequestBody(data);
    const attributionHeaders={...publicEstimatorAttributionHeaders(safeSessionStorage(),window.history.state,projectCreationKey),"idempotency-key":projectCreationKey};
    setBusy(true);setError("");
    try {
      const result=await api("/api/projects",{method:"POST",headers:attributionHeaders,body:request});
      if(!active.current)return;
      removeSessionValue("grihagrid.pendingProject");completePublicEstimatorHandoff();
      const failed=[];const uploadQueue=privateUploads.enabled?files:[];
      for(const file of uploadQueue){const form=new FormData();form.append('file',file);form.append('kind','reference');try{await api(`/api/projects/${result.project.id}/files`,{method:'POST',body:form})}catch{failed.push(file.name)}}
      if(!active.current)return;
      if(failed.length)setSessionValue(`grihagrid.uploadWarning.${result.project.id}`,`${failed.length} file${failed.length===1?'':'s'} could not be saved. Add them again from the report.`);
      replaceRoute(`/projects/${result.project.id}`);
    }
    catch(err){if(!active.current)return;if(err instanceof ApiError&&err.status===401){setSessionValue("grihagrid.projectCreationKey",projectCreationKey);setSessionValue("grihagrid.pendingProject",JSON.stringify(request));replaceRoute("/register",{projectContinuation:true,pendingProject:request,estimatorSource:isPublicEstimatorAttribution(safeSessionStorage(),window.history.state,projectCreationKey)?"public_estimator":undefined,projectCreationKey})}else setError(err.message)}
    finally{if(active.current)setBusy(false)}
  }
  return <main className="wizard-page"><div className="wizard-header"><Brand disabled={busy} onHome={abandon}/><button className="quiet-action" disabled={busy} onClick={abandon}>Exit</button></div><div className="wizard-progress" aria-label="Project brief progress">{wizardSteps.map((label,i)=><div className={i<=step?"active":""} aria-current={i===step?'step':undefined} key={label}><span>{i<step?<Check/>:i+1}</span><small>{label}</small></div>)}</div><form className="wizard-sheet" onSubmit={event=>{event.preventDefault();if(step<3)setStep(step+1);else createProject()}}>
    {step===0&&<><span className="kicker">Step one · The plot</span><h1>Begin with the measured ground.</h1><p>Use your sale deed or current survey where possible. Leave uncertain facts clearly marked—not guessed.</p><div className="form-grid"><label>Project name<input required value={data.name} onChange={e=>update('name',e.target.value)} maxLength="100"/></label><label>City<select value={data.city} onChange={e=>update('city',e.target.value)}>{ESTIMATOR_CITIES.map(c=><option key={c}>{c}</option>)}</select></label><label>Plot width <span>feet</span><input required type="number" min="10" max="500" step="any" inputMode="decimal" value={data.width} onChange={e=>update('width',+e.target.value)}/></label><label>Plot length <span>feet</span><input required type="number" min="10" max="500" step="any" inputMode="decimal" value={data.length} onChange={e=>update('length',+e.target.value)}/></label><label>Road-facing side<select value={data.facing} onChange={e=>update('facing',e.target.value)}>{['North','East','South','West'].map(x=><option key={x}>{x}</option>)}</select></label><label>Road width <span>feet · optional</span><input type="number" min="6" max="200" inputMode="decimal" value={data.roadWidthFt??''} placeholder="Not sure" onChange={e=>update('roadWidthFt',e.target.value===''?null:Number(e.target.value))}/><small>Leave blank until measured.</small></label><StructuredSelect label="Plot shape" value={data.plotShape||'unknown'} options={plotShapeOptions} onChange={value=>update('plotShape',value)}/></div></>}
    {step===1&&<><span className="kicker">Step two · The home</span><h1>Describe the life it needs to hold.</h1><p>Choose the practical starting point. “Not sure” is useful information when the family has not decided.</p><Choice label="Floors" value={data.floors} choices={ESTIMATOR_FLOORS} onChange={v=>update('floors',v)}/><Choice label="Bedrooms" value={data.bedrooms} choices={[2,3,4,'5+']} onChange={v=>update('bedrooms',v)}/><div className="form-grid form-grid--programme"><label>Bathrooms <span>optional</span><select value={data.bathrooms??''} onChange={e=>update('bathrooms',e.target.value===''?null:Number(e.target.value))}><option value="">Not sure</option>{Array.from({length:12},(_,index)=>index+1).map(value=><option value={value} key={value}>{value}</option>)}</select></label><StructuredSelect label="Accessibility" value={data.accessibility||'unknown'} options={accessibilityOptions} onChange={value=>update('accessibility',value)}/><StructuredSelect label="Future use" value={data.futureUse||'unknown'} options={futureUseOptions} onChange={value=>update('futureUse',value)}/><label>Working budget <span>₹ lakh · optional</span><input type="number" min="5" max="10000" inputMode="decimal" value={data.budgetLakh??''} placeholder="Not sure" onChange={e=>update('budgetLakh',e.target.value===''?null:Number(e.target.value))}/><small>A planning limit, not a quotation.</small></label></div><Choice label="Parking" value={data.parking} choices={['None','1 car','2 cars']} onChange={v=>update('parking',v)}/><Choice label="Finish" value={data.quality} choices={ESTIMATOR_QUALITIES} onChange={v=>update('quality',v)}/></>}
    {step===2&&<><span className="kicker">Step three · Context</span><h1>Give the concept a sense of place.</h1><p>{privateUploads.enabled?'Site photographs are optional and are stored in private, account-scoped storage.':'Site photographs are not required for this Brief Check. Your structured facts are enough to identify what is known and what still needs verification.'}</p>{privateUploads.enabled?(user?<label className="upload-field"><UploadSimple/><strong>{files.length?`${files.length} photograph${files.length===1?'':'s'} selected`:'Choose plot photographs'}</strong><span>JPG, PNG or WebP · up to 10 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{if(privateUploads.enabled)setFiles([...e.target.files].filter(file=>file.size<=10*1024*1024))}}/></label>:<div className="account-note"><LockKey/><p>Create or log into your private account first, then add site photographs from the report.</p></div>):<div className="account-note upload-capability-note" role="status"><LockKey/><p>{privateUploads.phase==='loading'?'Checking private photo storage. Uploads stay closed until availability is verified; the Brief Check continues without them.':'Private photo storage is not enabled in this release. Keep site photos on your device and share them directly with your licensed professional when needed.'}</p></div>}<label className="select-block">Exterior direction<select value={data.style} onChange={e=>update('style',e.target.value)}>{['Warm modern','Contemporary','Traditional Indian','Tropical modern','Minimal'].map(x=><option key={x}>{x}</option>)}</select></label></>}
    {step===3&&<><span className="kicker">Step four · Review</span><h1>Ready for a Brief Check.</h1><p>These stated facts—and the facts left unknown—become the assumption record behind the planning range.</p><div className="brief-lines">{[['Plot',`${data.width} × ${data.length} ft · ${data.facing}-facing · ${plotShapeOptions.find(([value])=>value===data.plotShape)?.[1]||'Not sure'}`],['Access',data.roadWidthFt?`${data.roadWidthFt} ft road`:'Road width not known'],['Home',`${data.floors} · ${data.bedrooms} bedrooms · ${data.bathrooms??'Bathrooms not sure'}${data.bathrooms?' bathrooms':''} · ${data.parking}`],['Household',`${accessibilityOptions.find(([value])=>value===data.accessibility)?.[1]||'Not sure'} · ${futureUseOptions.find(([value])=>value===data.futureUse)?.[1]||'Not sure'}`],['Context',`${data.city} · ${data.style}`],['Budget & finish',`${data.budgetLakh?`₹${data.budgetLakh} lakh working limit`:'Budget not stated'} · ${data.quality}`]].map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div><div className="warning-note"><WarningCircle/><p>A Brief Check identifies evidence gaps and programme pressure. It does not validate site suitability, bylaws, design, structure or construction readiness.</p></div>{!user&&<div className="account-note"><LockKey/><p>You will create an account next so this project remains private and can be revisited.</p></div>}</>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="wizard-actions">{step>0&&<button type="button" disabled={busy} className="outline-button" onClick={()=>setStep(step-1)}><ArrowLeft/> Back</button>}<button type="submit" disabled={busy} className="copper-button">{step<3?'Continue':busy?'Creating…':user?'Create Brief Check':'Secure my project'} <ArrowRight/></button></div>
  </form></main>;
}

function Choice({label,value,choices,onChange}) { return <fieldset className="choice-field"><legend>{label}</legend><div>{choices.map(choice=><button type="button" aria-pressed={choice===value} className={choice===value?"selected":""} key={choice} onClick={()=>onChange(choice)}>{choice}</button>)}</div></fieldset>; }

function AuthPage({ mode, onAuthenticated }) {
  const isLogin=mode==="login";
  const [form,setForm]=useState({name:"",email:"",password:""});
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [authenticated,setAuthenticated]=useState(false);
  const projectCreationKey=useProjectCreationKey(true);
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  const abandon=()=>{abandonPendingProjectHandoff();route('/')};
  async function submit(e){
    e.preventDefault();setBusy(true);setError("");
    try{
      if(!authenticated){const result=await api(`/api/auth/${isLogin?'login':'register'}`,{method:'POST',body:form});if(!active.current)return;onAuthenticated(result.user);setAuthenticated(true)}
      const pending=pendingProjectValue();
      if(pending){const project=await api('/api/projects',{method:'POST',headers:{...publicEstimatorAttributionHeaders(safeSessionStorage(),window.history.state,projectCreationKey),'idempotency-key':projectCreationKey},body:projectRequestBody(pending)});if(!active.current)return;removeSessionValue('grihagrid.pendingProject');completePublicEstimatorHandoff();replaceRoute(`/projects/${project.project.id}`)}
      else {if(window.history.state?.projectContinuation===true)abandonPendingProjectHandoff();route('/dashboard')}
    }catch(err){if(active.current)setError(err.message)}finally{if(active.current)setBusy(false)}
  }
  return <main className="auth-page"><div className="auth-architecture"><img width="1536" height="1024" src="/assets/v2/monograph-house-v2.jpg" onError={e=>{e.currentTarget.src='/assets/grihagrid-hero.jpg'}} alt="Contemporary Indian home"/><div><Brand inverted disabled={busy} onHome={abandon}/><blockquote>Start with clarity.<br/>Build with confidence.</blockquote></div></div><section className="auth-form"><button className="back-action" disabled={busy} onClick={abandon}><ArrowLeft/> Home</button><span className="kicker">Private project workspace</span><h1>{isLogin?'Welcome back.':'Create your account.'}</h1><p>{isLogin?'Return to your saved home plans.':'Save the brief you just created and keep every decision together.'}</p><form onSubmit={submit}>{!isLogin&&<label>Full name<input required autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Password<input required type="password" minLength="10" autoComplete={isLogin?'current-password':'new-password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><small>At least 10 characters</small></label>{error&&<p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="copper-button" type="submit">{busy?'Please wait…':authenticated?'Retry saving project':isLogin?'Log in':'Create account'} <ArrowRight/></button></form><p className="auth-switch">{isLogin?'New to GrihaGrid?':'Already have an account?'} <button disabled={busy} onClick={()=>replaceRoute(isLogin?'/register':'/login',pendingAuthContinuationState())}>{isLogin?'Create account':'Log in'}</button></p></section></main>;
}

function Dashboard({ user, onLogout }) {
  const [projects,setProjects]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  useEffect(()=>{api('/api/projects').then(x=>setProjects(x.projects||[])).catch(e=>{if(e instanceof ApiError&&e.status===401)route('/login');else setError(e.message)}).finally(()=>setLoading(false));},[]);
  return <main className="workspace"><aside><Brand/><nav><button className="active"><Blueprint/> Projects</button><button onClick={()=>route('/orders')}><Receipt/> Orders</button><button onClick={()=>route('/start')}><Plus/> New brief</button><button onClick={()=>route('/plans')}><FileText/> Sample plan</button></nav><WorkspaceAccount user={user} onLogout={onLogout}/></aside><section className="workspace-main"><header><div><span className="kicker">Your private workspace</span><h1>Home plans, in one place.</h1></div><button className="copper-button" onClick={()=>route('/start')}><Plus/> New project</button></header>{loading&&<p className="loading-line" role="status">Loading your projects…</p>}{error&&<p className="form-error" role="alert">{error}</p>}{!loading&&!error&&projects.length===0&&<div className="empty-state"><Blueprint/><h2>Your first plot is still blank paper.</h2><p>Create a Brief Check and planning range before commissioning drawings.</p><button className="copper-button" onClick={()=>route('/start')}>Plan my home <ArrowRight/></button></div>}<div className="project-list">{projects.map((project,i)=><article key={project.id}><span className="project-number">{String(i+1).padStart(2,'0')}</span><div><small>{project.status?.replaceAll('_',' ')}</small><h2>{project.name}</h2><p>{project.input?.width||project.width||30} × {project.input?.length||project.length||50} ft · {project.input?.city||project.city||'India'} · {project.input?.floors||project.floors||'G+1'}</p></div><div><span>Planning range</span><strong>{formatLakh(project.estimate?.lowInr||project.low_inr)} – {formatLakh(project.estimate?.highInr||project.high_inr)}</strong></div><div className="project-actions"><button onClick={()=>route(`/projects/${project.id}`)}>{project.status==='archived'?'Open project':'Resume'} <ArrowRight/></button></div></article>)}</div></section></main>;
}

const projectHomeSteps = {
  feasibility: {
    title: "Brief Check",
    copy: "Review the stated facts, programme pressure, planning range, and what still needs local verification.",
  },
  comparison: {
    title: "Compare alternatives",
    copy: "Hold the plot steady and make two programme, area, and budget trade-offs visible.",
  },
  family: {
    title: "Family input",
    copy: "Collect a small, anonymous reading when another family conversation would help.",
    optional: true,
  },
  direction: {
    title: "Choose a direction",
    copy: "Record the owner's working choice and take one coherent brief to a licensed professional.",
  },
};

const projectHomeActions = {
  open_feasibility: {
    target: "report",
    label: "Open planning report",
    title: "Read the ground truth first.",
    copy: "Review the current Brief Check, planning range, assumptions, and professional checks before changing the brief.",
    Icon: FileText,
  },
  start_comparison: {
    target: "compare",
    label: "Compare two alternatives",
    title: "Put two real directions on the table.",
    copy: "Keep the plot fixed, change only the choices that matter, and make the trade-off visible.",
    Icon: ArrowsLeftRight,
  },
  recalculate_comparison: {
    target: "compare",
    label: "Recalculate comparison",
    title: "Bring the comparison up to date.",
    copy: "The project brief has moved since these alternatives were saved. Recalculate before choosing or sharing.",
    Icon: ArrowClockwise,
  },
  choose_direction: {
    target: "compare",
    label: "Choose a direction",
    title: "Turn the evidence into one working choice.",
    copy: "Review the current alternatives and any advisory family response, then record the direction you want a professional to challenge.",
    Icon: SealCheck,
  },
  open_handoff: {
    target: "compare",
    label: "Open handoff material",
    title: "Take one decision into the room.",
    copy: "Your direction is recorded. Open the current comparison, architect questions, and printable working copy for the professional conversation.",
    Icon: ArrowRight,
  },
  view_archived: {
    target: "dashboard",
    label: "Back to all projects",
    title: "This project is resting in the archive.",
    copy: "Its existing evidence remains readable. Return to the workspace to continue with another active project.",
    Icon: ArrowLeft,
  },
};

const projectStageCopy = {
  feasibility_pending: ["Begin with the measured brief.", "One clear Brief Check and planning report come before alternatives, family input, or a direction."],
  comparison_pending: ["The ground is understood. Now test the brief.", "Two bounded alternatives can reveal where space, budget, and delivery complexity pull apart."],
  comparison_stale: ["The brief moved. The old comparison did not.", "Recalculate the two alternatives before relying on their figures, family room, or recorded direction."],
  direction_pending: ["The evidence is ready for a choice.", "Family input is advisory. The owner's current saved direction remains the authoritative working decision."],
  decision_ready: ["One direction is ready for professional challenge.", "Carry the selected brief, its trade-offs, and unresolved questions into a licensed architect conversation."],
  archived: ["This project is archived.", "Its saved evidence remains readable, but GrihaGrid will not invite new generation or other changes from this page."],
};

function homeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function homeNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function homeRecordAvailable(value) {
  if (typeof value === "boolean") return value;
  const record = homeObject(value);
  for (const key of ["available", "exists", "present"]) {
    if (Object.hasOwn(record, key)) return Boolean(record[key]);
  }
  return Boolean(record.id || record.version || record.generatedAt || record.generated_at || record.createdAt || record.created_at);
}

function homeRecordCurrent(value) {
  if (typeof value === "boolean") return value;
  const record = homeObject(value);
  if (Object.hasOwn(record, "current")) return Boolean(record.current);
  return homeRecordAvailable(value);
}

function projectStepState(step) {
  if (step?.completed === true) return "complete";
  if (step?.current === true) return "current";
  const raw = String(step?.state || step?.status || "pending").toLowerCase();
  if (["complete", "completed", "ready", "done"].includes(raw)) return "complete";
  if (raw === "current") return "current";
  if (["stale", "attention", "blocked"].includes(raw)) return "attention";
  if (["optional", "active", "closed"].includes(raw)) return "optional";
  return "pending";
}

function projectStepStatus(step, meta, archived = false) {
  const raw = String(step?.state || step?.status || "pending").toLowerCase();
  if (meta.optional && raw === "active") return "Active · optional";
  if (meta.optional && raw === "closed") return "Closed · optional";
  if (archived && raw === "current") return "Current record";
  const state = projectStepState(step);
  if (state === "complete") return "Complete";
  if (state === "current") return "Current step";
  if (state === "attention") return "Needs refresh";
  if (state === "optional" || meta.optional) return "Optional";
  return "Not started";
}

function projectHomePath(projectId, action) {
  const definition = projectHomeActions[action?.code];
  if (!definition || (action?.target && action.target !== definition.target)) return null;
  const encodedProjectId=encodeURIComponent(projectId);
  if (definition.target === "report") return `/report/${encodedProjectId}`;
  if (definition.target === "compare") return `/projects/${encodedProjectId}/compare`;
  if (definition.target === "dashboard") return "/dashboard";
  return null;
}

function EvidenceCard({ Icon, eyebrow, title, copy, meta, tone = "neutral" }) {
  return <article className={`project-evidence__item project-evidence__item--${tone}`}>
    <div className="project-evidence__icon" aria-hidden="true"><Icon/></div>
    <div><span>{eyebrow}</span><h3>{title}</h3><p>{copy}</p>{meta&&<small>{meta}</small>}</div>
  </article>;
}

function ProjectHomePage({ projectId }) {
  const [state,setState]=useState({phase:"loading",payload:null,error:""});
  const [deleting,setDeleting]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const trackedOpen=useRef(false);

  async function load(signal) {
    setState(current=>({...current,phase:"loading",error:""}));
    try {
      const payload=await api(`/api/projects/${encodeURIComponent(projectId)}/home`,{signal});
      if(signal?.aborted)return;
      setState({phase:"ready",payload,error:""});
      if(!trackedOpen.current){trackedOpen.current=true;trackEvent("project_home_opened",{surface:"project_home",outcome:"success"});}
    } catch(err) {
      if(signal?.aborted)return;
      if(err instanceof ApiError&&err.status===401){route("/login");return;}
      if(err instanceof ApiError&&err.status===404){setState({phase:"missing",payload:null,error:""});return;}
      setState({phase:"error",payload:null,error:err?.message||"The project home could not be opened."});
    }
  }

  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[projectId]);

  if(state.phase!=="ready")return <main className="project-home project-home--state">
    <header className="project-home__topbar"><button onClick={()=>route("/dashboard")}><ArrowLeft/> My projects</button><Brand inverted/><span><LockKey/> Private project</span></header>
    <section className="project-home__state-panel" aria-busy={state.phase==="loading"}>
      {state.phase==="loading"&&<><Blueprint/><span className="kicker">Project decision home</span><h1>Reading the current record…</h1><p role="status">Checking the Brief Check, planning report, comparison, family summary, and owner direction without changing the project.</p></>}
      {state.phase==="missing"&&<><Compass/><span className="kicker">Project unavailable</span><h1>This private project cannot be opened.</h1><p>The project may no longer exist, or this account may not have access to it.</p><button className="copper-button" onClick={()=>route("/dashboard")}>Back to my projects <ArrowRight/></button></>}
      {state.phase==="error"&&<><WarningCircle/><span className="kicker">Project temporarily unavailable</span><h1>Your project remains private and unchanged.</h1><p role="alert">{state.error}</p><div className="error-actions"><button className="outline-button" onClick={()=>route("/dashboard")}><ArrowLeft/> My projects</button><button className="copper-button" onClick={()=>load()}>Try again <ArrowClockwise/></button></div></>}
    </section>
  </main>;

  const payload=homeObject(state.payload);
  const project=homeObject(payload.project);
  const lifecycle=homeObject(payload.lifecycle);
  const current=homeObject(payload.current);
  const counts=homeObject(payload.counts);
  const input=homeObject(project.input);
  const estimate=homeObject(project.estimate);
  const feasibility=homeObject(current.feasibility);
  const aiBrief=homeObject(current.aiBrief||current.ai_brief);
  const comparison=homeObject(current.comparison);
  const selection=homeObject(current.selection);
  const family=homeObject(current.family);
  const purchase=homeObject(current.purchase);
  const stage=String(lifecycle.stage||"feasibility_pending");
  const archived=stage==="archived"||project.status==="archived";
  const stale=stage==="comparison_stale"||comparison.stale===true||comparison.current===false&&homeRecordAvailable(current.comparison);
  const stageCopy=projectStageCopy[stage]||projectStageCopy.feasibility_pending;
  const action=projectHomeActions[lifecycle.nextAction?.code];
  const ActionIcon=action?.Icon;
  const actionPath=projectHomePath(projectId,lifecycle.nextAction);
  const serverSteps=new Map((Array.isArray(lifecycle.steps)?lifecycle.steps:[]).map(step=>[step?.id,step]));
  const comparisonVersion=homeNumber(comparison.version,comparison.comparisonVersion);
  const familyResponses=homeNumber(family.totalResponses,family.responseCount,family.responses,counts.familyResponses,counts.family_responses);
  const familyMax=homeNumber(family.maxResponses,family.max_responses)||5;
  const familyAvailable=homeRecordAvailable(current.family);
  const familyClosed=familyAvailable&&family.active===false;
  const familySummary=familyClosed?["Family review closed","Recorded responses remain aggregate, advisory evidence. No new review is invited from this closed room."]:familyStatusCopy[family.status];
  const purchaseCount=homeNumber(purchase.count,purchase.total,counts.purchasedArtifacts,counts.purchased_artifacts,counts.purchases);
  const orderCount=homeNumber(counts.orders,purchase.orderCount,purchase.order_count);
  const revisionCount=homeNumber(counts.revisions,counts.briefRevisions,counts.brief_revisions)||1;
  const selectionKey=String(selection.optionKey||selection.scenarioKey||selection.key||"").toUpperCase();
  const selectionName=selection.label||selection.scenarioLabel||(selectionKey==="A"||selectionKey==="B"?`Option ${selectionKey}`:"");
  const feasibilityAvailable=homeRecordAvailable(current.feasibility);
  const feasibilityReady=homeRecordCurrent(current.feasibility);
  const aiAvailable=homeRecordAvailable(current.aiBrief||current.ai_brief);
  const aiReady=homeRecordCurrent(current.aiBrief||current.ai_brief);
  const comparisonAvailable=homeRecordAvailable(current.comparison);
  const comparisonReady=homeRecordCurrent(current.comparison);
  const selectionReady=homeRecordAvailable(current.selection);
  const familyReady=familyAvailable&&homeRecordCurrent(current.family);
  const purchaseReady=homeRecordAvailable(current.purchase)&&homeRecordCurrent(current.purchase);
  const lower=formatLakh(estimate.lowInr||estimate.low_inr);
  const upper=formatLakh(estimate.highInr||estimate.high_inr);
  const hasRange=lower!=="—"&&upper!=="—";

  async function deleteProject() {
    const name=project.name||"this project";
    if(!window.confirm(`Delete “${name}”? This permanently removes its unpaid project record, report, working comparisons, and Family Alignment rooms. Private files must be deleted individually first; any purchase or payment evidence prevents project deletion.`))return;
    setDeleting(true);setDeleteError("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}`,{method:"DELETE",body:{}});
      route("/dashboard");
    } catch(err) {
      if(err instanceof ApiError&&err.status===409&&err.payload?.code==="project_has_files"){setDeleteError("This project still has private file records. Open the planning report to review them. Their stored content can be opened or permanently deleted only while private storage is available.");}
      else if(err instanceof ApiError&&err.status===409){setDeleteError("This project has purchase or payment evidence and cannot be deleted. Its financial record and purchased evidence must remain intact.");}
      else if(err instanceof ApiError&&err.status===401){route("/login");}
      else setDeleteError(err?.message||"The project could not be deleted. Check its private files and purchase history before trying again.");
    } finally { setDeleting(false); }
  }

  function takeNextAction() {
    if(!actionPath)return;
    trackEvent("project_home_next_action_clicked",{surface:"project_home",outcome:"success"});
    route(actionPath);
  }

  return <main className={`project-home project-home--${archived?"archived":stale?"stale":stage}`}>
    <header className="project-home__topbar"><button onClick={()=>route("/dashboard")}><ArrowLeft/> My projects</button><Brand inverted/><button onClick={()=>route("/orders")}><Receipt/> Orders</button></header>
    <section className="project-home__masthead" aria-labelledby="project-home-title">
      <div><span className="kicker">Private project · decision home</span><h1 id="project-home-title">{project.name||"My family home"}</h1><p>{stageCopy[0]} <span>{stageCopy[1]}</span></p><div className="project-home__brief-action"><button className="outline-button" onClick={()=>route(`/projects/${encodeURIComponent(projectId)}/brief`)}>{archived?<><Stack/> Review brief history</>:<><PencilSimple/> Strengthen this brief</>}</button><small>{revisionCount} recorded revision{revisionCount===1?'':'s'} · current revision {project.inputRevision||1}</small></div></div>
      <div className="project-home__folio" aria-hidden="true"><span>Project record</span><strong>{String(project.inputRevision||1).padStart(2,"0")}</strong><small>Current input revision</small></div>
    </section>
    <section className="project-home__facts" aria-label="Current project facts">
      <div><span>Measured plot</span><strong>{input.width||"—"} × {input.length||"—"} ft</strong><small>{input.facing?`${input.facing}-facing`:"Facing to confirm"}</small></div>
      <div><span>Context</span><strong>{input.city||"India"}</strong><small>{input.floors||"Floor count to confirm"} · {input.quality||"Finish to confirm"}</small></div>
      <div><span>Planning range</span><strong>{hasRange?`${lower} – ${upper}`:"—"}</strong><small>Indicative, not a contractor quotation</small></div>
      <div><span>Current record</span><strong>Revision {project.inputRevision||1}</strong><small>Updated {formatDate(project.updatedAt)}</small></div>
    </section>

    {stale&&<section className="project-home__notice project-home__notice--stale" role="status"><ArrowClockwise/><div><strong>The comparison is out of date.</strong><p>The current brief changed after these alternatives were saved. Family and choice evidence tied to that older version stays historical; recalculate before relying on it.</p></div></section>}
    {archived&&<section className="project-home__notice project-home__notice--archived" role="status"><LockKey/><div><strong>Archived planning record.</strong><p>Existing evidence remains visible. This home will not suggest planning changes, generation, sharing, checkout, or uploads; privacy deletion remains available below.</p></div></section>}

    <section className="project-home__journey" aria-labelledby="project-journey-title">
      <div className="project-home__journey-main">
        <header><div><span className="kicker">The decision path</span><h2 id="project-journey-title">One measured step at a time.</h2></div><p><strong>{homeNumber(lifecycle.completedCoreSteps)}</strong> of {homeNumber(lifecycle.totalCoreSteps)||3} core steps complete</p></header>
        <ol className="project-home__steps">
          {Object.entries(projectHomeSteps).map(([id,meta],index)=>{const step=serverSteps.get(id)||{id};const stepState=projectStepState(step);return <li key={id} className={`project-home__step project-home__step--${stepState}`} aria-current={!archived&&stepState==="current"?"step":undefined}>
            <div><span>{String(index+1).padStart(2,"0")}</span>{stepState==="complete"?<CheckCircle/>:stepState==="attention"?<WarningCircle/>:<i aria-hidden="true"/>}</div>
            <small>{projectStepStatus(step,meta,archived)}</small>
            <h3>{meta.title}{meta.optional&&<em> · Optional</em>}</h3>
            <p>{step.detail||meta.copy}</p>
          </li>})}
        </ol>
      </div>
      <aside className="project-home__next" aria-labelledby="project-next-title">
        <span className="kicker">Recommended next step</span>
        {ActionIcon&&actionPath?<><ActionIcon aria-hidden="true"/><h2 id="project-next-title">{action.title}</h2><p>{action.copy}</p><button className="copper-button copper-button--large" onClick={takeNextAction}>{action.label} <ArrowRight/></button><small><ShieldCheck/> Concept-stage guidance. A licensed local professional validates the decision before design or construction.</small></>:<><WarningCircle aria-hidden="true"/><h2 id="project-next-title">No action is available from this record.</h2><p>The project is unchanged. Return to your workspace or try this page again once the current state is available.</p></>}
      </aside>
    </section>

    <section className="project-evidence" aria-labelledby="project-evidence-title">
      <header><div><span className="kicker">Current evidence</span><h2 id="project-evidence-title">What this decision rests on.</h2></div><p>Current records are separated from older history. Family input remains aggregate and advisory.</p></header>
      <div className="project-evidence__grid">
        <EvidenceCard Icon={FileText} eyebrow="Planning report" tone={feasibilityReady?"ready":feasibilityAvailable?"attention":"pending"} title={feasibilityReady?`Current report${feasibility.version?` · v${feasibility.version}`:""}`:feasibilityAvailable?`Earlier report${feasibility.version?` · v${feasibility.version}`:""} needs refresh`:"Planning report not opened"} copy={feasibilityReady?"The saved report matches the current project facts and planning estimate.":feasibilityAvailable?"This saved report belongs to an earlier project input. Refresh before relying on it.":"Open the current planning report before treating later decisions as current."} meta={feasibility.generatedAt?`Generated ${formatDate(feasibility.generatedAt)}`:null}/>
        <EvidenceCard Icon={Sparkle} eyebrow="AI planning memo" tone={aiReady?"ready":aiAvailable?"attention":"optional"} title={aiReady?"Current Gemini reading":aiAvailable?"Earlier Gemini reading":"Optional reading not created"} copy={aiReady?"The saved advisory memo is tied to the current planning-report source.":aiAvailable?"This advisory memo belongs to an earlier planning-report source and is not presented as current.":"AI is an optional second reading. It never changes the deterministic range or professional boundary."} meta={aiBrief.generatedAt?`Generated ${formatDate(aiBrief.generatedAt)}`:null}/>
        <EvidenceCard Icon={ArrowsLeftRight} eyebrow="Decision Compare" tone={stale?"attention":comparisonReady?"ready":"pending"} title={stale?`Comparison${comparisonVersion?` v${comparisonVersion}`:""} needs refresh`:comparisonReady?`Comparison${comparisonVersion?` v${comparisonVersion}`:""} is current`:comparisonAvailable?"Earlier comparison":"No saved comparison"} copy={stale?"Its inputs no longer match this project revision.":comparisonReady?"Exactly two alternatives share the same current plot and cost basis.":"Create two alternatives after the Brief Check has framed the decision."} meta={homeNumber(counts.comparisons)>1?`${homeNumber(counts.comparisons)} saved comparison versions`:null}/>
        <EvidenceCard Icon={UserCircle} eyebrow="Family Alignment · optional" tone={familyReady&&familyResponses>0?"ready":"optional"} title={familyClosed?`${familyResponses} recorded response${familyResponses===1?"":"s"}`:familyReady?`${familyResponses} of ${familyMax} responses`:"No current family room"} copy={familySummary?.[1]||"Family input is optional, aggregate, and advisory. It never blocks or overrides the owner's direction."} meta={family.active&&family.expiresAt?`Room closes ${formatDateTime(family.expiresAt)}`:familySummary?.[0]||null}/>
        <EvidenceCard Icon={SealCheck} eyebrow="Owner direction" tone={selectionReady?"ready":"pending"} title={selectionReady?(selectionName||"Direction recorded"):"No direction recorded"} copy={selectionReady?"This is the owner's authoritative working choice for the current comparison.":"A family response is never substituted for the owner's saved direction."} meta={selection.selectedAt?`Chosen ${formatDate(selection.selectedAt)}`:null}/>
        <EvidenceCard Icon={Receipt} eyebrow="Purchased history" tone={purchaseReady?"ready":"neutral"} title={purchaseCount?`${purchaseCount} purchased artifact${purchaseCount===1?"":"s"}`:"No purchased artifact"} copy={purchaseReady?"The current comparison has an active immutable purchased artifact.":purchaseCount?"Earlier purchased evidence remains immutable and separate from this current working brief.":"No payment or entitlement is inferred from this project home."} meta={orderCount?`${orderCount} order record${orderCount===1?"":"s"} retained`:null}/>
      </div>
    </section>

    <section className="project-home__boundary"><ShieldCheck/><p><strong>Decision support, not professional approval.</strong> GrihaGrid helps the family frame one informed brief. A licensed architect, structural engineer, site investigation, and local authority remain responsible for design, safety, and permission.</p></section>

    <section className="project-home__danger" aria-labelledby="project-danger-title">
      <div><span className="kicker">Private project controls</span><h2 id="project-danger-title">Delete this project.</h2><p>This permanently removes an unpaid project record, its report, working comparisons, and Family Alignment rooms. The project must have no private file records and no purchase or payment evidence. Open the planning report to review any file records; their stored content can be opened or permanently deleted only while private storage is available.</p></div>
      <button className="project-home__delete" disabled={deleting} onClick={deleteProject}><Trash/>{deleting?"Deleting…":"Delete project"}</button>
      {deleteError&&<p className="form-error" role="alert">{deleteError}</p>}
    </section>
  </main>;
}

const briefCheckLabels = {
  insufficient_information: "Needs key facts",
  needs_key_facts: "Needs key facts",
  needs_facts: "Needs key facts",
  programme_tension: "Programme under tension",
  programme_under_tension: "Programme under tension",
  under_tension: "Programme under tension",
  directionally_plausible: "Enough to explore",
  enough_to_explore: "Enough to explore",
  explore: "Enough to explore",
};

const briefEditableFields = [
  "width", "length", "city", "facing", "roadWidthFt", "plotShape", "floors", "bedrooms",
  "bathrooms", "parking", "accessibility", "futureUse", "budgetLakh", "quality", "style",
];

const briefFieldLabels = {
  width: "Plot width",
  length: "Plot length",
  city: "City",
  facing: "Road-facing side",
  roadWidthFt: "Road width",
  plotShape: "Plot shape",
  floors: "Floors",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  parking: "Parking",
  accessibility: "Accessibility",
  futureUse: "Future use",
  budgetLakh: "Working budget",
  quality: "Finish",
  style: "Exterior direction",
};

function briefStatusLabel(value) {
  const normalized=String(value||"").trim().toLowerCase().replaceAll("-","_").replaceAll(" ","_");
  return briefCheckLabels[normalized]||"Needs key facts";
}

function briefCheckRecord(value) {
  const record=homeObject(value);
  const label=briefStatusLabel(record.status||record.label||record.headline);
  return {
    ...record,
    label,
    headline: record.headline||label,
    summary: record.summary||"Record what is known, keep uncertainty visible, and ask a licensed local professional to verify the site and rules.",
    missingFields: Array.isArray(record.missingFields)?record.missingFields:[],
    tensions: Array.isArray(record.tensions)?record.tensions:[],
    professionalChecks: listOf(record.professionalChecks),
  };
}

function briefFormValue(input={}) {
  const bedrooms=input.bedrooms==null?"":input.bedrooms;
  const parking=input.parking===false?"None":input.parking===true?"1 car":input.parking||"";
  return {
    width: input.width??"",
    length: input.length??"",
    city: input.city||"",
    facing: input.facing||"",
    roadWidthFt: input.roadWidthFt??null,
    plotShape: input.plotShape||"unknown",
    floors: input.floors||"",
    bedrooms,
    bathrooms: input.bathrooms??null,
    parking,
    accessibility: input.accessibility||"unknown",
    futureUse: input.futureUse||"unknown",
    budgetLakh: input.budgetLakh??null,
    quality: input.quality||"",
    style: input.style||"",
  };
}

function briefComparableValue(field,value) {
  if (["width","length","roadWidthFt","bathrooms","budgetLakh"].includes(field)) {
    if (value==null||value==="") return null;
    const number=Number(value);
    return Number.isFinite(number)?number:value;
  }
  return value==null?null:value;
}

function briefInputPatch(baseInput,form) {
  const base=briefFormValue(baseInput);
  return Object.fromEntries(briefEditableFields.flatMap(field=>{
    const before=briefComparableValue(field,base[field]);
    const after=briefComparableValue(field,form[field]);
    return JSON.stringify(before)===JSON.stringify(after)?[]:[[field,after]];
  }));
}

function enumLabel(options,value) {
  return options.find(([option])=>option===value)?.[1]||"Not sure";
}

function briefDisplayValue(field,value) {
  if (value==null||value==="") return "Not stated";
  if (field==="plotShape") return enumLabel(plotShapeOptions,value);
  if (field==="accessibility") return enumLabel(accessibilityOptions,value);
  if (field==="futureUse") return enumLabel(futureUseOptions,value);
  if (["width","length","roadWidthFt"].includes(field)) return `${Number(value).toLocaleString("en-IN")} ft`;
  if (field==="budgetLakh") return `₹${Number(value).toLocaleString("en-IN")} lakh`;
  if (typeof value==="boolean") return value?"Yes":"No";
  if (typeof value==="object") return "Recorded";
  return String(value);
}

function briefDeltaValue(field,value,withSign=false) {
  const number=Number(value);
  if (!Number.isFinite(number)) return "—";
  const sign=withSign&&number>0?"+":"";
  if (["lowInr","highInr"].includes(field)) return `${sign}${formatLakh(number)}`;
  return `${sign}${Math.round(number).toLocaleString("en-IN")} sq ft`;
}

function BriefCheckCard({ value, compact=false }) {
  const check=briefCheckRecord(value);
  const tone=check.label==="Enough to explore"?"explore":check.label==="Programme under tension"?"tension":"facts";
  return <section className={`brief-check brief-check--${tone} ${compact?"brief-check--compact":""}`} aria-labelledby={compact?undefined:"brief-check-title"}>
    <div className="brief-check__status"><span className="kicker">Brief Check · current evidence</span><div><SealCheck aria-hidden="true"/><strong>{check.label}</strong></div></div>
    <div className="brief-check__reading"><h2 id={compact?undefined:"brief-check-title"}>{check.headline}</h2><p>{check.summary}</p></div>
    {!compact&&(check.missingFields.length>0||check.tensions.length>0||check.professionalChecks.length>0)&&<div className="brief-check__notes">
      {check.missingFields.length>0&&<section><span>Key facts to add</span><ul>{check.missingFields.map((item,index)=><li key={item.field||index}><strong>{item.label||briefFieldLabels[item.field]||"Missing fact"}</strong><small>{item.prompt||"Confirm this before relying on the planning range."}</small></li>)}</ul></section>}
      {check.tensions.length>0&&<section><span>Programme tensions</span><ul>{check.tensions.map((item,index)=><li key={item.code||index}><strong>{item.label||"Needs discussion"}</strong><small>{item.detail||"Test this with a licensed local professional."}</small></li>)}</ul></section>}
      {check.professionalChecks.length>0&&<section><span>Take to a professional</span><ul>{check.professionalChecks.map((item,index)=><li key={`${item}-${index}`}><strong>{item}</strong></li>)}</ul></section>}
    </div>}
  </section>;
}

function BriefEditor({ form, onChange, disabled=false }) {
  const update=(field,value)=>onChange({...form,[field]:value});
  return <div className="brief-editor">
    <fieldset disabled={disabled}><legend><span>01</span><strong>Measured ground</strong><small>Change facts only when you have a better source.</small></legend><div className="brief-editor__grid">
      <label>Plot width <span>feet</span><input required type="number" min="10" max="500" inputMode="decimal" value={form.width} onChange={event=>update("width",event.target.value===""?"":Number(event.target.value))}/></label>
      <label>Plot length <span>feet</span><input required type="number" min="10" max="500" inputMode="decimal" value={form.length} onChange={event=>update("length",event.target.value===""?"":Number(event.target.value))}/></label>
      <label>City<select required value={form.city} onChange={event=>update("city",event.target.value)}><option value="" disabled>Not stated</option>{Object.keys(cityFactors).map(city=><option key={city}>{city}</option>)}</select></label>
      <label>Road-facing side<select required value={form.facing} onChange={event=>update("facing",event.target.value)}><option value="" disabled>Not stated</option>{["North","East","South","West"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Road width <span>feet · optional</span><input type="number" min="6" max="200" inputMode="decimal" value={form.roadWidthFt??""} placeholder="Not sure" onChange={event=>update("roadWidthFt",event.target.value===""?null:Number(event.target.value))}/></label>
      <StructuredSelect label="Plot shape" value={form.plotShape} options={plotShapeOptions} onChange={value=>update("plotShape",value)}/>
    </div></fieldset>
    <fieldset disabled={disabled}><legend><span>02</span><strong>Household programme</strong><small>Describe need, not a promised layout.</small></legend><div className="brief-editor__grid">
      <label>Floors<select required value={form.floors} onChange={event=>update("floors",event.target.value)}><option value="" disabled>Not stated</option>{["G","G+1","G+2"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Bedrooms<select required value={String(form.bedrooms)} onChange={event=>update("bedrooms",event.target.value==="5+"?"5+":Number(event.target.value))}><option value="" disabled>Not stated</option>{!["2","3","4","5+"].includes(String(form.bedrooms))&&form.bedrooms!==""&&<option value={String(form.bedrooms)}>{form.bedrooms} · saved value</option>}{["2","3","4","5+"].map(value=><option value={value} key={value}>{value}</option>)}</select></label>
      <label>Bathrooms <span>optional</span><select value={form.bathrooms??""} onChange={event=>update("bathrooms",event.target.value===""?null:Number(event.target.value))}><option value="">Not sure</option>{Array.from({length:12},(_,index)=>index+1).map(value=><option value={value} key={value}>{value}</option>)}</select></label>
      <label>Parking<select required value={form.parking} onChange={event=>update("parking",event.target.value)}><option value="" disabled>Not stated</option>{["None","1 car","2 cars"].map(value=><option key={value}>{value}</option>)}</select></label>
    </div></fieldset>
    <fieldset disabled={disabled}><legend><span>03</span><strong>Intent and limits</strong><small>Unknown is better than an invented requirement.</small></legend><div className="brief-editor__grid">
      <StructuredSelect label="Accessibility" value={form.accessibility} options={accessibilityOptions} onChange={value=>update("accessibility",value)}/>
      <StructuredSelect label="Future use" value={form.futureUse} options={futureUseOptions} onChange={value=>update("futureUse",value)}/>
      <label>Working budget <span>₹ lakh · optional</span><input type="number" min="5" max="10000" inputMode="decimal" value={form.budgetLakh??""} placeholder="Not sure" onChange={event=>update("budgetLakh",event.target.value===""?null:Number(event.target.value))}/></label>
      <label>Finish<select required value={form.quality} onChange={event=>update("quality",event.target.value)}><option value="" disabled>Not stated</option>{["Essential","Signature","Premium","Luxury"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Exterior direction<select required value={form.style} onChange={event=>update("style",event.target.value)}><option value="" disabled>Not stated</option>{!["Warm modern","Contemporary","Traditional Indian","Tropical modern","Minimal"].includes(String(form.style))&&form.style!==""&&<option value={form.style}>{form.style} · saved value</option>}{["Warm modern","Contemporary","Traditional Indian","Tropical modern","Minimal"].map(value=><option key={value}>{value}</option>)}</select></label>
    </div></fieldset>
  </div>;
}

function ChangeStudy({ value }) {
  const study=homeObject(value);
  const fields=Array.isArray(study.changedFields)?study.changedFields:[];
  const deltas=homeObject(study.estimateDeltas);
  const consequences=Array.isArray(study.consequences)?study.consequences:[];
  const status=homeObject(study.status);
  return <section className="change-study" aria-labelledby="change-study-title">
    <header><div><span className="kicker">Change Study · preview only</span><h2 id="change-study-title" tabIndex="-1">See the consequence before the commitment.</h2></div><p>Nothing below changes the saved project until you explicitly confirm.</p></header>
    <div className="change-study__status"><span>Brief Check</span><strong>{briefStatusLabel(status.before)}</strong><ArrowRight aria-hidden="true"/><strong>{briefStatusLabel(status.after)}</strong>{status.changed===false&&<small>Status unchanged</small>}</div>
    <div className="change-study__body">
      <section className="change-study__fields"><span className="change-study__eyebrow">Facts changed · {fields.length}</span>{fields.length?<dl>{fields.map((item,index)=><div key={item.field||index}><dt>{item.label||briefFieldLabels[item.field]||"Project fact"}</dt><dd><span>{briefDisplayValue(item.field,item.before)}</span><ArrowRight aria-hidden="true"/><strong>{briefDisplayValue(item.field,item.after)}</strong></dd></div>)}</dl>:<p>No material field change was returned.</p>}</section>
      <section className="change-study__deltas"><span className="change-study__eyebrow">Planning-range movement</span><div>{[["plotSqft","Plot area"],["builtUpSqft","Likely built-up"],["lowInr","Range · low"],["highInr","Range · high"]].map(([field,label])=>{const delta=homeObject(deltas[field]);return <article key={field}><span>{label}</span><strong>{briefDeltaValue(field,delta.after)}</strong><small>{briefDeltaValue(field,delta.delta,true)} change</small></article>})}</div></section>
    </div>
    <section className="change-study__consequences"><span className="change-study__eyebrow">What becomes historical</span>{consequences.length?<ul>{consequences.map((item,index)=><li key={item.code||index}><WarningCircle aria-hidden="true"/><div><strong>{item.label||"Evidence needs refresh"}</strong><p>{item.detail||"The earlier record remains evidence but is no longer current."}</p></div></li>)}</ul>:<p>The server reported no downstream evidence consequence.</p>}</section>
  </section>;
}

function BriefHistory({ projectId, revisions, historyStartsAtRevision, pagination, details, expanded, onToggle, onLoadMore, loadingMore }) {
  return <section className="brief-history" aria-labelledby="brief-history-title">
    <header><div><span className="kicker">Immutable brief history</span><h2 id="brief-history-title">What the project knew, when.</h2></div><p>History begins at revision {historyStartsAtRevision||revisions.at(-1)?.revision||1}. Earlier states are not reconstructed or implied.</p></header>
    {revisions.length===0?<div className="brief-history__empty"><Stack/><h3>No recorded revision snapshot yet.</h3><p>The current brief remains available above. History will appear only from a saved server record.</p></div>:<ol className="brief-history__list">{revisions.map(item=>{
      const number=Number(item.revision);
      const open=expanded===number;
      const detail=details[number];
      const summary=homeObject(item.inputSummary);
      const check=briefCheckRecord(item.briefCheck);
      return <li key={number} className={item.current?"brief-history__item brief-history__item--current":"brief-history__item"}>
        <button className="brief-history__summary" aria-expanded={open} aria-controls={`brief-revision-${number}`} onClick={()=>onToggle(number)}><span className="brief-history__folio">{String(number).padStart(2,"0")}</span><div><small>{item.current?"Current brief":"Historical evidence"} · {formatDate(item.createdAt)}</small><h3>Revision {number}</h3><p>{summary.label||summary.summary||[summary.width&&summary.length?`${summary.width} × ${summary.length} ft`:null,summary.city,summary.floors].filter(Boolean).join(" · ")||check.label}</p></div><span className={`brief-history__badge brief-history__badge--${check.label.toLowerCase().replaceAll(" ","-")}`}>{check.label}</span><Plus aria-hidden="true"/></button>
        {open&&<div id={`brief-revision-${number}`} className="brief-history__detail">
          {!detail&&<p className="loading-line" role="status">Opening the saved snapshot…</p>}
          {detail?.error&&<p className="form-error" role="alert">{detail.error}</p>}
          {detail?.revision&&<><div className="brief-history__facts">{briefEditableFields.map(field=>Object.hasOwn(detail.revision.input||{},field)?<div key={field}><span>{briefFieldLabels[field]}</span><strong>{briefDisplayValue(field,detail.revision.input[field])}</strong></div>:null)}</div>{detail.changeStudy?.changedFields?.length>0&&<div className="brief-history__changes"><span>Changes recorded in this revision</span><ul>{detail.changeStudy.changedFields.map((change,index)=><li key={change.field||index}><strong>{change.label||briefFieldLabels[change.field]}</strong><span>{briefDisplayValue(change.field,change.before)} → {briefDisplayValue(change.field,change.after)}</span></li>)}</ul></div>}<div className="brief-history__actions">{detail.revision.report?.available&&<button className="outline-button" onClick={()=>route(`/report/${encodeURIComponent(projectId)}/revision/${number}`)}><FileText/> Open saved report</button>}<small><LockKey/> Read-only evidence. This release does not restore an earlier brief.</small></div></>}
        </div>}
      </li>;
    })}</ol>}
    {pagination?.hasMore&&<button className="outline-button brief-history__more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore?"Loading earlier revisions…":"Load earlier revisions"} <ArrowRight/></button>}
  </section>;
}

function BriefPage({ projectId }) {
  const [state,setState]=useState({phase:"loading",project:null,check:null,error:""});
  const [form,setForm]=useState(briefFormValue());
  const [baseInput,setBaseInput]=useState({});
  const [revisions,setRevisions]=useState([]);
  const [pagination,setPagination]=useState(null);
  const [historyStartsAtRevision,setHistoryStartsAtRevision]=useState(1);
  const [preview,setPreview]=useState(null);
  const [previewPatch,setPreviewPatch]=useState(null);
  const [acceptedImpact,setAcceptedImpact]=useState(false);
  const [working,setWorking]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [details,setDetails]=useState({});
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [saveState,setSaveState]=useState("idle");
  const previewHeading=useRef(null);
  const savedStatus=useRef(null);
  const dirty=Object.keys(briefInputPatch(baseInput,form)).length>0;
  const project=state.project||{};
  const archived=project.status==="archived";
  const revisionLocked=working||saveState==="unknown"||saveState==="conflict";
  const revisionNumber=Number(project.inputRevision||revisions.find(item=>item.current)?.revision||1);

  async function loadHistory({signal,beforeRevision,append=false}={}) {
    const query=new URLSearchParams({limit:"20"});
    if(beforeRevision)query.set("beforeRevision",String(beforeRevision));
    const result=await api(`/api/projects/${encodeURIComponent(projectId)}/revisions?${query}`,{signal});
    if(signal?.aborted)return result;
    const nextProject=homeObject(result.project);
    const nextRevisions=Array.isArray(result.revisions)?result.revisions:[];
    setState({phase:"ready",project:nextProject,check:result.briefCheck,error:""});
    setRevisions(current=>append?[...current,...nextRevisions.filter(item=>!current.some(existing=>Number(existing.revision)===Number(item.revision)))]:nextRevisions);
    setPagination(homeObject(result.pagination));
    setHistoryStartsAtRevision(Number(result.historyStartsAtRevision||nextRevisions.at(-1)?.revision||1));
    if(!append){const nextInput=homeObject(nextProject.input);setBaseInput(nextInput);setForm(briefFormValue(nextInput));}
    return result;
  }

  useEffect(()=>{const controller=new AbortController();loadHistory({signal:controller.signal}).catch(err=>{if(controller.signal.aborted)return;if(err instanceof ApiError&&err.status===401){route("/login");return}if(err instanceof ApiError&&err.status===404){setState({phase:"missing",project:null,check:null,error:""});return}setState({phase:"error",project:null,check:null,error:err?.message||"The brief could not be opened."})});return()=>controller.abort()},[projectId]);
  useEffect(()=>{if(!dirty&&!preview)return undefined;const warn=event=>{event.preventDefault();event.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[dirty,preview]);

  function changeForm(next) { setForm(next);setPreview(null);setPreviewPatch(null);setAcceptedImpact(false);setSaveState("idle");setMessage("");setError(""); }

  async function previewRevision(event) {
    event.preventDefault();
    if(archived)return;
    const patch=briefInputPatch(baseInput,form);
    if(!Object.keys(patch).length){setError("Change at least one stated fact before previewing its impact.");return}
    setWorking(true);setError("");setMessage("");setSaveState("idle");
    try{
      const result=await api(`/api/projects/${encodeURIComponent(projectId)}/revisions/preview`,{method:"POST",body:{expectedInputRevision:revisionNumber,input:patch}});
      setPreview(result);setPreviewPatch(patch);setAcceptedImpact(false);
      window.requestAnimationFrame(()=>{previewHeading.current=document.getElementById("change-study-title");previewHeading.current?.focus({preventScroll:true});previewHeading.current?.scrollIntoView({behavior:"smooth",block:"start"})});
    }catch(err){if(err instanceof ApiError&&err.status===409&&err.payload?.code==="project_revision_conflict"){setSaveState("conflict");setError("This brief changed in another session. Reload the latest revision before preparing a new Change Study.");}else setError(err?.message||"The Change Study could not be prepared.");}
    finally{setWorking(false)}
  }

  async function commitRevision() {
    if(archived||!preview||!previewPatch||!acceptedImpact)return;
    const baseRevision=Number(preview.baseRevision||revisionNumber);
    const storageKey=`grihagrid.briefRevision.${projectId}.${baseRevision}`;
    const requestStorageKey=`${storageKey}.request`;
    const requestIdentity=JSON.stringify({expectedInputRevision:baseRevision,input:previewPatch});
    const retainedIdentity=sessionStorage.getItem(requestStorageKey);
    if(retainedIdentity&&retainedIdentity!==requestIdentity){
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(requestStorageKey);
    }
    const key=idempotencyKey(storageKey);
    sessionStorage.setItem(requestStorageKey,requestIdentity);
    setWorking(true);setError("");setMessage("");setSaveState("saving");
    try{
      const result=await api(`/api/projects/${encodeURIComponent(projectId)}/revisions`,{method:"POST",headers:{"Idempotency-Key":key},body:{expectedInputRevision:baseRevision,input:previewPatch,acceptedImpact:true}});
      sessionStorage.removeItem(storageKey);sessionStorage.removeItem(requestStorageKey);
      setPreview(null);setPreviewPatch(null);setAcceptedImpact(false);setSaveState("saved");
      await loadHistory();
      setMessage(result.idempotentReplay?"The saved revision was confirmed after a safe retry. Project Home now reflects the current record.":`Revision ${result.revision?.revision||result.project?.inputRevision||baseRevision+1} is saved. Refresh its planning report before relying on later decisions.`);
      window.requestAnimationFrame(()=>savedStatus.current?.focus());
    }catch(err){
      const code=err?.payload?.code;
      if(err instanceof ApiError&&err.status===409&&code==="project_revision_conflict"){
        sessionStorage.removeItem(storageKey);sessionStorage.removeItem(requestStorageKey);setSaveState("conflict");setError("A newer revision won the race. Your preview was not applied; reload the current brief before trying again.");
      }else if(err instanceof ApiError&&err.status===409&&code==="idempotency_conflict"){
        sessionStorage.removeItem(storageKey);sessionStorage.removeItem(requestStorageKey);setSaveState("conflict");setError("This safe-save key belongs to a different change. Reload before creating a fresh revision.");
      }else if(!(err instanceof ApiError)||err.status===408||err.status>=500){
        setSaveState("unknown");setError("The save outcome could not be confirmed. Do not create another change yet; retry this exact save safely or reload the latest history.");
      }else if(err.status===429){setSaveState("rate_limited");setError("Too many revision attempts were made. Wait briefly, then retry this exact save safely.");}
      else{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(requestStorageKey);setSaveState("idle");setError(err?.message||"The revision could not be saved.");}
    }finally{setWorking(false)}
  }

  async function reloadLatest() {
    const ambiguousBase=Number(preview?.baseRevision||revisionNumber);
    const storageKey=`grihagrid.briefRevision.${projectId}.${ambiguousBase}`;
    setWorking(true);setError("");
    try{const result=await loadHistory();const latestRevision=Number(result?.project?.inputRevision||result?.revisions?.[0]?.revision||ambiguousBase);sessionStorage.removeItem(storageKey);sessionStorage.removeItem(`${storageKey}.request`);setPreview(null);setPreviewPatch(null);setAcceptedImpact(false);setSaveState("idle");setMessage(latestRevision>ambiguousBase?`Revision ${latestRevision} is present in saved history. Review that confirmed record before making another change.`:"The saved revision did not advance. The uncertain save key was cleared; review the latest brief before preparing another change.");}
    catch(err){setError(err?.message||"The latest brief could not be loaded.");}
    finally{setWorking(false)}
  }

  async function toggleRevision(number) {
    if(expanded===number){setExpanded(null);return}
    setExpanded(number);
    if(details[number])return;
    try{const result=await api(`/api/projects/${encodeURIComponent(projectId)}/revisions/${number}`);setDetails(current=>({...current,[number]:result}));}
    catch(err){setDetails(current=>({...current,[number]:{error:err?.message||"This revision could not be opened."}}));}
  }

  async function loadMore() {
    const before=pagination?.nextBeforeRevision;
    if(!before)return;
    setLoadingMore(true);setError("");
    try{await loadHistory({beforeRevision:before,append:true})}catch(err){setError(err?.message||"Earlier revisions could not be loaded.")}finally{setLoadingMore(false)}
  }

  if(state.phase!=="ready")return <main className="brief-page brief-page--state"><header className="brief-page__topbar"><button onClick={()=>route(`/projects/${encodeURIComponent(projectId)}`)}><ArrowLeft/> Project home</button><Brand inverted/><span><LockKey/> Private brief</span></header><section className="brief-page__state-panel" aria-busy={state.phase==="loading"}>{state.phase==="loading"?<><Stack/><span className="kicker">Brief Check</span><h1>Reading the project record…</h1><p role="status">Opening the current facts and immutable revision history without changing either.</p></>:state.phase==="missing"?<><Compass/><span className="kicker">Brief unavailable</span><h1>This private brief cannot be opened.</h1><p>The project may no longer exist, or this account may not have access to it.</p><button className="copper-button" onClick={()=>route("/dashboard")}>Back to my projects <ArrowRight/></button></>:<><WarningCircle/><span className="kicker">Brief temporarily unavailable</span><h1>Your project remains unchanged.</h1><p role="alert">{state.error}</p><button className="copper-button" onClick={()=>window.location.reload()}>Try again <ArrowClockwise/></button></>}</section></main>;

  return <main className={`brief-page ${archived?"brief-page--archived":""}`}>
    <header className="brief-page__topbar"><button onClick={()=>route(`/projects/${encodeURIComponent(projectId)}`)}><ArrowLeft/> Project home</button><Brand inverted/><span><LockKey/> {archived?"Archived · read only":"Private working brief"}</span></header>
    <section className="brief-page__masthead"><div><span className="kicker">Brief Check · Revision {revisionNumber}</span><h1>Strengthen the facts.<br/><i>Then study the change.</i></h1><p>{archived?"This archived brief and its saved history remain readable. Editing, previewing and saving are closed.":"Correct what the family now knows. GrihaGrid will show the evidence impact before it saves a new revision."}</p></div><div className="brief-page__index" aria-hidden="true"><span>Current record</span><strong>{String(revisionNumber).padStart(2,"0")}</strong><small>{revisions.length} revision{revisions.length===1?"":"s"} loaded</small></div></section>
    <BriefCheckCard value={state.check}/>
    {!archived&&<section className="brief-workspace" aria-labelledby="brief-editor-title"><header><div><span className="kicker">Change the source brief</span><h2 id="brief-editor-title">State only what changed.</h2></div><p>Preview is read-only. Saving creates a forward-only revision; it never rewrites purchased or historical evidence.</p></header><form onSubmit={previewRevision}><BriefEditor form={form} onChange={changeForm} disabled={revisionLocked}/>{error&&<p className="form-error brief-workspace__message" role="alert">{error}</p>}{message&&<p ref={savedStatus} tabIndex="-1" className="success-message brief-workspace__message" role="status"><CheckCircle/>{message}</p>}<div className="brief-workspace__actions"><span>{dirty?`${Object.keys(briefInputPatch(baseInput,form)).length} stated field${Object.keys(briefInputPatch(baseInput,form)).length===1?"":"s"} changed`:"No unsaved change"}</span>{saveState==="conflict"||saveState==="unknown"?<button type="button" className="outline-button" disabled={working} onClick={reloadLatest}><ArrowClockwise/> Reload latest record</button>:null}<button type="submit" className="copper-button" disabled={revisionLocked||!dirty}>{working&&saveState!=="saving"?"Preparing study…":"Preview impact"} <ArrowRight/></button></div></form></section>}
    {preview&&<><ChangeStudy value={preview.changeStudy}/><section className="change-confirm" aria-labelledby="change-confirm-title"><div><span className="kicker">Explicit commitment</span><h2 id="change-confirm-title">Save revision {preview.proposedRevision||revisionNumber+1}?</h2><p>The prior brief stays in history. The current planning report, AI reading, comparison, choice, and Family evidence may require a refresh exactly as listed above.</p></div><label><input type="checkbox" disabled={saveState==="conflict"} checked={acceptedImpact} onChange={event=>setAcceptedImpact(event.target.checked)}/><span>I reviewed the Change Study and understand which evidence will become historical.</span></label>{saveState==="unknown"&&<div className="change-confirm__unknown" role="alert"><WarningCircle/><p>The first response was ambiguous. Retrying uses the same key and cannot intentionally create a second revision. Reload the record before making a different change.</p></div>}<div>{saveState!=="unknown"&&saveState!=="conflict"&&<button className="outline-button" disabled={working} onClick={()=>{setPreview(null);setPreviewPatch(null);setAcceptedImpact(false);setSaveState("idle");setError("")}}>Keep editing</button>}<button className="copper-button" disabled={working||!acceptedImpact||saveState==="conflict"} onClick={commitRevision}>{working?"Saving safely…":saveState==="unknown"||saveState==="rate_limited"?"Retry exact save safely":"Confirm & save revision"} <ArrowRight/></button></div></section></>}
    {archived&&<section className="brief-readonly-note" role="status"><LockKey/><div><strong>Archived brief · evidence only</strong><p>No field can be edited, previewed, restored or saved while the project is archived. Saved reports open only when that exact historical artifact exists.</p></div></section>}
    <BriefHistory projectId={projectId} revisions={revisions} historyStartsAtRevision={historyStartsAtRevision} pagination={pagination} details={details} expanded={expanded} onToggle={toggleRevision} onLoadMore={loadMore} loadingMore={loadingMore}/>
    <section className="brief-page__boundary"><ShieldCheck/><p><strong>Brief Check is not professional site validation.</strong> It identifies missing facts and programme pressure from stated inputs. A measured survey and licensed local professionals must verify land, access, bylaws, design, structure and construction decisions.</p></section>
  </main>;
}

function listOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function scenarioSeed(project, index) {
  const input = project?.input || {};
  const originalFloors = input.floors || "G+1";
  const alternatives = { G: "G+1", "G+1": "G+2", "G+2": "G+1" };
  const bedroomNumber = Number.parseInt(input.bedrooms, 10) || 3;
  return {
    id: index === 0 ? "option_a" : "option_b",
    key: index === 0 ? "A" : "B",
    label: index === 0 ? "Balanced brief" : "Space-forward brief",
    floors: index === 0 ? originalFloors : alternatives[originalFloors],
    bedrooms: index === 0 ? Math.min(10, bedroomNumber) : Math.min(10, bedroomNumber + 1),
    parking: input.parking === true || (!['none','false','0',''].includes(String(input.parking ?? '').trim().toLowerCase())),
    quality: input.quality || "Signature",
    notes: "",
  };
}

function normalizeScenario(source, fallback) {
  const input = source?.input || source?.scenario || source || {};
  const metrics = { ...(source?.estimate || {}), ...(source?.metrics || source?.output || source?.result || {}) };
  return {
    ...fallback,
    ...input,
    id: source?.id || input.id || fallback.id,
    key: source?.key || input.key || fallback.key,
    label: source?.label || input.label || fallback.label,
    metrics,
    programme: source?.programme || null,
    report: source?.report || null,
    constraints: listOf(source?.constraints || metrics.constraints),
    assumptions: listOf(source?.assumptions || metrics.assumptions),
    tradeoffs: listOf(source?.tradeoffs || metrics.tradeoffs),
  };
}

function normalizeDecisionResponse(payload, project) {
  const envelope = payload || {};
  const source = envelope?.decisionCompare || envelope?.comparison || envelope?.decision || envelope || {};
  const seeds = [scenarioSeed(project, 0), scenarioSeed(project, 1)];
  const incoming = Array.isArray(source.scenarios) ? source.scenarios.slice(0, 2) : [];
  return {
    ...source,
    id: source.id || source.comparisonId || null,
    scenarios: seeds.map((seed, index) => normalizeScenario(incoming[index], seed)),
    selectedScenarioId: envelope.selection?.scenarioId || source.selectedScenarioId || source.chosenScenarioId || source.selection?.scenarioId || null,
    selection: envelope.selection || source.selection || null,
    entitlement: envelope.entitlement || source.entitlement || null,
    questions: listOf(source.questions || source.questionsForArchitect),
    assumptions: listOf(source.assumptions),
  };
}

function familyResponseToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function familyReceiptKey(roomId) {
  return `grihagrid.familyResponse.${String(roomId || "").replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 96)}`;
}

function readFamilyReceipt(roomId) {
  if (!roomId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(familyReceiptKey(roomId)) || "null");
    return typeof value?.token === "string" && value.token.length >= 40 ? value : null;
  } catch {
    return null;
  }
}

function writeFamilyReceipt(roomId, receipt) {
  if (!roomId) return false;
  try {
    localStorage.setItem(familyReceiptKey(roomId), JSON.stringify(receipt));
    return true;
  } catch {
    return false;
  }
}

function clearFamilyReceipt(roomId) {
  if (!roomId) return;
  try { localStorage.removeItem(familyReceiptKey(roomId)); } catch { /* storage is optional */ }
}

function familyCount(record, keys) {
  if (!record || typeof record !== "object") return 0;
  for (const key of keys) {
    const number = Number(record[key]);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function normalizeFamilyRoom(value) {
  const room = value && typeof value === "object" ? value : {};
  return {
    ...room,
    id: room.id || room.roomId || null,
    comparisonId: room.comparisonId || room.comparison_id || null,
    comparisonVersion: Number(room.comparisonVersion || room.comparison_version || room.version || 0) || null,
    expiresAt: room.expiresAt || room.expires_at || null,
    revokedAt: room.revokedAt || room.revoked_at || null,
    responseCount: Number(room.responseCount || room.response_count || 0),
    accessCount: Number(room.accessCount || room.access_count || 0),
    active: room.active !== false && !room.revokedAt && !room.revoked_at,
  };
}

function familyRoomState(room) {
  if (room.revokedAt) return "Revoked";
  if (!room.active) return "Expired";
  return "Active";
}

function scenarioMath(project, scenario) {
  const plot = project?.input || {};
  const metrics = scenario.metrics || {};
  const builtUp = Number(metrics.builtUpSqft || metrics.areaSqft || metrics.area || 0)
    || Math.round(Number(plot.width || 30) * Number(plot.length || 50) * (floorFactors[scenario.floors] || 1.22));
  const midpoint = builtUp * (qualityRates[scenario.quality] || qualityRates.Signature) * (cityFactors[plot.city] || cityFactors.Other);
  return {
    builtUp,
    low: Number(metrics.lowInr || metrics.costLowInr || metrics.cost?.lowInr || 0) || Math.round(midpoint * .92),
    high: Number(metrics.highInr || metrics.costHighInr || metrics.cost?.highInr || 0) || Math.round(midpoint * 1.1),
  };
}

function ScenarioEditor({ scenario, index, onChange, disabled }) {
  const update = (key, value) => onChange(index, { ...scenario, [key]: value });
  return <fieldset className="scenario-editor" disabled={disabled}>
    <legend><span>Option {scenario.key || (index ? "B" : "A")}</span><strong>{scenario.label || `Option ${index + 1}`}</strong></legend>
    <label className="scenario-editor__name">Name this direction<input required maxLength="60" value={scenario.label} onChange={event=>update('label',event.target.value)} placeholder={index ? 'Space-forward brief' : 'Balanced brief'}/></label>
    <div className="scenario-editor__grid">
      <label>Floors<select value={scenario.floors} onChange={event=>update('floors',event.target.value)}>{['G','G+1','G+2'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Bedrooms<select value={scenario.bedrooms} onChange={event=>update('bedrooms',Number(event.target.value))}>{[1,2,3,4,5,6,7,8,9,10].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Parking<select value={scenario.parking?'yes':'none'} onChange={event=>update('parking',event.target.value==='yes')}><option value="none">None</option><option value="yes">Required</option></select></label>
      <label>Finish<select value={scenario.quality} onChange={event=>update('quality',event.target.value)}>{['Essential','Signature','Premium','Luxury'].map(value=><option key={value}>{value}</option>)}</select></label>
    </div>
    <label>Notes for this option <span>{scenario.notes.length}/400</span><textarea rows="3" maxLength="400" value={scenario.notes} onChange={event=>update('notes',event.target.value)} placeholder="What must this option protect—or what are you willing to trade?"/></label>
  </fieldset>;
}

function ComparisonList({ items, fallback }) {
  const visible = listOf(items);
  return <ul>{(visible.length ? visible : [fallback]).map((item,index)=><li key={`${item}-${index}`}><CheckCircle aria-hidden="true"/><span>{item}</span></li>)}</ul>;
}

function recommendationFor(comparison, scenarios) {
  const value = comparison?.recommendation;
  if (typeof value === "string") return { headline: value, body: "Use the assumptions and trade-offs below to challenge this direction with your architect.", scenarioId: null };
  if (value && typeof value === "object") return {
    headline: value.headline || value.title || value.summary || "A directional recommendation is ready.",
    body: value.rationale || value.body || value.reason || "Use the assumptions and trade-offs below to challenge this direction with your architect.",
    scenarioId: value.scenarioId || value.recommendedScenarioId || null,
  };
  const first = scenarios[0];
  return { headline: `${first.label} is the lower-commitment starting point.`, body: "This preview favours the option closest to your original brief. Save both options for a traceable recommendation.", scenarioId: first.id };
}

function DecisionDocument({ comparison, project, onChoose, choosing = false, readonly = false, artifact = false }) {
  const scenarios = comparison.scenarios || [];
  if (scenarios.length !== 2) return <div className="decision-empty"><WarningCircle/><h2>Two complete options are required.</h2><p>Return to the editor and save exactly two scenarios before making a decision.</p></div>;
  const calculations = scenarios.map(scenario=>scenarioMath(project,scenario));
  const recommendation = recommendationFor(comparison, scenarios);
  const recommendationScenario = scenarios.find(item=>item.id===recommendation.scenarioId) || scenarios[0];
  const selectedId = comparison.selectedScenarioId;
  const selectionLocked = Boolean(comparison.selection?.lockedAt || comparison.entitlement?.active);
  const CoverTitle = artifact ? 'h1' : 'h2';
  const plotWidth = project?.input?.width || comparison.plot?.width;
  const plotLength = project?.input?.length || comparison.plot?.length;
  const plotCity = project?.input?.city || comparison.plot?.city;
  const coverContext = plotWidth && plotLength
    ? `${plotWidth} × ${plotLength} ft · ${plotCity || "India"}`
    : "Read-only purchased comparison";
  const questions = comparison.questions.length ? comparison.questions : [
    "Which local setbacks or approval rules change the usable envelope for these two options?",
    "Which option gives the cleaner structural grid and lower long-term maintenance risk?",
    "What must be measured on site before either cost range can be tightened?",
    "Where will parking, stair width and wet-area alignment create the hardest compromise?",
    "Which choice can be simplified without losing the family’s stated priority?",
  ];
  return <article className={`decision-document ${artifact?'decision-document--artifact':''}`} aria-label="Decision Compare document">
    <header className="decision-document__cover">
      <div><span className="kicker">Decision Compare · {artifact?'Purchased artifact':'Working comparison'}</span><CoverTitle>{project?.name || comparison.projectName || "Two ways to shape this home."}</CoverTitle><p>{coverContext}</p></div>
      <div className="decision-document__folio" aria-hidden="true"><span>DC</span><strong>{String(comparison.version || 1).padStart(2,'0')}</strong></div>
    </header>
    <section className="decision-recommendation" aria-labelledby="recommendation-title"><span><SealCheck/> Directional recommendation</span><h2 id="recommendation-title">{recommendation.headline}</h2><p>{recommendation.body}</p><small>Leans toward {recommendationScenario.label} · validate locally before detailed design</small></section>
    <section className="comparison-matrix" aria-label="Side-by-side scenario comparison">
      <div className="comparison-matrix__head"><span>Decision measure</span>{scenarios.map((scenario,index)=><div key={scenario.id}><small>Option {scenario.key || (index?'B':'A')}</small><h2>{scenario.label}</h2>{selectedId===scenario.id&&<span className="chosen-mark"><Check/> Chosen direction</span>}</div>)}</div>
      <div className="comparison-row"><h3>Area</h3>{calculations.map((value,index)=><div key={scenarios[index].id}><strong>{value.builtUp.toLocaleString('en-IN')} sq ft</strong><small>Indicative built-up</small></div>)}</div>
      <div className="comparison-row"><h3>Cost range</h3>{calculations.map((value,index)=><div key={scenarios[index].id}><strong>{formatLakh(value.low)}–{formatLakh(value.high)}</strong><small>{scenarios[index].quality} finish</small></div>)}</div>
      <div className="comparison-row"><h3>Programme</h3>{scenarios.map(scenario=><div key={scenario.id}><strong>{scenario.programme?.summary||`${scenario.floors} · ${scenario.bedrooms} bedrooms`}</strong><small>{scenario.programme?.detail||`${scenario.parking?'Parking required':'No parking'} · ${scenario.quality} finish`}</small></div>)}</div>
      <div className="comparison-row comparison-row--list"><h3>Constraints</h3>{scenarios.map(scenario=><div key={scenario.id}><ComparisonList items={scenario.constraints} fallback="Setbacks, circulation and site conditions need local verification."/></div>)}</div>
      <div className="comparison-row comparison-row--list"><h3>Assumptions</h3>{scenarios.map(scenario=><div key={scenario.id}><ComparisonList items={scenario.assumptions.length?scenario.assumptions:comparison.assumptions} fallback="Plot dimensions, city factor and chosen finish remain indicative inputs."/></div>)}</div>
      <div className="comparison-row comparison-row--list"><h3>Trade-offs</h3>{scenarios.map((scenario,index)=><div key={scenario.id}><ComparisonList items={scenario.tradeoffs} fallback={index?"More programme may increase cost, circulation and approval complexity.":"Tighter programme protects budget but leaves less room for future expansion."}/></div>)}</div>
      {!readonly&&<div className="comparison-row comparison-row--actions"><h3>Your decision</h3>{scenarios.map(scenario=><div key={scenario.id}><button className={selectedId===scenario.id?'selected':''} disabled={choosing||selectionLocked||selectedId===scenario.id} onClick={()=>onChoose?.(scenario)}>{selectedId===scenario.id?<><Check/> Chosen</>:selectedId?<>Choose instead <ArrowRight/></>:<>Choose {scenario.label} <ArrowRight/></>}</button></div>)}</div>}
    </section>
    <section className="decision-questions"><div><span className="kicker">Take into the room</span><h2>Five questions for your architect.</h2></div><ol>{questions.slice(0,5).map((question,index)=><li key={`${question}-${index}`}><span>{String(index+1).padStart(2,'0')}</span><p>{question}</p></li>)}</ol></section>
    <footer className="decision-boundary"><ShieldCheck/><p><strong>A decision aid—not a construction document.</strong> Areas, costs, constraints and recommendations are indicative. A licensed local architect and structural engineer must validate site measurements, bylaws, design and safety.</p></footer>
  </article>;
}

function DecisionPurchasePanel({ projectId, comparison, orders, onOrdersChange, readonly = false }) {
  const [catalog,setCatalog]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [acceptedCheckoutTerms,setAcceptedCheckoutTerms]=useState(false);
  useEffect(()=>{if(readonly){setCatalog([]);return undefined}let active=true;api('/api/commerce/catalog').then(result=>{if(active)setCatalog(result.plans||[])}).catch(()=>{if(active)setCatalog([])});return()=>{active=false}},[readonly]);
  const plan = catalog.find(item=>decisionPlanIds.includes(item.id)) || catalog.find(item=>/decision\s*compare/i.test(item.label||""));
  const productOrder = orders.find(item=>decisionPlanIds.includes(item.plan) || /decision\s*compare/i.test(item.planLabel||""));
  const order = comparison.entitlement?.orderId ? orders.find(item=>item.id===comparison.entitlement.orderId) : productOrder;
  const ready = Boolean(comparison.entitlement?.active) && order?.status==='paid' && order?.fulfillment?.status==='ready';
  const earlierPurchase = productOrder?.status==='paid' && !comparison.entitlement?.active;
  async function checkout(){
    if(readonly||!plan?.acceptingOrders||!comparison.selectedScenarioId||!acceptedCheckoutTerms)return;
    setBusy(true);setError("");
    try{
      const storageKey=`grihagrid.checkout.${projectId}.${plan.id}`;
      const key=idempotencyKey(storageKey);
      const result=await api(`/api/projects/${projectId}/orders`,{method:'POST',headers:{'idempotency-key':key},body:{plan:plan.id,decisionComparisonId:comparison.id,acceptedTerms:true,acceptedProfessionalBoundary:true,termsVersion:plan.termsVersion}});
      const nextOrder=result.order;
      if(!nextOrder?.id)throw new Error('Secure checkout did not return an order. Retry safely from this screen.');
      // Once the server has conclusively accepted/replayed the request, a
      // future attempt is a new checkout lifecycle. Ambiguous network failures
      // intentionally retain the key so retry cannot create a second charge.
      sessionStorage.removeItem(storageKey);
      onOrdersChange(current=>[nextOrder,...current.filter(item=>item.id!==nextOrder.id)]);
      trackEvent('decision_compare_checkout_started',{surface:'checkout',outcome:'success'});
      if(result.checkoutUrl)window.location.assign(result.checkoutUrl);
      else route(`/checkout/return?order=${encodeURIComponent(nextOrder.id)}`);
    }catch(err){
      if(err?.payload?.code==='checkout_failed')sessionStorage.removeItem(`grihagrid.checkout.${projectId}.${plan?.id}`);
      setError(err.status===503?'Checkout is closed right now. Your chosen option and free comparison remain saved; no payment was taken.':err.message);
    }finally{setBusy(false)}
  }
  if(readonly)return <section className="decision-purchase decision-purchase--archived" aria-labelledby="decision-purchase-title">
    <div><span className="kicker">Archived purchase record</span><h2 id="decision-purchase-title">Checkout is closed for this project.</h2><p>No purchase or payment flow can start or resume from an archived planning record. Existing orders and immutable artifacts remain readable.</p></div>
    <div className="decision-purchase__action">
      {order&&<span className={`order-status order-status--${order.status}`}><i/> {earlierPurchase?'Earlier comparison purchased':order.status==='paid'?(ready?'Artifact ready':'Payment confirmed'):order.status?.replaceAll('_',' ')}</span>}
      {ready&&<button className="copper-button" onClick={()=>route(`/orders/${order.id}/artifact`)}>Open purchased artifact <ArrowRight/></button>}
      {earlierPurchase&&<button className="copper-button" onClick={()=>route(`/orders/${productOrder.id}/artifact`)}>Open purchased version <ArrowRight/></button>}
      {!ready&&!earlierPurchase&&<small>{order?'This order remains in history, but checkout controls are unavailable while the project is archived.':'No purchased Decision Compare is attached to this project.'}</small>}
      <button className="underlined-action" onClick={()=>route('/orders')}>View order history</button>
    </div>
  </section>;
  return <section className="decision-purchase" aria-labelledby="decision-purchase-title">
    <div><span className="kicker">Freeze the decision</span><h2 id="decision-purchase-title">Purchase this Decision Compare.</h2><p>A purchased Decision Compare preserves the two options, chosen direction, assumptions, recommendation and architect questions as one immutable artifact.</p></div>
    <div className="decision-purchase__action">
      {order&&<span className={`order-status order-status--${order.status}`}><i/> {earlierPurchase?'Earlier comparison purchased':order.status==='paid'?(ready?'Artifact ready':'Payment confirmed'):order.status?.replaceAll('_',' ')}</span>}
      {!ready&&!earlierPurchase&&!order?.checkoutUrl&&plan?.acceptingOrders&&<label className="decision-checkout-consent"><input type="checkbox" checked={acceptedCheckoutTerms} onChange={event=>setAcceptedCheckoutTerms(event.target.checked)}/><span>I accept the <a href="/terms">terms</a> and <a href="/refund">refund policy</a>, and understand this is an indicative decision aid—not architectural, structural, municipal, or construction approval.</span></label>}
      {ready?<button className="copper-button" onClick={()=>route(`/orders/${order.id}/artifact`)}>Open purchased artifact <ArrowRight/></button>:earlierPurchase?<button className="copper-button" onClick={()=>route(`/orders/${productOrder.id}/artifact`)}>Open earlier purchased version <ArrowRight/></button>:order?.checkoutUrl&&order.status==='created'?<button className="copper-button" onClick={()=>window.location.assign(order.checkoutUrl)}>Resume secure checkout <ArrowSquareOut/></button>:<button className="copper-button" disabled={busy||!comparison.selectedScenarioId||!plan?.acceptingOrders||!acceptedCheckoutTerms} onClick={checkout}>{busy?'Opening checkout…':plan?.acceptingOrders?`Purchase once · ${plan.displayPrice||`₹${(plan.amountPaise/100).toLocaleString('en-IN')}`}`:'Invited checkout not open'} {plan?.acceptingOrders&&<ArrowRight/>}</button>}
      {earlierPurchase&&<small>This newer working version is not the frozen artifact and cannot replace it.</small>}
      {!comparison.selectedScenarioId&&<small>Choose one option before purchasing.</small>}
      {!plan?.acceptingOrders&&<small>Payments fail closed until Decision Compare and the provider are explicitly enabled.</small>}
      <button className="underlined-action" onClick={()=>route('/orders')}>View order history</button>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}

function DecisionSharePanel({ projectId, comparison, orderId, canShare, readonly = false }) {
  const [shares,setShares]=useState([]);
  const [days,setDays]=useState("7");
  const [busy,setBusy]=useState(false);
  const [phase,setPhase]=useState("loading");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function load(signal){
    try{const result=await api(`/api/projects/${projectId}/decision-compare/shares`,{signal});if(!signal?.aborted){setShares(result.shares||[]);setPhase('ready')}}
    catch(err){if(signal?.aborted)return;if(err.status===404||err.status===501||err.status===503){setPhase('unavailable');return}setError(err.message);setPhase('error')}
  }
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[projectId]);
  async function createShare(){
    if(readonly)return;
    setBusy(true);setError("");setMessage("");
    try{
      const storageKey=`grihagrid.share.${projectId}.${orderId}.${days}`;
      const result=await api(`/api/projects/${projectId}/decision-compare/shares`,{method:'POST',headers:{'idempotency-key':idempotencyKey(storageKey)},body:{orderId,expiresInDays:Number(days)}});
      const share=result.share;
      setShares(current=>[share,...current.filter(item=>item.id!==share.id)]);setPhase('ready');
      sessionStorage.removeItem(storageKey);
      const url=share.url || (share.token?`${window.location.origin}/share/decision/${share.token}`:"");
      if(!url){setMessage('The link already exists, but its secret is shown only once. Revoke it and create a fresh link to copy.');return}
      try{await copyText(url);setMessage('Secure link copied. The recipient only sees this frozen comparison.')}catch{setMessage(`Link created. Copy it now: ${url}`)}
      trackEvent('decision_compare_share_created',{surface:'owner_compare',outcome:'success'});
    }catch(err){setError(err.status===503?'Secure sharing is not available yet. Nothing was made public.':err.message)}finally{setBusy(false)}
  }
  async function revoke(share){
    setBusy(true);setError("");setMessage("");
    try{await api(`/api/projects/${projectId}/decision-compare/shares/${encodeURIComponent(share.id)}`,{method:'DELETE',body:{}});setShares(current=>current.map(item=>item.id===share.id?{...item,revokedAt:new Date().toISOString(),active:false}:item));setMessage('Link revoked. Future visits are blocked.');trackEvent('decision_compare_share_revoked',{surface:'owner_compare',outcome:'success'});}
    catch(err){setError(err.message)}finally{setBusy(false)}
  }
  async function copyShare(share){if(readonly)return;setError("");setMessage("");try{const value=share.url || (share.token?`${window.location.origin}/share/decision/${share.token}`:"");if(!value)throw new Error('For security, this link is only shown once. Create a new link to share again.');await copyText(value);setMessage('Secure link copied.');}catch(err){setError(err.message)}}
  return <section className={`decision-sharing ${readonly?'decision-sharing--archived':''}`} aria-labelledby="decision-sharing-title">
    <div><span className="kicker">{readonly?'Archived share history':'Family & professional handoff'}</span><h2 id="decision-sharing-title">{readonly?'Saved links, controlled.':'Share one version of the truth.'}</h2><p>{readonly?'Existing link status remains visible for audit. New links and copying are unavailable; an active bearer link can still be revoked to reduce access.':'Links expire automatically, can be revoked at any time, and reveal the frozen decision artifact—not your account, files or editing workspace.'}</p></div>
    {readonly?<div className="decision-readonly-meta"><LockKey/><p>Return to Project Home to review the archived record. Privacy deletion is available only there when the project has no payment evidence.</p></div>:<div>
      <label>Link expires<select value={days} disabled={busy||!canShare} onChange={event=>setDays(event.target.value)}><option value="1">In 24 hours</option><option value="7">In 7 days</option><option value="30">In 30 days</option></select></label>
      <button className="outline-button" disabled={busy||!canShare||!orderId||phase==='unavailable'} onClick={createShare}><ShareNetwork/>{busy?'Working…':'Create & copy link'}</button>
      {!canShare&&<small>Purchase the immutable Decision Compare before sharing.</small>}
      {phase==='unavailable'&&<small>Secure sharing is closed until its storage and access controls are enabled.</small>}
    </div>}
    {message&&<p className="success-message" role="status"><CheckCircle/>{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    {phase==='loading'&&<p className="loading-line" role="status">Checking secure links…</p>}
    {shares.length>0&&<div className={`share-list ${readonly?'share-list--readonly':''}`}>{shares.map(share=>{const revoked=Boolean(share.revokedAt||share.revoked_at);const expired=!revoked&&share.active===false;const canCopy=Boolean(share.url||share.token);return <article key={share.id}><LinkSimple/><div><strong>{revoked?'Revoked link':expired?'Expired link':'Active private link'}{share.comparisonVersion?` · v${share.comparisonVersion}`:''}</strong><span>Expires {formatDate(share.expiresAt||share.expires_at)} · {Number(share.accessCount||share.access_count||0)} views</span></div>{!readonly&&<button disabled={revoked||expired||busy||!canCopy} onClick={()=>copyShare(share)} aria-label={canCopy?'Copy secure share link':'Secret link is no longer displayed'}><Copy/></button>}<button disabled={revoked||expired||busy} onClick={()=>revoke(share)} aria-label="Revoke secure share link"><XCircle/></button></article>})}</div>}
  </section>;
}

function FamilyAlignmentPanel({ projectId, comparison, readonly = false }) {
  const [room,setRoom]=useState(null);
  const [rooms,setRooms]=useState([]);
  const [summary,setSummary]=useState(null);
  const [phase,setPhase]=useState("loading");
  const [busy,setBusy]=useState(false);
  const [secretUrl,setSecretUrl]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const createInFlight=useRef(false);

  function applyOwnerResult(result) {
    const rawRooms = Array.isArray(result?.rooms)
      ? result.rooms
      : Array.isArray(result?.history)
        ? result.history
        : Array.isArray(result?.roomHistory)
          ? result.roomHistory
          : [];
    const normalizedRooms = rawRooms.map(normalizeFamilyRoom).filter(item=>item.id);
    const returnedRoom = result?.room ? normalizeFamilyRoom(result.room) : null;
    const current = returnedRoom?.comparisonId===comparison.id
      ? returnedRoom
      : normalizedRooms.find(item=>item.comparisonId===comparison.id) || null;
    const merged = returnedRoom?.id && !normalizedRooms.some(item=>item.id===returnedRoom.id)
      ? [returnedRoom,...normalizedRooms]
      : normalizedRooms;
    setRoom(current);
    setRooms(merged);
    setSummary(current ? (returnedRoom?.id===current.id ? (result?.summary || current.summary || null) : (current.summary || null)) : null);
    setPhase("ready");
  }

  async function load(signal) {
    setError("");
    try {
      const result=await api(`/api/projects/${encodeURIComponent(projectId)}/family-alignment`,{signal});
      if(!signal?.aborted)applyOwnerResult(result);
    } catch(err) {
      if(signal?.aborted)return;
      if(err instanceof ApiError&&err.status===401){route('/login');return}
      if(err instanceof ApiError&&err.status===404){setRoom(null);setRooms([]);setSummary(null);setPhase('ready');return}
      if(err instanceof ApiError&&(err.status===501||err.status===503)){setPhase('unavailable');return}
      setError(err.message||'Family Alignment could not be loaded.');setPhase('error');
    }
  }

  useEffect(()=>{const controller=new AbortController();setSecretUrl("");setMessage("");setPhase('loading');load(controller.signal);return()=>controller.abort()},[projectId,comparison.id]);

  async function createRoom() {
    if(readonly||createInFlight.current)return;
    createInFlight.current=true;
    setBusy(true);setError("");setMessage("");
    const storageKey=`grihagrid.familyAlignment.${projectId}.${comparison.id}`;
    try {
      const result=await api(`/api/projects/${encodeURIComponent(projectId)}/family-alignment`,{
        method:'POST',
        headers:{'idempotency-key':idempotencyKey(storageKey)},
        body:{comparisonId:comparison.id},
      });
      applyOwnerResult(result);
      sessionStorage.removeItem(storageKey);
      const created=result.room||{};
      const privateUrl=typeof result.url==='string'&&result.url
        ? result.url
        : typeof created.url==='string'&&created.url
          ? created.url
          : typeof result.token==='string'&&result.token
            ? `${window.location.origin}/align/${encodeURIComponent(result.token)}`
            : typeof created.token==='string'&&created.token
              ? `${window.location.origin}/align/${encodeURIComponent(created.token)}`
          : '';
      if(privateUrl){
        setSecretUrl(privateUrl);
        try{await copyText(privateUrl);setMessage('Private review link copied. It is shown only during this creation session.');}
        catch{setMessage('Review room created. Use “Copy link” to place its private link on your clipboard.');}
      }else{
        setMessage('The review room is active, but its one-time secret link cannot be reissued. Save a new comparison version when you need a new review room.');
      }
    } catch(err) {
      setError(err.status===503?'Family review is temporarily closed. Your saved comparison and owner choice are unchanged.':err.message);
    } finally {createInFlight.current=false;setBusy(false)}
  }

  async function copyRoomLink() {
    if(readonly)return;
    setError("");setMessage("");
    try{if(!secretUrl)throw new Error('For security, this link is shown only when the room is created.');await copyText(secretUrl);setMessage('Private review link copied.');}
    catch(err){setError(err.message)}
  }

  async function revokeRoom(target) {
    if(!target?.id)return;
    if(!window.confirm(`Revoke the private family review for comparison v${target.comparisonVersion||'—'}? Anyone using the link will lose access immediately. This cannot be undone.`))return;
    setBusy(true);setError("");setMessage("");
    try{
      await api(`/api/projects/${encodeURIComponent(projectId)}/family-alignment/${encodeURIComponent(target.id)}`,{method:'DELETE',body:{}});
      setSecretUrl("");setMessage(`Review room for comparison v${target.comparisonVersion||'—'} revoked. Future visits are blocked.`);
      await load();
    } catch(err){setError(err.message)}finally{setBusy(false)}
  }

  const scenarios=comparison.scenarios||[];
  const ownerChoice=scenarios.find(item=>item.id===comparison.selectedScenarioId);
  const status=summary?.status||summary?.alignmentStatus||'no_responses';
  const statusText=familyStatusCopy[status]||familyStatusCopy.no_responses;
  const preferenceCounts=summary?.preferences||{};
  const confidenceCounts=summary?.confidence||{};
  const reasonCounts=summary?.reasons||{};
  const earlierRooms=rooms.filter(item=>item.id!==room?.id).sort((a,b)=>(b.comparisonVersion||0)-(a.comparisonVersion||0));
  const optionACount=familyCount(preferenceCounts,['A']);
  const optionBCount=familyCount(preferenceCounts,['B']);
  const notReadyCount=familyCount(preferenceCounts,['notReady']);
  const reasonCountKeys={future_expansion:'futureExpansion',construction_complexity:'constructionComplexity'};
  const rankedReasons=familyReasons.map(([key,label])=>({key,label,count:familyCount(reasonCounts,[reasonCountKeys[key]||key])})).filter(item=>item.count>0).sort((a,b)=>b.count-a.count);

  return <section className={`family-alignment ${readonly?'family-alignment--readonly':''}`} aria-labelledby="family-alignment-title">
    <header className="family-alignment__intro"><div><span className="kicker">Family Alignment · {readonly?'archived evidence':'free'}</span><h2 id="family-alignment-title">{readonly?<>Family input.<br/><i>Saved as evidence.</i></>:<>One comparison.<br/><i>Every voice.</i></>}</h2><p>{readonly?'Recorded response totals and reasons remain readable. No room can be created, copied, or refreshed; any still-active bearer link can be revoked.':'Invite up to five family members to review this exact saved version. They respond privately without seeing your choice or GrihaGrid’s recommendation.'}</p></div><div className="family-alignment__promise">{readonly?<LockKey/>:<UserCircle/>}<strong>{readonly?'Read only':'Seven days'}</strong><span>{readonly?'Revocation remains available':'One private room · no account needed'}</span></div></header>
    {phase==='loading'&&<p className="family-alignment__loading" role="status"><ArrowClockwise/> Checking this version’s review room…</p>}
    {phase==='unavailable'&&<div className="family-alignment__notice"><LockKey/><div><strong>Family review is not open yet.</strong><p>Your working comparison and owner choice remain private and available.</p></div></div>}
    {phase==='error'&&<div className="family-alignment__notice family-alignment__notice--error"><WarningCircle/><div><strong>We could not open the review room.</strong><p role="alert">{error}</p><button className="underlined-action" onClick={()=>{setPhase('loading');load()}}>Try again <ArrowClockwise/></button></div></div>}
    {phase==='ready'&&<>
      <div className="family-alignment__workspace">
        <div className="family-alignment__room">
          <span className="family-alignment__eyebrow">Current comparison · v{comparison.version||1}</span>
          {!room?<><h3>{readonly?'No saved family review.':'Open the family conversation.'}</h3><p>{readonly?'This archived comparison has no Family Alignment room or response evidence.': 'Create one private seven-day room tied to these two saved options. No names, emails, phone numbers, files, or free-text comments are collected.'}</p>{!readonly&&<button className="copper-button" disabled={busy} onClick={createRoom}><ShareNetwork/>{busy?'Creating private room…':'Create & copy review link'}</button>}</>:<><div className="family-alignment__room-state"><span className={`family-room-state family-room-state--${familyRoomState(room).toLowerCase()}`}><i/>{familyRoomState(room)}</span><span>{room.responseCount} of {room.maxResponses||5} responses</span></div><h3>{room.active?'This saved version is with the family.':'This review room is closed.'}</h3><p>{room.active?`Seven-day room · private until ${formatDateTime(room.expiresAt)}. ${readonly?'Its status is shown without copy controls.':'The secret URL cannot be recovered after creation.'}`:`The responses remain visible in this owner summary, but the old link accepts no visits or changes.`}</p>{(!readonly||room.active)&&<div className="family-alignment__room-actions">{!readonly&&room.active&&secretUrl&&<button className="copper-button" disabled={busy} onClick={copyRoomLink}><Copy/> Copy link</button>}{!readonly&&<button className="outline-button" disabled={busy} onClick={()=>{setPhase('loading');load()}}><ArrowClockwise/> Refresh</button>}{room.active&&<button className="family-alignment__revoke" disabled={busy} onClick={()=>revokeRoom(room)}><XCircle/> Revoke</button>}</div>}</>}
        </div>
        <div className="family-alignment__summary" aria-live="polite">
          <span className="family-alignment__eyebrow">Owner-only summary</span>
          <h3>{statusText[0]}</h3><p>{statusText[1]}</p>
          <div className="family-alignment__tally" aria-label="Family preference counts"><div><span>Option A</span><strong>{optionACount}</strong></div><div><span>Option B</span><strong>{optionBCount}</strong></div><div><span>Not ready</span><strong>{notReadyCount}</strong></div></div>
          {(familyCount(confidenceCounts,['high'])+familyCount(confidenceCounts,['medium'])+familyCount(confidenceCounts,['low']))>0&&<p className="family-alignment__confidence"><strong>{familyCount(confidenceCounts,['high'])}</strong> high-confidence · {familyCount(confidenceCounts,['medium'])} medium · {familyCount(confidenceCounts,['low'])} low</p>}
          {rankedReasons.length>0&&<div className="family-alignment__reasons"><span>What is shaping the responses</span>{rankedReasons.slice(0,4).map(item=><div key={item.key}><strong>{item.label}</strong><span>{item.count}</span></div>)}</div>}
        </div>
      </div>
      <div className="family-alignment__authority"><SealCheck/><div><span>The family response</span><strong>{summary?.totalResponses??room?.responseCount??0} structured response{Number(summary?.totalResponses??room?.responseCount??0)===1?'':'s'} · advisory</strong></div><ArrowRight aria-hidden="true"/><div><span>Your authoritative choice</span><strong>{ownerChoice?`${ownerChoice.key||''} · ${ownerChoice.label}`:'No direction chosen yet'}</strong></div></div>
      {earlierRooms.length>0&&<div className="family-alignment__history"><div><span className="kicker">Earlier review rooms</span><p>Each room stays tied to the version those reviewers actually saw.</p></div><div>{earlierRooms.map(item=><article key={item.id}><div><strong>Comparison v{item.comparisonVersion||'—'}</strong><span>{familyRoomState(item)} · {item.responseCount} response{item.responseCount===1?'':'s'} · expires {formatDateTime(item.expiresAt)}</span></div>{item.active&&<button disabled={busy} onClick={()=>revokeRoom(item)}><XCircle/> Revoke</button>}</article>)}</div></div>}
    </>}
    {message&&<p className="success-message family-alignment__message" role="status"><CheckCircle/>{message}</p>}{error&&phase!=='error'&&<p className="form-error family-alignment__message" role="alert">{error}</p>}
    <footer><ShieldCheck/><p><strong>Responses are not votes of approval.</strong> Family preferences do not change your chosen direction, modify the comparison, or replace professional validation.</p></footer>
  </section>;
}

function DecisionComparePage({ projectId }) {
  const [project,setProject]=useState(null);
  const [comparison,setComparison]=useState(null);
  const [drafts,setDrafts]=useState([]);
  const [orders,setOrders]=useState([]);
  const [priority,setPriority]=useState('balanced');
  const [phase,setPhase]=useState('loading');
  const [saving,setSaving]=useState(false);
  const [choosing,setChoosing]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState("");
  async function load(signal){
    setPhase('loading');setError("");
    try{
      const projectResult=await api(`/api/projects/${projectId}`,{signal});
      const ownedProject=projectResult.project;
      let decisionResult=null;
      try{decisionResult=await api(`/api/projects/${projectId}/decision-compare`,{signal})}catch(err){if(err.status!==404)throw err}
      const normalized=normalizeDecisionResponse(decisionResult,ownedProject);
      let recovered=normalized.scenarios;
      if(ownedProject.status!=='archived')try{const saved=JSON.parse(sessionStorage.getItem(`grihagrid.decisionDraft.${projectId}`)||'null');if(Array.isArray(saved)&&saved.length===2)recovered=saved.map((item,index)=>normalizeScenario(item,normalized.scenarios[index]))}catch{}
      let orderResult={orders:[]};try{orderResult=await api(`/api/orders?projectId=${encodeURIComponent(projectId)}`,{signal})}catch(err){if(err.status!==404)throw err}
      if(signal?.aborted)return;
      setProject(ownedProject);setComparison(normalized);setDrafts(recovered);setPriority(normalized.priority||'balanced');setOrders(orderResult.orders||[]);setPhase(decisionResult?.comparison?'ready':'empty');
      trackEvent('decision_compare_opened',{surface:'owner_compare',outcome:decisionResult?.comparison?'saved':'preview'});
    }catch(err){
      if(signal?.aborted)return;
      if(err instanceof ApiError&&err.status===401){route('/login');return}
      setError(err.message||'The comparison could not be opened.');setPhase('error');
    }
  }
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[projectId]);
  useEffect(()=>{const warn=event=>{if(dirty){event.preventDefault();event.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
  function changeDraft(index,value){setDrafts(current=>current.map((item,itemIndex)=>itemIndex===index?value:item));setDirty(true);sessionStorage.setItem(`grihagrid.decisionDraft.${projectId}`,JSON.stringify(drafts.map((item,itemIndex)=>itemIndex===index?value:item)))}
  async function save(event){
    event.preventDefault();
    if(project?.status==='archived'){setError('This archived comparison is read only. Return to Project Home to review the record.');return}
    if(drafts.length!==2||drafts.some(item=>!item.label.trim())){setError('Name both options before comparing them.');return}
    setSaving(true);setError("");
    try{
      const scenarios=drafts.map(({label,floors,bedrooms,parking,quality,notes})=>({label:label.trim(),floors,bedrooms:Number(bedrooms),parking:Boolean(parking),quality,notes:notes.trim()}));
      const result=await api(`/api/projects/${projectId}/decision-compare`,{method:'PUT',body:{priority,scenarios}});
      const normalized=normalizeDecisionResponse(result,project);
      setComparison(normalized);setDrafts(normalized.scenarios);setDirty(false);setPhase('ready');sessionStorage.removeItem(`grihagrid.decisionDraft.${projectId}`);
      trackEvent('decision_compare_saved',{surface:'owner_compare',outcome:'success'});
      document.getElementById('decision-results')?.focus({preventScroll:true});document.getElementById('decision-results')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){setError(err.status===503?'Comparison generation is temporarily closed. Your two drafts are kept safely in this browser.':err.message)}finally{setSaving(false)}
  }
  async function choose(scenario){
    if(project?.status==='archived'){setError('The saved direction cannot be changed while this project is archived.');return}
    if(!comparison?.id){setError('Save both options before choosing a direction.');document.getElementById('decision-editor')?.scrollIntoView({behavior:'smooth'});return}
    setChoosing(true);setError("");
    try{const result=await api(`/api/projects/${projectId}/decision-compare/choice`,{method:'POST',body:{scenarioId:scenario.id}});setComparison(current=>({...current,selectedScenarioId:result.selection?.scenarioId||scenario.id,selection:result.selection||{scenarioId:scenario.id}}));trackEvent('decision_compare_option_chosen',{surface:'owner_compare',outcome:'success'});}
    catch(err){setError(err.message)}finally{setChoosing(false)}
  }
  if(phase==='loading')return <main className="decision-loading" aria-busy="true"><Brand/><div role="status"><ArrowsLeftRight/><span className="kicker">Opening your private project</span><h1>Setting two options on the table…</h1><p>The current planning report remains unchanged.</p></div></main>;
  if(phase==='error')return <main className="error-page"><WarningCircle/><h1>We could not open Decision Compare.</h1><p role="alert">{error}</p><div className="error-actions"><button className="outline-button" onClick={()=>route(`/projects/${projectId}`)}><ArrowLeft/> Project home</button><button className="copper-button" onClick={()=>load()}>Try again <ArrowClockwise/></button></div></main>;
  const archived=project?.status==='archived';
  const hasSavedComparison=phase==='ready'&&Boolean(comparison?.id);
  return <main className={`decision-page ${archived?'decision-page--archived':''}`}>
    <header className="decision-topbar"><button onClick={()=>route(`/projects/${projectId}`)}><ArrowLeft/> Project home</button><Brand inverted/><div><button onClick={()=>route('/orders')}><Receipt/> Orders</button><button onClick={()=>window.print()}><DownloadSimple/> {archived?'Print archived copy':'Print working copy'}</button></div></header>
    <section className="decision-intro"><div><span className="kicker">{archived?'Archived decision record':'A decision instrument, prepared before drawings'}</span><h1>Two options.<br/><i>{archived?'One saved record.':'One clear direction.'}</i></h1><p>{archived?'This page preserves the comparison as it was saved. Editing, recalculation, choice changes, sharing and checkout are unavailable.':'Keep the plot fixed. Change only the choices that matter, then make the area, budget and programme trade-off visible to everyone.'}</p></div><div className="decision-intro__index" aria-hidden="true"><span>{archived?'Read-only record':'Decision instrument'}</span><strong>02</strong><small>{archived?'No planning changes':'Exactly two alternatives'}</small></div></section>
    {archived&&<section className="decision-archived-notice" role="status"><LockKey/><div><strong>Archived · read only</strong><p>Saved comparison, family response totals, order history and link status remain readable. Return to Project Home for the archived overview and any eligible privacy deletion.</p></div></section>}
    {!archived&&<form id="decision-editor" className="decision-editor" onSubmit={save} aria-busy={saving}>
      <header><div><span className="kicker">Draft the alternatives</span><h2>Change the brief—not the ground.</h2><p>Both options inherit the same plot, city and facing. Saved comparisons are recalculated from one cost basis.</p></div><div className="decision-editor__basis"><span className="decision-plot-lock"><LockKey/> {project.input?.width} × {project.input?.length} ft · {project.input?.city}</span><label>Decision priority<select value={priority} disabled={saving} onChange={event=>{setPriority(event.target.value);setDirty(true)}}><option value="balanced">Balanced outcome</option><option value="budget">Protect budget</option><option value="space">Maximise space</option><option value="speed">Simplify delivery</option></select></label></div></header>
      <div className="scenario-editors">{drafts.map((scenario,index)=><ScenarioEditor key={scenario.key||index} scenario={scenario} index={index} onChange={changeDraft} disabled={saving}/>)}</div>
      {dirty&&<p className="draft-recovery" role="status"><FloppyDisk/> Unsaved edits are kept in this browser until you compare them.</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="decision-editor__actions"><p><ShieldCheck/> Concept-stage calculations only. Local rules and site conditions remain unresolved.</p><button className="copper-button" type="submit" disabled={saving||drafts.length!==2}>{saving?'Recalculating both options…':phase==='empty'?'Create comparison':'Save & recalculate'} <ArrowsLeftRight/></button></div>
    </form>}
    {archived&&!hasSavedComparison?<section className="decision-archived-empty"><ArrowsLeftRight/><h2>No saved comparison record.</h2><p>This project was archived without a versioned Decision Compare. Browser drafts are not presented as project evidence.</p><button className="outline-button" onClick={()=>route(`/projects/${projectId}`)}><ArrowLeft/> Project home</button></section>:<section id="decision-results" className="decision-results" tabIndex="-1">{phase==='empty'&&<div className="decision-preview-note" role="status"><PencilSimple/><p><strong>Unsaved preview.</strong> These two starting options are visible only in this browser. Save them to create a versioned comparison and choose a direction.</p></div>}<DecisionDocument comparison={comparison} project={project} onChoose={choose} choosing={choosing} readonly={archived}/></section>}
    {hasSavedComparison&&<FamilyAlignmentPanel projectId={projectId} comparison={comparison} readonly={archived}/>}
    {(!archived||hasSavedComparison)&&<DecisionPurchasePanel projectId={projectId} comparison={comparison} orders={orders} onOrdersChange={setOrders} readonly={archived}/>}
    {(!archived||hasSavedComparison)&&<DecisionSharePanel projectId={projectId} comparison={comparison} orderId={comparison.entitlement?.orderId||null} canShare={Boolean(comparison.entitlement?.active)} readonly={archived}/>}
  </main>;
}

function PurchasePanel({ projectId, readonly = false }) {
  const selected=sessionStorage.getItem('grihagrid.plan')==='decision_compare'?'decision_compare':null;
  const [plan,setPlan]=useState(selected||'plan');const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const availability=useCommerceCatalog();
  const details={plan:['Planning report','₹499'],decision_compare:['Decision Compare','₹999'],site_plus:['Site-informed','₹999'],expert:['Architect reviewed','₹3,499']};
  if(readonly)return null;
  if(!selected)return <section className="purchase-panel"><div><span className="kicker">Need more confidence?</span><h2>Put two options on the table.</h2><p>Use Decision Compare when the free Brief Check has framed the problem but competing directions still need one clear choice.</p></div><button className="underlined-action" onClick={()=>route('/pricing')}>Compare offers <ArrowRight/></button></section>;
  if(selected==='decision_compare')return <section className="purchase-panel purchase-panel--selected"><div><span className="kicker">Selected next step</span><h2>Decision Compare</h2><p>Create exactly two alternatives and choose a direction before secure checkout opens.</p></div><button className="copper-button" onClick={()=>{sessionStorage.removeItem('grihagrid.plan');route(`/projects/${projectId}/compare`)}}>Compare two options <ArrowsLeftRight/></button></section>;
  async function checkout(){setBusy(true);setError("");try{const keyName=`grihagrid.checkout.${projectId}.${plan}`;let key=sessionStorage.getItem(keyName);if(!key){key=crypto.randomUUID();sessionStorage.setItem(keyName,key)}const result=await api(`/api/projects/${projectId}/orders`,{method:'POST',headers:{'idempotency-key':key},body:{plan}});sessionStorage.removeItem('grihagrid.plan');if(result.checkoutUrl)window.location.assign(result.checkoutUrl);else if(result.order?.id)route(`/checkout/return?order=${encodeURIComponent(result.order.id)}`);else throw new Error('Checkout is not available for this order.');}catch(err){setError(err.status===503?'Secure checkout is being connected. Your project is saved; no payment was taken.':err.message);}finally{setBusy(false)}}
  const accepting=Boolean(availability[plan]);
  return <section className="purchase-panel purchase-panel--selected"><div><span className="kicker">Selected next step</span><h2>{details[plan][0]}</h2><p>{accepting?'One project · one payment. The checkout provider confirms payment directly with GrihaGrid before fulfillment begins.':'This paid service is visible for comparison, but is not accepting orders yet. Your free project remains saved.'}</p></div><div><label>Plan<select value={plan} onChange={e=>setPlan(e.target.value)}>{Object.entries(details).map(([value,[name,price]])=><option key={value} value={value}>{name} · {price}</option>)}</select></label><button disabled={busy||!accepting} className="copper-button" onClick={checkout}>{busy?'Opening checkout…':accepting?`Continue · ${details[plan][1]}`:'Not accepting orders'} {accepting&&<ArrowRight/>}</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}

function ProjectFiles({ projectId, readonly = false }) {
  const [files,setFiles]=useState([]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [storageState,setStorageState]=useState('loading');
  const privateUploads=usePrivateUploadCapability();
  useEffect(()=>{api(`/api/projects/${projectId}/files`).then(x=>{setFiles(x.files||[]);setStorageState('ready')}).catch(e=>{if(e.status===503){setStorageState('unavailable');return}setStorageState('error');setError(e.message)});},[projectId]);
  async function upload(event){if(readonly||!privateUploads.enabled||storageState!=='ready'){event.target.value='';return}const selected=[...(event.target.files||[])];if(!selected.length)return;setBusy(true);setError("");try{for(const file of selected){const form=new FormData();form.append('file',file);form.append('kind','reference');const result=await api(`/api/projects/${projectId}/files`,{method:'POST',body:form});setFiles(current=>[result.file,...current]);}}catch(err){if(err.status===503){setStorageState('unavailable');setError('');return}setError(err.message);}finally{setBusy(false);event.target.value='';}}
  async function remove(file){const name=file.name||file.fileName||file.file_name||'this file';if(!window.confirm(`Delete “${name}”?`))return;try{await api(`/api/projects/${projectId}/files/${file.id}`,{method:'DELETE',body:{}});setFiles(current=>current.filter(item=>item.id!==file.id));}catch(err){setError(err.message)}}
  const capabilityUnavailable=privateUploads.phase==='unavailable'||(privateUploads.phase==='ready'&&!privateUploads.enabled);
  const storageUnavailable=storageState==='unavailable'||storageState==='error';
  const uploadsUnavailable=capabilityUnavailable||storageUnavailable;
  const checkingUploads=privateUploads.phase==='loading'||(!capabilityUnavailable&&storageState==='loading');
  return <section className={`project-files project-files--${checkingUploads?'loading':uploadsUnavailable?'unavailable':storageState} ${readonly?'project-files--readonly':''}`}><div><span className="kicker">Private site context</span><h2>Plot photographs & documents</h2><p>{readonly?'Existing file records remain listed. When storage is available, they can be opened or permanently deleted; uploads are closed while this project is archived.':checkingUploads?'Existing file records remain listed while upload availability is checked.':uploadsUnavailable?'Private file uploads are not active in this release. Your Brief Check and planning range remain available without them.':'Keep the evidence behind your brief together. Files remain account-scoped.'}</p></div>{readonly?<span className="file-storage-state project-files__readonly"><LockKey/> Uploads closed</span>:checkingUploads?<span className="file-storage-state" role="status"><ArrowClockwise/> Checking upload availability…</span>:uploadsUnavailable?<span className="file-storage-state" role="status"><LockKey/> Uploads unavailable</span>:<label className="file-upload-action"><UploadSimple/>{busy?'Uploading…':'Add files'}<input disabled={busy} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={upload}/></label>}{error&&<p className="form-error" role="alert">{error}</p>}{files.length>0&&<div className="file-list">{files.map(file=>{const name=file.name||file.fileName||file.file_name||'Project file';return <div key={file.id}><FileText/><a href={`/api/projects/${projectId}/files/${file.id}`}>{name}</a><span>{Math.max(1,Math.round((file.sizeBytes||file.size_bytes||0)/1024))} KB</span><button onClick={()=>remove(file)} aria-label={`Delete ${name}`}><Trash/></button></div>})}</div>}</section>;
}

function AiPlanningBrief({ projectId, readonly = false }) {
  const [analysis,setAnalysis]=useState(null);
  const [cached,setCached]=useState(false);
  const [consented,setConsented]=useState(false);
  const [phase,setPhase]=useState('loading');
  const [error,setError]=useState('');

  const isUnavailable=(err)=>err instanceof ApiError&&(
    err.status===501||
    err.status===503||
    String(err.payload?.code||err.payload?.errorCode||'').toLowerCase().includes('not_configured')
  );
  const applyResult=(result)=>{
    if(result?.aiBrief){setAnalysis(result.aiBrief);setCached(Boolean(result.cached));setPhase('ready');return}
    setAnalysis(null);setPhase('empty');
  };
  async function load(signal){
    setError('');
    setPhase('loading');
    try{const result=await api(`/api/projects/${projectId}/ai-brief`,{signal});if(!signal?.aborted)applyResult(result);}
    catch(err){
      if(signal?.aborted)return
      if(err instanceof ApiError&&err.status===401){route('/login');return}
      if(err instanceof ApiError&&err.status===404){setPhase('empty');return}
      if(isUnavailable(err)){setPhase('unavailable');return}
      setError(err.message||'The AI brief could not be loaded.');setPhase('error');
    }
  }
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[projectId]);

  async function generate(){
    if(readonly)return;
    const hadAnalysis=Boolean(analysis);
    setError('');setPhase(hadAnalysis?'refreshing':'generating');
    try{applyResult(await api(`/api/projects/${projectId}/ai-brief`,{method:'POST',body:{acceptedAiTerms:consented,refresh:hadAnalysis},timeoutMs:60_000}));}
    catch(err){
      if(err instanceof ApiError&&err.status===401){route('/login');return}
      if(isUnavailable(err)){
        if(hadAnalysis){setError('Gemini is not connected right now. Your saved brief is still available.');setPhase('ready')}
        else setPhase('unavailable');
        return;
      }
      setError(err.message||'Gemini could not create the brief. Please try again.');
      setPhase(hadAnalysis?'ready':'error');
    }
  }

  const generatedDate=analysis?.generatedAt&&new Date(analysis.generatedAt);
  const generatedLabel=generatedDate&&!Number.isNaN(generatedDate.valueOf())
    ?generatedDate.toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})
    :null;
  const model=String(analysis?.model||'Gemini').replace(/^models\//,'');
  const list=(value)=>Array.isArray(value)?value.filter(item=>typeof item==='string'&&item.trim()):[];
  const content=analysis?.content||{};
  const priorities=list(content.planningPriorities);const layoutSuggestions=list(content.layoutSuggestions);const costNotes=list(content.costAndDeliveryNotes);const risks=list(content.riskFlags);const questions=list(content.questionsForArchitect);
  const hasAnalysis=Boolean(analysis);

  return <section className={`ai-brief ${hasAnalysis?'ai-brief--has-analysis':''} ${readonly?'ai-brief--readonly':''}`} aria-labelledby="ai-brief-title" aria-busy={phase==='loading'||phase==='generating'||phase==='refreshing'}>
    <header className="ai-brief-heading">
      <div><span className="kicker">Gemini · AI-assisted</span><h2 id="ai-brief-title">A second reading of your brief.</h2><p>Gemini turns sanitized planning facts into a concise memorandum—what feels strong, what needs care, and what to ask next. Account details and project files are not sent.</p></div>
      <div className="ai-brief-folio" aria-hidden="true"><span>AI</span><strong>01</strong></div>
    </header>

    {phase==='loading'&&<div className="ai-brief-state" role="status" aria-live="polite"><Sparkle/><div><span>Checking this private project</span><h3>Looking for a saved AI brief…</h3><p>Your planning report remains available while this loads.</p></div></div>}

    {phase==='empty'&&(readonly?<div className="ai-brief-state ai-brief-state--muted"><LockKey/><div><span>Archived AI record</span><h3>No saved AI brief.</h3><p>This archived project has no Gemini planning memo. Generation is unavailable; the deterministic planning evidence above remains unchanged.</p></div></div>:<div className="ai-brief-state ai-brief-state--action"><Sparkle/><div><span>Optional planning layer</span><h3>Create a Gemini planning memo.</h3><p>Only sanitized planning facts are sent to Google Gemini—never account details, precise addresses or uploaded files. On Google’s Free tier, inputs and outputs may be reviewed or used to improve its products.</p><label className="ai-consent"><input type="checkbox" checked={consented} onChange={event=>setConsented(event.target.checked)}/><span>I confirm I am 18 or older and consent to the sanitized planning facts described above being processed by Google Gemini.</span></label><button className="copper-button" disabled={!consented} onClick={generate}>Generate AI brief <ArrowRight/></button><small>Usually ready in under a minute · output is advisory and saved with this project</small></div></div>)}

    {phase==='generating'&&<div className="ai-brief-state ai-brief-state--working" role="status" aria-live="polite"><Sparkle/><div><span>Gemini is reading your project</span><h3>Drafting the planning memorandum…</h3><p>This may take up to a minute. Keep this page open; no payment is involved.</p></div></div>}

    {phase==='unavailable'&&<div className="ai-brief-state ai-brief-state--muted" role="status"><WarningCircle/><div><span>AI studio unavailable</span><h3>Gemini is not connected yet.</h3><p>The planning report above remains unchanged. Gemini must be connected securely on the server before an AI-assisted brief can be generated.</p></div></div>}

    {phase==='error'&&!hasAnalysis&&<div className="ai-brief-state ai-brief-state--error"><WarningCircle/><div><span>AI brief unavailable</span><h3>We could not open the planning memo.</h3><p role="alert">{error}</p><button className="outline-button" onClick={()=>load()}>Try again <ArrowClockwise/></button></div></div>}

    {hasAnalysis&&<div className="ai-brief-document">
      <div className="ai-brief-provenance"><span><i/> {readonly?'Archived brief · read only':cached?'Cached brief · saved privately':'New brief · saved privately'}</span><span>{generatedLabel?`Generated ${generatedLabel}`:'Saved AI brief'} · {model}</span></div>
      {phase==='refreshing'&&<p className="ai-brief-refresh-status" role="status" aria-live="polite"><Sparkle/> Gemini is refreshing the memo. The saved version remains visible.</p>}
      {error&&<p className="ai-brief-inline-error" role="alert"><WarningCircle/>{error}</p>}
      <div className="ai-brief-overview"><span>Planning overview</span>{content.headline&&<h3>{content.headline}</h3>}<p>{content.overview||'Gemini has generated a planning brief for this project.'}</p></div>
      {(priorities.length>0||layoutSuggestions.length>0)&&<div className="ai-brief-columns">
        {priorities.length>0&&<section><span className="ai-section-label">Planning priorities</span><ul>{priorities.map((item,index)=><li key={`${item}-${index}`}><CheckCircle aria-hidden="true"/><span>{item}</span></li>)}</ul></section>}
        {layoutSuggestions.length>0&&<section><span className="ai-section-label">Layout suggestions</span><ul>{layoutSuggestions.map((item,index)=><li key={`${item}-${index}`}><Blueprint aria-hidden="true"/><span>{item}</span></li>)}</ul></section>}
      </div>}
      {(costNotes.length>0||risks.length>0)&&<div className="ai-brief-columns ai-brief-columns--caution">
        {costNotes.length>0&&<section><span className="ai-section-label">Cost & delivery notes</span><ul>{costNotes.map((item,index)=><li key={`${item}-${index}`}><CurrencyInr aria-hidden="true"/><span>{item}</span></li>)}</ul></section>}
        {risks.length>0&&<section><span className="ai-section-label">Risks to validate</span><ul>{risks.map((item,index)=><li key={`${item}-${index}`}><WarningCircle aria-hidden="true"/><span>{item}</span></li>)}</ul></section>}
      </div>}
      {questions.length>0&&<section className="ai-numbered-list"><span className="ai-section-label">Questions for your architect</span><ol>{questions.map((item,index)=><li key={`${item}-${index}`}><span>{String(index+1).padStart(2,'0')}</span><p>{item}</p></li>)}</ol></section>}
      <footer className="ai-brief-boundary"><ShieldCheck/><p><strong>AI-assisted, not professional advice.</strong> {content.disclaimer||'This planning memo is indicative and may be incomplete. A licensed local architect and structural engineer must validate site conditions, regulations, dimensions, drawings and specifications before construction.'}</p></footer>
      {!readonly&&<div className="ai-brief-actions"><div><p>Refresh after changing the project brief to create a new saved reading.</p><label className="ai-consent ai-consent--compact"><input type="checkbox" checked={consented} onChange={event=>setConsented(event.target.checked)}/><span>I confirm I am 18 or older and consent to this sanitized refresh being processed by Google Gemini.</span></label></div><button className="outline-button" disabled={phase==='refreshing'||!consented} onClick={generate}>{phase==='refreshing'?'Refreshing…':'Refresh analysis'} <ArrowClockwise/></button></div>}
    </div>}
  </section>;
}

function orderStatusCopy(order) {
  if(order.entitlement?.revokedAt)return 'Artifact access revoked';
  if(order.status==='paid')return order.fulfillment?.status==='ready'?'Purchased artifact ready':`Payment confirmed · ${order.fulfillment?.status?.replaceAll('_',' ')||'preparing artifact'}`;
  if(order.status==='failed')return 'Checkout not completed';
  if(order.status==='refunded')return 'Refunded';
  return order.status==='created'?'Awaiting verified payment':String(order.status||'unknown').replaceAll('_',' ');
}

function OrderHistoryPage({ user, onLogout }) {
  const [orders,setOrders]=useState([]);const [phase,setPhase]=useState('loading');const [error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController();api('/api/orders',{signal:controller.signal}).then(result=>{setOrders(result.orders||[]);setPhase('ready')}).catch(err=>{if(controller.signal.aborted)return;if(err instanceof ApiError&&err.status===401){route('/login');return}setError(err.message);setPhase('error')});return()=>controller.abort()},[]);
  return <main className="workspace orders-workspace"><aside><Brand/><nav><button onClick={()=>route('/dashboard')}><Blueprint/> Projects</button><button className="active"><Receipt/> Orders</button><button onClick={()=>route('/start')}><Plus/> New brief</button></nav><WorkspaceAccount user={user} onLogout={onLogout}/></aside><section className="workspace-main order-history"><header><div><span className="kicker">Receipts & deliverables</span><h1>Every purchase, traceable.</h1></div><button className="outline-button" onClick={()=>route('/dashboard')}><ArrowLeft/> Projects</button></header>
    {phase==='loading'&&<p className="loading-line" role="status">Loading your order history…</p>}
    {phase==='error'&&<div className="orders-error"><p className="form-error" role="alert">{error}</p><button className="outline-button" onClick={()=>window.location.reload()}>Try again <ArrowClockwise/></button></div>}
    {phase==='ready'&&orders.length===0&&<div className="empty-state"><Receipt/><h2>No purchases yet.</h2><p>Your free Brief Checks and saved planning reports remain available. When you buy Decision Compare, its receipt and immutable artifact will live here.</p><button className="copper-button" onClick={()=>route('/dashboard')}>Open my projects <ArrowRight/></button></div>}
    {orders.length>0&&<div className="order-list">{orders.map(order=>{const decision=decisionPlanIds.includes(order.plan)||/decision\s*compare/i.test(order.planLabel||"");const ready=order.status==='paid'&&order.fulfillment?.status==='ready'&&order.entitlement?.active!==false;return <article key={order.id}><div className="order-list__identity"><span>{formatDate(order.createdAt)}</span><h2>{order.planLabel||order.plan}</h2><small>Order {order.id.slice(0,8)} · {order.projectId?.slice(0,8)}</small></div><div className="order-list__amount"><span>Amount</span><strong>₹{(Number(order.amountPaise||0)/100).toLocaleString('en-IN')}</strong><small>Tax inclusive</small></div><div className="order-list__state"><span className={`order-status order-status--${order.status}`}><i/>{orderStatusCopy(order)}</span>{order.paidAt&&<small>Confirmed {formatDate(order.paidAt)}</small>}</div><div className="order-list__actions">{ready&&<button className="copper-button" onClick={()=>route(`/orders/${order.id}/artifact`)}>Open artifact <ArrowRight/></button>}{!ready&&order.checkoutUrl&&order.status==='created'&&<button className="copper-button" onClick={()=>window.location.assign(order.checkoutUrl)}>Resume checkout <ArrowSquareOut/></button>}<button className="underlined-action" onClick={()=>route(decision?`/projects/${order.projectId}/compare`:`/report/${order.projectId}`)}>Open project</button></div></article>})}</div>}
  </section></main>;
}

function PurchasedArtifactPage({ orderId }) {
  const [state,setState]=useState({phase:'loading',order:null,artifact:null,progress:null,error:""});
  const [handoffBusy,setHandoffBusy]=useState(false);
  const [handoffMessage,setHandoffMessage]=useState("");
  async function load(signal){setState(current=>({...current,phase:'loading',error:""}));try{const result=await api(`/api/orders/${encodeURIComponent(orderId)}/artifact`,{signal});if(!signal?.aborted)setState({phase:'ready',order:result.order,artifact:result.artifact,progress:result.progress||null,error:""})}catch(err){if(signal?.aborted)return;if(err instanceof ApiError&&err.status===401){route('/login');return}if(err.status===409){try{const pending=await api(`/api/orders/${encodeURIComponent(orderId)}`,{signal});if(!signal?.aborted)setState({phase:'ready',order:pending.order,artifact:null,progress:null,error:""});return}catch{}}setState({phase:'error',order:null,artifact:null,progress:null,error:err.message})}}
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[orderId]);
  async function printArtifact(){trackEvent('decision_compare_artifact_downloaded',{surface:'artifact',outcome:'success'});await api(`/api/orders/${encodeURIComponent(orderId)}/progress`,{method:'POST',body:{action:'printed'}}).then(result=>setState(current=>({...current,progress:result.progress||current.progress}))).catch(()=>{});window.print()}
  async function markProfessionalHandoff(){setHandoffBusy(true);setHandoffMessage("");try{const result=await api(`/api/orders/${encodeURIComponent(orderId)}/progress`,{method:'POST',body:{action:'professional_handoff'}});setState(current=>({...current,progress:result.progress||current.progress}));setHandoffMessage('Professional handoff recorded. Keep this frozen version with your project notes.')}catch(err){setHandoffMessage(err.message)}finally{setHandoffBusy(false)}}
  if(state.phase==='loading')return <main className="decision-loading"><Brand/><div role="status"><Stack/><span className="kicker">Recovering purchased artifact</span><h1>Opening the frozen decision…</h1><p>The original snapshot is never regenerated from current project data.</p></div></main>;
  if(state.phase==='error')return <main className="error-page"><WarningCircle/><h1>We could not recover this artifact.</h1><p role="alert">{state.error}</p><div className="error-actions"><button className="outline-button" onClick={()=>route('/orders')}><ArrowLeft/> Orders</button><button className="copper-button" onClick={()=>load()}>Try again <ArrowClockwise/></button></div></main>;
  if(!state.artifact)return <main className="error-page"><LockKey/><h1>The purchase is recorded; the artifact is not ready.</h1><p>{orderStatusCopy(state.order)}. No substitute or browser-generated artifact is shown.</p><button className="copper-button" onClick={()=>route('/orders')}>Return to orders <ArrowRight/></button></main>;
  const raw=state.artifact.comparison||state.artifact.decisionCompare||state.artifact.report?.decisionCompare||state.artifact.report?.comparison||state.artifact.report;
  const project={id:state.order.projectId,name:raw?.projectName||state.artifact.report?.title||'Purchased Decision Compare',input:raw?.plot||raw?.projectInput||state.artifact.report?.input||{}};
  const comparison=normalizeDecisionResponse(raw,project);
  const isDecision=state.artifact.type?.includes('decision')||comparison.scenarios?.length===2;
  const handedOff=Boolean(state.progress?.professionalHandoffAt);
  return <main className="artifact-page"><header><button onClick={()=>route('/orders')}><ArrowLeft/> Orders</button><Brand/><button onClick={printArtifact}><DownloadSimple/> Download / print</button></header>{isDecision?<DecisionDocument comparison={comparison} project={project} readonly artifact/>:<section className="legacy-artifact"><span className="kicker">Purchased planning report</span><h1>{state.artifact.report?.title||'Your report snapshot'}</h1><p>This immutable report was generated {formatDate(state.artifact.createdAt)}.</p><button className="copper-button" onClick={()=>route(`/report/${state.order.projectId}`)}>Open project report <ArrowRight/></button></section>}{isDecision&&<section className="artifact-handoff" aria-labelledby="artifact-handoff-title"><div><span className="kicker">Close the loop</span><h2 id="artifact-handoff-title">Take one decision into the professional conversation.</h2><p>Mark this only after you have shown this frozen version to a licensed architect or engineer. It records the milestone—not their approval.</p></div><button className="outline-button" disabled={handoffBusy||handedOff} onClick={markProfessionalHandoff}>{handedOff?<><CheckCircle/> Handoff recorded</>:handoffBusy?'Recording…':<>Mark professional handoff <ArrowRight/></>}</button>{handoffMessage&&<p role="status">{handoffMessage}</p>}</section>}<div className="artifact-provenance"><LockKey/><p><strong>Immutable purchase record.</strong> Order {state.order.id.slice(0,8)} · snapshot {state.artifact.snapshotId?.slice(0,8)||'verified'} · created {formatDate(state.artifact.createdAt)}</p></div></main>;
}

function SampleDecisionComparePage() {
  const project={name:'Pune family home',input:{width:30,length:50,city:'Pune',facing:'East',quality:'Signature'}};
  const comparison=normalizeDecisionResponse({id:'sample',version:1,priority:'balanced',scenarios:[
    {id:'sample-a',position:1,label:'Balanced courtyard',input:{floors:'G+1',bedrooms:3,parking:true,quality:'Signature'},estimate:{builtUpSqft:1830,lowInr:3700000,highInr:4400000},constraints:['Ground-floor parking narrows the entry sequence.'],assumptions:['One car bay and a compact internal stair remain viable.'],tradeoffs:['Keeps the brief and budget tighter, with less room for future expansion.']},
    {id:'sample-b',position:2,label:'Extended family',input:{floors:'G+2',bedrooms:4,parking:true,quality:'Signature'},estimate:{builtUpSqft:2475,lowInr:5000000,highInr:5900000},constraints:['A third floor adds vertical circulation and approval complexity.'],assumptions:['Structure and local height rules can support the extra floor.'],tradeoffs:['Adds a private family room while increasing cost and stair dependency.']},
  ],recommendation:{scenarioId:'sample-a',headline:'Begin with the balanced courtyard option.',rationale:'It answers the three-bedroom brief with the lower cost and circulation burden. Keep the third-floor option as a future structural provision, subject to professional validation.'},questionsForArchitect:['Do local setbacks leave enough clear width for parking and a dignified entrance?','Can the structure economically preserve a future vertical extension?','Which wet-area stack gives both options the cleanest plumbing route?','How much usable area is lost to the stair in each option?','Which specification decisions explain the largest part of the cost difference?'],selection:null},project);
  return <main className="sample-decision-page"><header><button onClick={()=>route('/plans')}><ArrowLeft/> Sample plan</button><Brand/><button onClick={()=>route('/start')}>Create mine <ArrowRight/></button></header><section className="sample-decision-intro"><span className="kicker">Public sample · no account required</span><h1>See the decision<br/>before buying the detail.</h1><p>This example uses illustrative assumptions for one Pune plot. Your private project will keep its own city, measurements and cost basis.</p></section><DecisionDocument comparison={comparison} project={project} readonly/><section className="sample-decision-cta"><div><span className="kicker">Start with the free Brief Check</span><h2>Put your own two options on the table.</h2></div><button className="copper-button copper-button--large" onClick={()=>route('/start')}>Plan my home <ArrowRight/></button></section></main>;
}

function SharedDecisionPage({ token }) {
  const [state,setState]=useState({phase:'loading',share:null,error:""});
  useEffect(()=>{const controller=new AbortController();api(`/api/shared/decision-compare/${encodeURIComponent(token)}`,{signal:controller.signal}).then(result=>setState({phase:'ready',share:result.share||result,error:""})).catch(err=>{if(controller.signal.aborted)return;setState({phase:err.status===410?'expired':'error',share:null,error:err.message})});return()=>controller.abort()},[token]);
  if(state.phase==='loading')return <main className="shared-state"><Brand/><div role="status"><Eye/><h1>Opening a private decision…</h1><p>Validating this expiring link.</p></div></main>;
  if(state.phase!=='ready')return <main className="shared-state"><Brand/><div><XCircle/><span className="kicker">{state.phase==='expired'?'Link expired or revoked':'Link unavailable'}</span><h1>This decision is no longer shared.</h1><p>{state.phase==='expired'?'Ask the project owner for a fresh link.':state.error||'The link may be incomplete.'}</p><button className="copper-button" onClick={()=>route('/')}>Visit GrihaGrid <ArrowRight/></button></div></main>;
  const raw=state.share.artifact||state.share.comparison||state.share;
  const project={name:raw.projectName||'Shared home decision',input:raw.plot||{}};
  const comparison=normalizeDecisionResponse(raw,project);
  return <main className="shared-decision"><header><Brand/><span><LockKey/> Read-only · expires {formatDate(state.share.expiresAt)}</span><button onClick={()=>window.print()}><DownloadSimple/> Print</button></header><DecisionDocument comparison={comparison} project={project} readonly artifact/><footer><p>Shared privately through GrihaGrid. This link does not reveal the owner’s account or project files.</p><button className="underlined-action" onClick={()=>route('/')}>Create my own Brief Check <ArrowRight/></button></footer></main>;
}

function FamilyReviewComparison({ scenarios, assumptions, disclaimer }) {
  if(!Array.isArray(scenarios)||scenarios.length!==2)return <div className="family-review__invalid"><WarningCircle/><p>Two complete options are required for a family review.</p></div>;
  return <section className="family-review__comparison" aria-labelledby="family-options-title">
    <div className="family-review__comparison-title"><span className="kicker">The same brief · two directions</span><h2 id="family-options-title">Review the facts before choosing.</h2><p>The project owner’s choice and GrihaGrid’s recommendation are deliberately hidden. Your response should be independent.</p></div>
    <div className="family-review__options">
      {scenarios.map((scenario,index)=>{const estimate=scenario.estimate||{};return <article key={scenario.key||index} className="family-review__option">
        <header><span>Independent direction</span><h3>Option {scenario.key||String.fromCharCode(65+index)}</h3></header>
        <dl><div><dt>Likely built-up</dt><dd>{Number(estimate.builtUpSqft||0).toLocaleString('en-IN')} sq ft</dd></div><div><dt>Planning range</dt><dd>{formatLakh(estimate.lowInr)}–{formatLakh(estimate.highInr)}</dd></div><div><dt>Programme</dt><dd>{scenario.programme?.summary||`${scenario.floors||'—'} · ${scenario.bedrooms||'—'} bedrooms`}</dd><small>{scenario.programme?.detail||`${scenario.parking?'Parking required':'No parking'} · ${scenario.quality||'Finish to confirm'}`}</small></div></dl>
        <div className="family-review__lists"><section><h4>What to resolve</h4><ComparisonList items={scenario.constraints} fallback="Local setbacks, circulation, and site conditions still need professional verification."/></section><section><h4>Trade-off</h4><ComparisonList items={scenario.tradeoffs} fallback="Compare space, budget, and delivery complexity before committing."/></section></div>
      </article>})}
    </div>
    {(listOf(assumptions).length>0||disclaimer)&&<aside className="family-review__assumptions" aria-label="Concept-stage assumptions">
      {listOf(assumptions).length>0&&<div><h3>Shared assumptions</h3><ComparisonList items={assumptions} fallback=""/></div>}
      {disclaimer&&<p><ShieldCheck aria-hidden="true"/><span><strong>Concept-stage boundary.</strong> {disclaimer}</span></p>}
    </aside>}
  </section>;
}

function FamilyAlignmentReviewPage({ token }) {
  const [phase,setPhase]=useState('loading');
  const [room,setRoom]=useState(null);
  const [receipt,setReceipt]=useState(null);
  const [form,setForm]=useState({role:'',preference:'',confidence:'',reasons:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [savedMessage,setSavedMessage]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    setPhase('loading');setError('');
    api(`/api/family-alignment/${encodeURIComponent(token)}`,{signal:controller.signal}).then(result=>{
      if(controller.signal.aborted)return;
      const publicRoom=result.room||result;
      setRoom(publicRoom);
      const stored=readFamilyReceipt(publicRoom.id);
      setReceipt(stored);
      const savedForm=stored?.response||stored?.pending;
      if(savedForm)setForm({role:savedForm.role||'',preference:savedForm.preference||'',confidence:savedForm.confidence||'',reasons:Array.isArray(savedForm.reasons)?savedForm.reasons.slice(0,3):[]});
      setPhase('ready');
    }).catch(err=>{
      if(controller.signal.aborted)return;
      if(err.status===410)setPhase('closed');
      else if(err.status===404)setPhase('unavailable');
      else{setError('The private review could not be opened. Please ask the project owner for a fresh link.');setPhase('error')}
    });
    return()=>controller.abort();
  },[token]);

  function toggleReason(reason) {
    setForm(current=>{
      const exists=current.reasons.includes(reason);
      if(exists)return {...current,reasons:current.reasons.filter(item=>item!==reason)};
      if(current.reasons.length>=3)return current;
      return {...current,reasons:[...current.reasons,reason]};
    });
  }

  async function submit(event) {
    event.preventDefault();
    if(!room?.id||!form.role||!form.preference||!form.confidence||form.reasons.length<1){setError('Choose your role, one preference, confidence, and at least one reason.');return}
    setBusy(true);setError('');setSavedMessage('');
    const responseToken=receipt?.token||familyResponseToken();
    const pendingReceipt={token:responseToken,response:receipt?.response||null,pending:form};
    // Persist the idempotent reviewer identity before the write. If the server
    // commits but the response is lost, a retry must update the same row rather
    // than consume another one of the five slots.
    writeFamilyReceipt(room.id,pendingReceipt);setReceipt(pendingReceipt);
    try{
      const result=await api(`/api/family-alignment/${encodeURIComponent(token)}/response`,{method:'PUT',headers:{'x-family-response-token':responseToken},body:form});
      const saved=result.response||form;
      const nextReceipt={token:responseToken,response:saved,pending:null};
      const retained=writeFamilyReceipt(room.id,nextReceipt);setReceipt(nextReceipt);setForm(saved);
      setSavedMessage(retained
        ? (result.updated?'Your response was updated. Only this browser can amend it while the room remains open.':'Your private response was recorded. You may update it from this browser while the room remains open.')
        : 'Your private response was recorded, but this browser blocked the local receipt. Keep this page open if you may need to update it.');
    }catch(err){
      if(err.status===410){setPhase('closed');return}
      if(err.status===409&&(err.payload?.code==='family_alignment_full'||err.payload?.code==='room_full')){clearFamilyReceipt(room.id);setReceipt(null);setPhase('full');return}
      setError('Your response could not be saved. Please check the choices and try again.');
    }finally{setBusy(false)}
  }

  if(phase==='loading')return <main className="shared-state family-review-state"><Brand/><div role="status"><UserCircle/><span className="kicker">Private family review</span><h1>Opening the two options…</h1><p>No account is needed. The room is checked before any project facts are shown.</p></div></main>;
  if(phase!=='ready'&&phase!=='full'){
    const closed=phase==='closed';
    return <main className="shared-state family-review-state"><Brand/><div><XCircle/><span className="kicker">{closed?'Review closed':'Review unavailable'}</span><h1>{closed?'This family review has ended.':'This private link cannot be opened.'}</h1><p>{closed?'The room expired after seven days or was revoked by the project owner. No response can be viewed or submitted from this link.':error||'The link may be incomplete or unavailable. No response was collected on this page.'}</p><button className="copper-button" onClick={()=>route('/start')}>Plan my own home <ArrowRight/></button></div></main>;
  }
  const scenarios=Array.isArray(room.scenarios)?room.scenarios:[];
  const maxResponses=Number(room.maxResponses||5);
  const roomFull=phase==='full'||(Number(room.responseCount||0)>=maxResponses&&!receipt);
  const expiry=formatDateTime(room.expiresAt);
  return <main className="family-review-page">
    <header className="family-review__topbar"><Brand inverted/><span><LockKey/> Private review · closes {expiry}</span></header>
    <section className="family-review__hero"><div><span className="kicker">Family Alignment · independent review</span><h1>Your view matters.<br/><i>Choose honestly.</i></h1><p>Compare two concept-stage directions for someone in your family. You will not see anyone else’s answer, the owner’s choice, or an automated recommendation.</p></div><div aria-hidden="true"><strong>{Number(room.responseCount||0)}</strong><span>of {maxResponses}<br/>responses</span></div></section>
    <FamilyReviewComparison scenarios={scenarios} assumptions={room.assumptions} disclaimer={room.disclaimer}/>
    <section className="family-review__response" aria-labelledby="family-response-title">
      <header><span className="kicker">Your private response</span><h2 id="family-response-title">What would you support?</h2><p>This is structured decision input—not professional approval. No name, contact detail, or free-text comment is collected.</p></header>
      {roomFull?<div className="family-review__full" role="status"><UserCircle/><div><h3>This room has five responses.</h3><p>The project owner limited this review to five family members. Nothing was collected from you.</p></div></div>:<form onSubmit={submit} aria-busy={busy}>
        <fieldset><legend>How are you involved?</legend><div className="family-review__choice-grid family-review__choice-grid--roles">{familyRoles.map(([value,label])=><label key={value}><input type="radio" name="family-role" value={value} checked={form.role===value} onChange={()=>setForm({...form,role:value})}/><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend>Which direction would you support?</legend><div className="family-review__choice-grid family-review__choice-grid--preference">{[["A","Option A"],["B","Option B"],["not_ready","Not ready to choose"]].map(([value,label])=><label key={value}><input type="radio" name="family-preference" value={value} checked={form.preference===value} onChange={()=>setForm({...form,preference:value})}/><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend>How confident are you?</legend><div className="family-review__choice-grid">{familyConfidence.map(([value,label])=><label key={value}><input type="radio" name="family-confidence" value={value} checked={form.confidence===value} onChange={()=>setForm({...form,confidence:value})}/><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend>What is shaping your answer? <small>Choose one to three</small></legend><div className="family-review__choice-grid family-review__choice-grid--reasons">{familyReasons.map(([value,label])=>{const selected=form.reasons.includes(value);return <label key={value}><input type="checkbox" value={value} checked={selected} disabled={!selected&&form.reasons.length>=3} onChange={()=>toggleReason(value)}/><span>{label}</span></label>})}</div><p className="family-review__reason-count" aria-live="polite">{form.reasons.length} of 3 selected{form.reasons.length===3?' · remove one before choosing another':''}</p></fieldset>
        {savedMessage&&<p className="success-message" role="status"><CheckCircle/>{savedMessage}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
        <div className="family-review__submit"><p><ShieldCheck/> The project owner sees only aggregate counts and reasons—not your identity.</p><button className="copper-button copper-button--large" disabled={busy} type="submit">{busy?'Saving privately…':receipt?'Update my response':'Save my response'} <ArrowRight/></button></div>
      </form>}
    </section>
    <footer className="family-review__footer"><div><span className="kicker">Have a plot of your own?</span><h2>Start with the known facts—and an indicative planning range.</h2></div><button className="outline-button" onClick={()=>route('/start')}>Create my free Brief Check <ArrowRight/></button><p><ShieldCheck/> GrihaGrid is a concept-stage decision aid, not architectural, municipal, structural, or construction approval.</p></footer>
  </main>;
}

function CheckoutReturnPage({ orderId }) {
  const [state,setState]=useState({loading:true,order:null,error:""});
  useEffect(()=>{let active=true;let timer;let attempts=0;async function poll(){try{const result=await api(`/api/orders/${encodeURIComponent(orderId)}`);if(!active)return;setState({loading:false,order:result.order,error:""});if(!['paid','failed','refunded'].includes(result.order.status)&&attempts++<20)timer=window.setTimeout(poll,1500);}catch(err){if(!active)return;if(err instanceof ApiError&&err.status===401){route('/login');return}setState({loading:false,order:null,error:err.message});}}if(orderId)poll();else setState({loading:false,order:null,error:'Missing order reference.'});return()=>{active=false;window.clearTimeout(timer)}},[orderId]);
  const status=state.order?.status;
  const fulfillment=state.order?.fulfillment;
  const revoked=Boolean(state.order?.entitlement?.revokedAt);
  const paidMessage={ready:'Your purchased report snapshot is ready.',awaiting_input:'Payment is confirmed. Add the requested private site material to continue.',queued:'Payment is confirmed and your expert review is queued.',in_progress:'Your paid deliverable is now in progress.',failed:'Payment is confirmed, but fulfillment needs support attention.',cancelled:'This fulfillment was cancelled.'}[fulfillment?.status]||'Payment is confirmed. Fulfillment status is being prepared.';
  return <main className="checkout-return"><Brand/><section>{state.loading&&<><span className="kicker">Confirming with Razorpay</span><h1>Checking your payment.</h1><p role="status">This usually takes a few seconds. You can safely keep this page open.</p></>}{state.error&&<><WarningCircle/><span className="kicker">Payment status unavailable</span><h1>Your project is safe.</h1><p role="alert">{state.error} No fulfillment has started from this browser return alone.</p><button className="copper-button" onClick={()=>route('/dashboard')}>Open my projects <ArrowRight/></button></>}{state.order&&<><span className="kicker">Order · {state.order.id.slice(0,8)}</span><h1>{revoked?'Artifact access revoked.':status==='paid'?'Payment confirmed.':status==='failed'?'Checkout was not completed.':'Still confirming payment.'}</h1><p>{revoked?'A verified refund or payment dispute disabled the artifact and every share link. Contact support if this is unexpected.':status==='paid'?paidMessage:status==='failed'?'No entitlement was created. You may safely return to the project and try again.':'We have not received a verified payment event yet. This page will continue checking.'}</p><dl><div><dt>Plan</dt><dd>{state.order.planLabel}</dd></div><div><dt>Amount</dt><dd>₹{(state.order.amountPaise/100).toLocaleString('en-IN')}</dd></div><div><dt>Payment</dt><dd>{status}</dd></div>{fulfillment&&<div><dt>Fulfillment</dt><dd>{fulfillment.status.replaceAll('_',' ')}</dd></div>}</dl><button className="copper-button" onClick={()=>route('/dashboard')}>Open my projects <ArrowRight/></button></>}</section></main>;
}

const reportFeedbackOutcomes = [
  ["helpful", "Useful", "This gave me a clearer next step."],
  ["unclear", "Still unclear", "I need a clearer explanation before acting."],
  ["needs_review", "Needs checking", "A part of this report seems wrong or concerning."],
];

const reportFeedbackSections = [
  ["overall", "Whole report"],
  ["brief_check", "Brief Check"],
  ["programme", "Likely built-up & programme"],
  ["cost_range", "Planning range & cost allocation"],
  ["assumptions", "Risks & assumptions"],
  ["next_actions", "Professional checks & next actions"],
];

function normalizeReportFeedback(value, projectRevision, reportSchemaVersion) {
  if(value===null)return null;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Saved feedback identity is invalid. Reload this report before trying again.");
  const outcomes=new Set(reportFeedbackOutcomes.map(([key])=>key));
  const allowedSections=new Set(reportFeedbackSections.map(([key])=>key));
  const sections=Array.isArray(value.sections)?[...value.sections]:[];
  const valid=outcomes.has(value.outcome)
    &&sections.length>=1&&sections.length<=3
    &&sections.every(section=>typeof section==="string"&&allowedSections.has(section))
    &&new Set(sections).size===sections.length
    &&(!sections.includes("overall")||sections.length===1)
    &&value.projectRevision===projectRevision
    &&value.reportSchemaVersion===reportSchemaVersion
    &&typeof value.createdAt==="string"&&value.createdAt.length>0
    &&typeof value.updatedAt==="string"&&value.updatedAt.length>0;
  if(!valid)throw new Error("Saved feedback does not match this exact report. Reload the report before trying again.");
  return {...value,sections};
}

function normalizeReportEnvelope(value, projectId, expectedRevision=null) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("The saved report identity is incomplete. Reload before continuing.");
  const project=homeObject(value.project);
  const snapshot=homeObject(value.revision);
  const report=homeObject(value.report);
  const projectRevision=snapshot.revision;
  const reportSchemaVersion=snapshot.report?.schemaVersion;
  const valid=project.id===projectId
    &&report.projectId===projectId
    &&Number.isInteger(projectRevision)&&projectRevision>0
    &&Number.isInteger(reportSchemaVersion)&&reportSchemaVersion>0
    &&Number.isInteger(project.inputRevision)&&project.inputRevision===projectRevision
    &&snapshot.report?.available===true
    &&Number.isInteger(report.version)&&report.version===reportSchemaVersion
    &&typeof value.cached==="boolean"
    &&(expectedRevision!==null||snapshot.current===true)
    &&(expectedRevision===null||projectRevision===Number(expectedRevision));
  if(!valid)throw new Error("The saved report does not match its revision record. Reload before continuing.");
  return {project,snapshot,report,projectRevision,reportSchemaVersion};
}

function ReportFeedbackConcern({ unsaved=false }) {
  return <div className="report-feedback__concern" role="status"><WarningCircle/><p><strong>{unsaved?"Your concern was not saved—but do not rely on the item.":"Do not rely on a concerning item."}</strong> Take it to a licensed local professional. {unsaved?"The rejected response was not included in product learning and did not alert support.":"This structured response improves aggregate product learning but does not alert support."} For a product error, email <a href="mailto:hello@grihagrid.in">hello@grihagrid.in</a> without sending sensitive site details.</p></div>;
}

function ReportFeedback({ projectId, projectRevision, reportSchemaVersion, readonly=false, onProjectArchived=null }) {
  const [phase,setPhase]=useState("loading");
  const [feedback,setFeedback]=useState(null);
  const [outcome,setOutcome]=useState("");
  const [sections,setSections]=useState([]);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [archivedDuringSave,setArchivedDuringSave]=useState(false);
  const [archiveConflict,setArchiveConflict]=useState(null);
  const archiveNoticeRef=useRef(null);
  const groupId=useId();
  const boundaryId=`${groupId}-boundary`;
  const errorId=`${groupId}-error`;
  const sectionGuidanceId=`${groupId}-section-guidance`;
  const endpoint=`/api/projects/${encodeURIComponent(projectId)}/revisions/${projectRevision}/reports/${reportSchemaVersion}/feedback`;
  const readOnly=readonly||archivedDuringSave;

  async function load(signal) {
    setPhase("loading");setError("");setMessage("");setArchiveConflict(null);
    try{
      const result=await api(endpoint,{signal});
      if(signal?.aborted)return;
      const saved=normalizeReportFeedback(result.feedback,projectRevision,reportSchemaVersion);
      setFeedback(saved);setOutcome(saved?.outcome||"");setSections(saved?.sections||[]);setPhase("ready");
    }catch(err){
      if(signal?.aborted)return;
      if(err instanceof ApiError&&err.status===401){route("/login");return}
      setError(err?.message||"Feedback could not be opened.");setPhase("error");
    }
  }

  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[endpoint]);
  useEffect(()=>{if(archivedDuringSave)archiveNoticeRef.current?.focus()},[archivedDuringSave]);

  function toggleSection(section) {
    setMessage("");setError("");
    setSections(current=>{
      if(section==="overall")return current.includes("overall")?[]:["overall"];
      const withoutOverall=current.filter(item=>item!=="overall");
      if(withoutOverall.includes(section))return withoutOverall.filter(item=>item!==section);
      if(withoutOverall.length>=3)return withoutOverall;
      return [...withoutOverall,section];
    });
  }

  async function save(event) {
    event.preventDefault();setError("");setMessage("");
    if(!outcome){setError("Choose how this report helped before saving.");return}
    if(sections.length<1){setError("Choose at least one part of the report.");return}
    const updating=Boolean(feedback);
    setPhase("saving");
    try{
      const result=await api(endpoint,{method:"PUT",body:{outcome,sections}});
      const saved=normalizeReportFeedback(result.feedback,projectRevision,reportSchemaVersion);
      if(!saved)throw new Error("The server did not return the saved feedback record.");
      setFeedback(saved);setOutcome(saved.outcome);setSections(saved.sections);setPhase("ready");
      setMessage(updating?"Feedback updated. The saved report remains unchanged.":"Feedback saved. The saved report remains unchanged.");
    }catch(err){
      if(err instanceof ApiError&&err.status===401){route("/login");return}
      if(err instanceof ApiError&&err.status===409&&err.payload?.code==="project_archived"){
        const conflict={attemptedOutcome:outcome,hadSavedFeedback:Boolean(feedback)};
        setArchiveConflict(conflict);setArchivedDuringSave(true);onProjectArchived?.();setError("");setMessage("");setPhase("archive_refreshing");
        try{
          const authoritative=await resolveArchivedReportFeedback({
            cachedFeedback:feedback,
            attemptedOutcome:outcome,
            readFeedback:()=>api(endpoint),
            normalizeFeedback:value=>normalizeReportFeedback(value,projectRevision,reportSchemaVersion),
          });
          setFeedback(authoritative.feedback);setOutcome(authoritative.outcome);setSections(authoritative.sections);setArchiveConflict(authoritative.conflict);setPhase("ready");
        }catch(refreshError){
          if(refreshError instanceof ApiError&&refreshError.status===401){route("/login");return}
          setError("The project is read only, but the latest saved feedback could not be confirmed. Reload this report before relying on the feedback summary.");setPhase("archive_refresh_error");
        }
        return
      }
      setError(err?.message||"Feedback could not be saved. Your report remains unchanged.");setPhase("ready");
    }
  }

  const outcomeLabel=reportFeedbackOutcomes.find(([key])=>key===feedback?.outcome)?.[1];
  const sectionLabels=(feedback?.sections||[]).map(section=>reportFeedbackSections.find(([key])=>key===section)?.[1]).filter(Boolean);
  const concernState=reportFeedbackConcernState(feedback?.outcome,archiveConflict?.attemptedOutcome);
  const busy=phase==="saving";
  const sectionGuidance=sections.includes("overall")
    ? "Whole report selected. Clear it to choose individual parts."
    : sections.length>=3
      ? "3 of 3 parts selected. Clear a selected part before choosing another."
      : `${sections.length} of 3 parts selected. Choose one to three; Whole report cannot be combined with another part.`;

  return <section className={`report-feedback ${readOnly?"report-feedback--readonly":""}`} aria-labelledby={`${groupId}-title`} aria-busy={phase==="loading"||phase==="archive_refreshing"||busy}>
    <header className="report-feedback__heading"><div><span className="kicker">Report feedback · separate record</span><h2 id={`${groupId}-title`}>Did this make the next decision clearer?</h2></div><p>Rate this exact revision so GrihaGrid can learn where its planning evidence helps—and where it needs more care.</p></header>
    <div className="report-feedback__boundary" id={boundaryId}><LockKey/><p><strong>Your report stays immutable.</strong> Feedback is stored separately against revision {projectRevision}, report schema v{reportSchemaVersion}. It never changes the saved report and is not a request for, or a substitute for, professional review.</p></div>
    {phase==="loading"&&<div className="report-feedback__loading" role="status"><ArrowClockwise/> Opening saved feedback…</div>}
    {phase==="archive_refreshing"&&<div className="report-feedback__loading" role="status"><ArrowClockwise/> Confirming the latest saved feedback…</div>}
    {phase==="error"&&<div className="report-feedback__message"><p className="form-error" id={errorId} role="alert">{error}</p><button type="button" className="outline-button report-feedback__retry" onClick={()=>load()}>Try again <ArrowClockwise/></button></div>}
    {archivedDuringSave&&<p ref={archiveNoticeRef} tabIndex="-1" className="report-feedback__archive-notice" role="status">This project was archived in another session. Your latest feedback {archiveConflict?.hadSavedFeedback?"change":"response"} was not saved. {phase==="ready"?(feedback?"The latest saved response is shown below.":"No feedback response was recorded."):phase==="archive_refresh_error"?"The latest saved response could not be confirmed.":"GrihaGrid is checking the latest saved response now."} The full report is now read only.</p>}
    {phase==="archive_refresh_error"&&<div className="report-feedback__message"><p className="form-error" id={errorId} role="alert">{error} Do not rely on any item that seems wrong or concerning.</p><button type="button" className="outline-button report-feedback__retry" onClick={()=>window.location.reload()}>Reload report <ArrowClockwise/></button></div>}
    {archivedDuringSave&&phase!=="ready"&&archiveConflict?.attemptedOutcome==="needs_review"&&<ReportFeedbackConcern unsaved/>}
    {phase==="ready"&&readOnly&&<div className="report-feedback__readonly" role="status">{feedback?<><CheckCircle/><div><span>{archiveConflict?"Previously recorded feedback":"Feedback recorded"}</span><strong>{outcomeLabel}</strong><p>{sectionLabels.join(" · ")}{feedback.updatedAt?` · Updated ${formatDate(feedback.updatedAt)}`:""}</p></div></>:<><LockKey/><div><span>Archived feedback</span><strong>No feedback was recorded.</strong><p>This report is read only, so a new response cannot be added.</p></div></>}</div>}
    {phase==="ready"&&readOnly&&concernState.visible&&<ReportFeedbackConcern unsaved={concernState.unsaved}/>}
    {(phase==="ready"||phase==="saving")&&!readOnly&&<form className="report-feedback__form" onSubmit={save} aria-describedby={`${boundaryId}${error?` ${errorId}`:""}`}>
      <fieldset className="report-feedback__outcomes" disabled={busy}><legend>How did this report land?</legend><div>{reportFeedbackOutcomes.map(([key,label,copy])=><label key={key}><input type="radio" name={`${groupId}-outcome`} value={key} checked={outcome===key} onChange={()=>{setOutcome(key);setError("");setMessage("")}}/><span><strong>{label}</strong><small>{copy}</small></span></label>)}</div></fieldset>
      {outcome==="needs_review"&&<ReportFeedbackConcern/>}
      <fieldset className="report-feedback__sections" disabled={busy} aria-describedby={sectionGuidanceId}><legend>Which part shaped that answer?</legend><p id={sectionGuidanceId} aria-live="polite" aria-atomic="true">{sectionGuidance}</p><div>{reportFeedbackSections.map(([key,label])=>{const checked=sections.includes(key);const atLimit=!checked&&key!=="overall"&&!sections.includes("overall")&&sections.length>=3;return <label key={key}><input type="checkbox" value={key} checked={checked} disabled={busy||atLimit} onChange={()=>toggleSection(key)}/><span>{label}</span></label>})}</div></fieldset>
      <div className="report-feedback__actions"><button type="submit" className="outline-button" disabled={busy}>{busy?"Saving feedback…":feedback?"Update feedback":"Save feedback"}</button>{feedback?.updatedAt&&<small>Last saved {formatDate(feedback.updatedAt)}</small>}</div>
      <div className="report-feedback__message" aria-live="polite">{message&&<p className="success-message" role="status"><CheckCircle/>{message}</p>}{error&&<p className="form-error" id={errorId} role="alert">{error}</p>}</div>
    </form>}
  </section>;
}

function ReportPage({ id, revision=null }) {
  const [state,setState]=useState({phase:"loading",project:null,report:null,input:null,estimate:null,briefCheck:null,projectRevision:null,reportSchemaVersion:null,error:"",historical:false});
  const [generating,setGenerating]=useState(false);
  const [uploadWarning,setUploadWarning]=useState(()=>sessionStorage.getItem(`grihagrid.uploadWarning.${id}`)||"");

  async function load(signal) {
    setState(current=>({...current,phase:"loading",error:""}));
    try {
      if(revision){
        const reportResult=await api(`/api/projects/${encodeURIComponent(id)}/revisions/${revision}/report`,{signal});
        if(signal?.aborted)return;
        const envelope=normalizeReportEnvelope(reportResult,id,revision);
        setState({phase:"ready",project:envelope.project,report:envelope.report,input:homeObject(envelope.snapshot.input),estimate:homeObject(envelope.snapshot.estimate),briefCheck:envelope.snapshot.briefCheck||null,projectRevision:envelope.projectRevision,reportSchemaVersion:envelope.reportSchemaVersion,error:"",historical:true});
        return;
      }
      try{
        const reportResult=await api(`/api/projects/${encodeURIComponent(id)}/report`,{signal});
        if(signal?.aborted)return;
        const envelope=normalizeReportEnvelope(reportResult,id);
        setState({phase:"ready",project:envelope.project,report:envelope.report,input:homeObject(envelope.snapshot.input),estimate:homeObject(envelope.snapshot.estimate),briefCheck:envelope.snapshot.briefCheck||null,projectRevision:envelope.projectRevision,reportSchemaVersion:envelope.reportSchemaVersion,error:"",historical:false});
      }catch(err){
        if(signal?.aborted)return;
        if(err instanceof ApiError&&err.status===404&&err.payload?.code==="report_not_found"){
          const projectResult=await api(`/api/projects/${encodeURIComponent(id)}`,{signal});
          if(signal?.aborted)return;
          const project=homeObject(projectResult.project);
          setState({phase:"missing",project,report:null,input:project.input,estimate:project.estimate,briefCheck:project.briefCheck||null,projectRevision:null,reportSchemaVersion:null,error:"",historical:false});return
        }
        throw err;
      }
    }catch(err){
      if(signal?.aborted)return;
      if(err instanceof ApiError&&err.status===401){route("/login");return}
      if(revision&&err instanceof ApiError&&err.status===404&&err.payload?.code==="revision_report_not_found"){setState({phase:"historical_report_missing",project:null,report:null,input:null,estimate:null,briefCheck:null,projectRevision:null,reportSchemaVersion:null,error:"",historical:true});return}
      if(revision&&err instanceof ApiError&&err.status===404&&err.payload?.code==="project_revision_not_found"){setState({phase:"historical_revision_missing",project:null,report:null,input:null,estimate:null,briefCheck:null,projectRevision:null,reportSchemaVersion:null,error:"",historical:true});return}
      setState({phase:"error",project:null,report:null,input:null,estimate:null,briefCheck:null,projectRevision:null,reportSchemaVersion:null,error:err?.message||"The report could not be opened.",historical:Boolean(revision)});
    }
  }

  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[id,revision]);

  async function generateReport() {
    if(state.project?.status==="archived"||revision)return;
    setGenerating(true);setState(current=>({...current,error:""}));
    try{const result=await api(`/api/projects/${encodeURIComponent(id)}/report`,{method:"POST",body:{}});const envelope=normalizeReportEnvelope(result,id);setState(current=>({...current,phase:"ready",project:envelope.project,report:envelope.report,input:homeObject(envelope.snapshot.input),estimate:homeObject(envelope.snapshot.estimate),briefCheck:envelope.snapshot.briefCheck||null,projectRevision:envelope.projectRevision,reportSchemaVersion:envelope.reportSchemaVersion,error:""}));}
    catch(err){if(err instanceof ApiError&&err.status===401)route("/login");else setState(current=>({...current,error:err?.message||"The current report could not be generated."}));}
    finally{setGenerating(false)}
  }

  if(state.phase==="loading")return <main className="report-page report-page--state"><header><button onClick={()=>route(revision?`/projects/${id}/brief`:`/projects/${id}`)}><ArrowLeft/> {revision?"Brief history":"Project home"}</button><Brand/><span><LockKey/> Private report</span></header><section className="report-state" aria-busy="true"><FileText/><span className="kicker">Decision book</span><h1>Opening the saved record…</h1><p role="status">This read checks for an existing report. It does not generate one.</p></section></main>;
  if(state.phase==="historical_report_missing")return <main className="report-page report-page--state"><header><button onClick={()=>route(`/projects/${id}/brief`)}><ArrowLeft/> Brief history</button><Brand/><span><LockKey/> Historical evidence</span></header><section className="report-state"><FileText/><span className="kicker">Revision {revision} · no saved report</span><h1>This revision exists without a report artifact.</h1><p>The brief snapshot remains in history, but no report was saved with it. GrihaGrid will not generate one retroactively.</p><button className="copper-button" onClick={()=>route(`/projects/${id}/brief`)}>Return to history <ArrowRight/></button></section></main>;
  if(state.phase==="historical_revision_missing")return <main className="report-page report-page--state"><header><button onClick={()=>route(`/projects/${id}/brief`)}><ArrowLeft/> Brief history</button><Brand/><span><LockKey/> Historical evidence</span></header><section className="report-state"><Compass/><span className="kicker">Revision {revision} · not found</span><h1>This revision is not in the saved history.</h1><p>No brief snapshot or report artifact is claimed for this revision number.</p><button className="copper-button" onClick={()=>route(`/projects/${id}/brief`)}>Return to history <ArrowRight/></button></section></main>;
  if(state.phase==="error")return <main className="error-page"><WarningCircle/><h1>We could not open this report.</h1><p role="alert">{state.error}</p><button className="copper-button" onClick={()=>route(revision?`/projects/${id}/brief`:`/projects/${id}`)}>Back to {revision?"brief history":"project home"}</button></main>;
  if(state.phase==="missing"){
    const archived=state.project?.status==="archived";
    return <main className="report-page report-page--state"><header><button onClick={()=>route(`/projects/${id}`)}><ArrowLeft/> Project home</button><Brand/><span><LockKey/> {archived?"Archived · read only":"Private project"}</span></header><section className="report-state"><FileText/><span className="kicker">{archived?"Archived record":"Current revision"} · no saved report</span><h1>{archived?"No report was saved for this archive.":"Generate the current decision book when you are ready."}</h1><p>{archived?"The project remains readable, but an archived record never triggers new report generation.":"The read-only check found no current report. Generation is a separate, explicit action and will use the project’s current Brief Check facts."}</p>{state.error&&<p className="form-error" role="alert">{state.error}</p>}{!archived&&<button className="copper-button copper-button--large" disabled={generating} onClick={generateReport}>{generating?"Generating current report…":"Generate current report"} <ArrowRight/></button>}{archived&&<button className="outline-button" onClick={()=>route(`/projects/${id}/brief`)}>Review brief history <ArrowRight/></button>}</section></main>;
  }

  const project=state.project||{};
  const input=state.input||project.input||{};
  const estimate=state.estimate||project.estimate||{};
  const report=state.report||{};
  const historical=state.historical;
  const archived=project.status==="archived";
  const reportSchemaVersion=Number(state.reportSchemaVersion||report.version||1);
  const legacyArtifact=historical&&reportSchemaVersion<2;
  const check=legacyArtifact?null:briefCheckRecord(state.briefCheck||report.briefCheck||project.briefCheck);
  const projectRevision=Number(state.projectRevision);
  const savedReportTitle=String(report.title||"").replace(/\s+[—-]\s+(?:feasibility|planning) report$/iu,"").trim();
  const reportTitle=historical?savedReportTitle||"Historical project":project.name||savedReportTitle||"My family home";
  const firstRisk=legacyArtifact?null:report.risks?.[0]||"Local setbacks, access and site conditions require professional validation.";
  const costCategories=legacyArtifact?(Array.isArray(report.costPlan?.categories)?report.costPlan.categories:[]):report.costPlan?.categories||[["Civil and structure",38],["Finishes",26],["Electrical and plumbing",14],["Doors and windows",9],["Approvals and setup",5],["Contingency",8]].map(([name,percent])=>({name,percent,amountInr:Math.round(((estimate.lowInr+estimate.highInr)/2||4000000)*percent/100)}));
  const legacyFacts=[report.summary?.city,report.summary?.plotSqft?`${Number(report.summary.plotSqft).toLocaleString("en-IN")} sq ft plot`:null,report.summary?.floorCount?`${report.summary.floorCount} floor${Number(report.summary.floorCount)===1?"":"s"}`:null].filter(Boolean);
  return <main className={`report-page ${archived?"report-page--archived":""} ${historical?"report-page--historical":""}`}><header><button onClick={()=>route(historical?`/projects/${id}/brief`:`/projects/${id}`)}><ArrowLeft/> {historical?"Brief history":"Project home"}</button><Brand/><button onClick={()=>window.print()}><DownloadSimple/> Download / print</button></header><div className="report-document">
    {uploadWarning&&!historical&&<div className="report-upload-warning" role="alert"><WarningCircle/><span>{uploadWarning}</span><button onClick={()=>{sessionStorage.removeItem(`grihagrid.uploadWarning.${id}`);setUploadWarning("")}}>Dismiss</button></div>}
    {historical&&<section className="report-archived-notice report-historical-notice" role="status"><LockKey/><div><strong>Immutable revision evidence · Revision {revision}</strong><p>{reportSchemaVersion<2?`Legacy saved report · schema v${reportSchemaVersion}. `:`Saved report schema v${reportSchemaVersion}. `}This is the artifact actually saved with this revision. It is read only, never regenerated, and does not represent the current project unless the history identifies it as current.</p></div></section>}
    {!historical&&archived&&<section className="report-archived-notice" role="status"><LockKey/><div><strong>Archived report · read only</strong><p>This saved report remains readable. AI generation, comparison changes, checkout, link creation, copying and uploads are unavailable. Existing file records remain listed below; opening or permanently deleting them requires private storage to be available, and the file section shows its current state.</p></div></section>}
    <section className="report-cover"><span className="kicker">GrihaGrid decision book · {historical?`revision ${revision} · schema v${reportSchemaVersion}`:`report v${reportSchemaVersion}`}</span><h1>{reportTitle}</h1><p>{legacyArtifact?(legacyFacts.join(" · ")||"Legacy saved report"):<>{input.width} × {input.length} ft · {input.facing||"Facing not stated"}{input.facing?"-facing":""} · {input.city||"City not stated"}</>}</p><div><span>{historical?"Immutable historical evidence":archived?"Archived concept":"Concept stage"}</span><span>{formatDate(report.generatedAt)}</span></div></section>
    {!legacyArtifact&&<section className="report-hero"><img loading="lazy" width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Warm modern home direction"/><div><span>Exterior direction</span><strong>{input.style||"Not stated"}</strong></div></section>}
    {legacyArtifact?<>{(report.summary?.targetBuiltUpSqft||report.costPlan?.lowInr||report.costPlan?.highInr)&&<section className="report-facts">{report.summary?.targetBuiltUpSqft&&<div><span>Saved built-up</span><strong>{Number(report.summary.targetBuiltUpSqft).toLocaleString("en-IN")} sq ft</strong></div>}{report.costPlan?.lowInr&&report.costPlan?.highInr&&<div><span>Saved planning range</span><strong>{formatLakh(report.costPlan.lowInr)}–{formatLakh(report.costPlan.highInr)}</strong></div>}{report.summary?.quality&&<div><span>Saved finish</span><strong>{report.summary.quality}</strong></div>}</section>}<section className="report-copy"><div><span className="kicker">Saved legacy reading</span><h2>{report.summary?.verdict||"Legacy report"}</h2></div><div>{Array.isArray(report.risks)&&report.risks.map((risk,index)=><p key={`legacy-risk-${index}`}>{risk}</p>)}{Array.isArray(report.nextActions)&&report.nextActions.length>0&&<p>{report.nextActions.join(" ")}</p>}</div></section></>:<><section className="report-facts"><div><span>Brief Check</span><strong>{check.label}</strong><small>Evidence status, not professional approval</small></div><div><span>Likely built-up</span><strong>{Number(estimate.builtUpSqft||report.summary?.targetBuiltUpSqft||0).toLocaleString("en-IN")} sq ft</strong><small>{input.floors||"Floor count not stated"} concept</small></div><div><span>Planning range</span><strong>{formatLakh(estimate.lowInr||report.costPlan?.lowInr)}–{formatLakh(estimate.highInr||report.costPlan?.highInr)}</strong><small>{input.quality||"Unstated"} finish</small></div></section><section className="report-copy"><div><span className="kicker">Brief Check reading</span><h2>{check.headline}</h2></div><div><p>{check.summary}</p><p>{firstRisk}</p><p>{report.nextActions?.slice(0,2).join(" ")||"Commission a measured survey and validate the brief with every decision-maker before detailed design."}</p></div></section></>}
    {costCategories.length>0&&<section className="report-budget"><h2>Indicative cost allocation</h2>{costCategories.map(category=><div key={category.name}><span>{category.name}</span><i><b style={{width:`${category.percent}%`}}/></i><strong>{formatLakh(category.amountInr)}</strong></div>)}</section>}
    <section className="report-boundary"><ShieldCheck/><p><strong>Use this report to explore—not as professional site validation or construction instruction.</strong> A licensed local architect and structural engineer must validate measurements, access, site conditions, bylaws, drawings and specifications.</p></section>
    {Number.isInteger(projectRevision)&&projectRevision>0&&reportSchemaVersion===2&&<ReportFeedback key={`${id}:${projectRevision}:${reportSchemaVersion}`} projectId={id} projectRevision={projectRevision} reportSchemaVersion={reportSchemaVersion} readonly={archived} onProjectArchived={()=>setState(current=>({...current,project:{...current.project,status:"archived"}}))}/>}
    {!historical&&<><section className={`report-compare-bridge ${archived?"report-compare-bridge--archived":""}`}><div><span className="kicker">Decision Compare · two alternatives</span><h2>{archived?"Open the saved comparison record.":"What changes if the brief changes?"}</h2><p>{archived?"If a versioned comparison exists, it opens as read-only evidence. No browser draft will be treated as a saved project record.":"Hold the plot constant. Compare exactly two ways to trade area, programme and planning cost—then record one direction for the family and architect."}</p></div><div><ArrowsLeftRight/><button className={archived?"outline-button":"copper-button"} onClick={()=>route(`/projects/${id}/compare`)}>{archived?"Open comparison record":"Compare two options"} <ArrowRight/></button>{!archived&&<button className="underlined-action" onClick={()=>route("/compare/sample")}>See a sample first</button>}</div></section><AiPlanningBrief projectId={id} readonly={archived}/>{!archived&&<PurchasePanel projectId={id}/>}<ProjectFiles projectId={id} readonly={archived}/></>}
  </div></main>;
}

function LegalPage({ type }) {
  const title={privacy:'Privacy policy',terms:'Terms of use',refund:'Refund & cancellation'}[type];
  return <main className="legal-page"><span className="kicker">Legal · Plain language</span><h1>{title}</h1><p className="legal-date">Effective 15 August 2026</p><section><h2>The short version</h2><p>GrihaGrid is a concept-stage planning service. We collect the minimum information needed to operate your account, save projects, generate reports and support purchases. Project information is private by default.</p><h2>Your files and account</h2><p>Account sessions use secure, HTTP-only cookies. Private uploads are optional and may not be enabled in every release; the product checks availability before accepting a file. When enabled, uploaded site material is account-scoped, served only through authenticated requests, and can be deleted by the project owner. The Brief Check and concept-planning range remain available without uploads.</p>{type==='privacy'&&<><h2>Gemini-assisted briefs</h2><p>AI briefs are for users aged 18 or older and require consent before generation. We send sanitized planning facts—not account details, precise addresses or uploaded files—to Google Gemini. On Google’s Free tier, inputs and outputs may be reviewed or used to improve its products. Gemini output is advisory and is saved with your project.</p><h2>Report feedback</h2><p>If you choose to rate a saved report, we store one outcome and one to three fixed section labels—never free text—against your account-owned project, exact project revision and report schema version. We use this to understand which planning evidence is useful, unclear or needs checking; it does not alter the report or request professional review.</p><p>Feedback remains with the private project, including while it is archived read-only, until the project is deleted. Project deletion removes the linked feedback. Product metrics expose only aggregate outcome and section counts, without account, project, revision or report identity.</p></>}{type!=='refund'&&<><h2>Family Alignment</h2><p>A project owner may create a seven-day bearer link showing two redacted options. Anyone holding that link can access the review until it expires or is revoked, so owners should share it carefully. Reviewers provide only a role category, preference, confidence and one to three structured reasons; GrihaGrid does not collect their name, contact details or free-text comments.</p><p>The owner sees aggregate response counts and reasons, not reviewer profiles or contact identity. A random response receipt and the reviewer’s own structured choices are cached locally in that browser so the response can be amended while the room remains open. GrihaGrid sends neither value to analytics. Clearing this site’s browser data removes the local copy and update capability. Family responses are advisory and never constitute professional approval.</p><p>Expired or revoked rooms and their structured responses may be retained for up to 90 days for bounded support, abuse review and audit, then the room and its responses are deleted together. An unpaid project deletion removes its Family Alignment rooms and responses through the same project deletion workflow.</p></>}<h2>Professional boundary</h2><p>Generated concepts, estimates and compliance cues are indicative. They do not replace licensed architectural, structural, geotechnical, legal, tax or municipal advice.</p><h2>Payments and refunds</h2><p>The free Brief Check requires no payment. Digital reports may be cancelled before generation begins. Expert reviews may be cancelled before a professional accepts the assignment. Final policy is subject to applicable Indian consumer law.</p><h2>Contact</h2><p>Email <a href="mailto:hello@grihagrid.in">hello@grihagrid.in</a>. These policies must receive final counsel review before live payment activation.</p></section></main>;
}

function NotFoundPage() { return <main className="error-page"><Compass/><span className="kicker">404 · Outside the plot</span><h1>This page is not in the plan.</h1><p>The address may have changed, or the page may never have existed.</p><button className="copper-button" onClick={()=>route('/')}>Return home <ArrowRight/></button></main>; }

function AppShell({ user, children }) { return <><a className="skip-link" href="#main-content">Skip to content</a><Header user={user}/><div id="main-content">{children}</div><Footer/></>; }

export function App() {
  const [path,setPath]=useState(window.location.pathname);const [user,setUser]=useState(undefined);
  const focusedPath=useRef(path);
  const authRevision=useRef(0);
  const authenticatedSession=useRef(false);
  useEffect(()=>{const onPop=()=>setPath(window.location.pathname);window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  useEffect(()=>{
    const applyRemoteLogout=()=>{authRevision.current+=1;authenticatedSession.current=false;clearLocalLogoutState();setUser(null);if(isPrivateAccountPath(window.location.pathname))replaceRoute('/',{logoutConfirmed:true})};
    const onStorage=event=>{if(isLogoutBroadcast(event))applyRemoteLogout()};
    const onChannel=event=>{if(isLogoutChannelMessage(event))applyRemoteLogout()};
    let channel=null;
    try{channel=new window.BroadcastChannel(LOGOUT_CHANNEL_NAME);channel.addEventListener('message',onChannel)}catch{/* Storage event and resume validation remain available. */}
    window.addEventListener('storage',onStorage);
    return()=>{window.removeEventListener('storage',onStorage);if(channel){channel.removeEventListener('message',onChannel);channel.close()}};
  },[]);
  useEffect(()=>{const revision=authRevision.current;api('/api/auth/me').then(x=>{if(authRevision.current===revision){authenticatedSession.current=Boolean(x.user);setUser(x.user||null);if(x.user&&window.history.state?.logoutConfirmed===true)replaceRoute(window.location.pathname,{})}}).catch(error=>{if(authRevision.current===revision&&isApplicationUnauthenticated(error)){authenticatedSession.current=false;setUser(null)}});},[]);
  useEffect(()=>{
    let checking=false;
    const revalidate=async()=>{
      const pathname=window.location.pathname;
      const requestedLocation=`${pathname}${window.location.search}${window.location.hash}`;
      const privatePath=isPrivateAccountPath(pathname);
      const confirmationVisible=window.history.state?.logoutConfirmed===true;
      if(checking||!shouldRevalidateSession(privatePath,window.history.state))return;
      checking=true;const revision=authRevision.current;
      const targetIsCurrent=()=>isCurrentSessionRevalidationTarget(
        requestedLocation,
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        confirmationVisible,
        window.history.state,
      );
      try{const result=await api('/api/auth/me');if(authRevision.current===revision){authenticatedSession.current=Boolean(result.user);setUser(result.user||null);if(result.user&&confirmationVisible&&targetIsCurrent())replaceRoute(requestedLocation,{})}}
      catch(error){
        if(authRevision.current!==revision)return;
        if(isApplicationUnauthenticated(error)){
          const wasAuthenticated=authenticatedSession.current;
          authenticatedSession.current=false;clearLocalLogoutState();setUser(null);
          if(privatePath&&targetIsCurrent()){const destination=privateRouteAfterUnauthenticated(wasAuthenticated);authRevision.current+=1;replaceRoute(destination.path,destination.state)}
        }else if(confirmationVisible&&targetIsCurrent()){
          setUser(undefined);
          replaceRoute(requestedLocation,{});
        }
      }
      finally{checking=false}
    };
    const onVisibility=()=>{if(document.visibilityState==='visible')revalidate()};
    window.addEventListener('focus',revalidate);window.addEventListener('pageshow',revalidate);document.addEventListener('visibilitychange',onVisibility);
    return()=>{window.removeEventListener('focus',revalidate);window.removeEventListener('pageshow',revalidate);document.removeEventListener('visibilitychange',onVisibility)};
  },[]);
  useEffect(()=>{const titles={'/':'GrihaGrid — Know what fits. Know what it costs.','/pricing':'Pricing — GrihaGrid','/about':'About — GrihaGrid','/plans':'Sample plan — GrihaGrid','/compare/sample':'Sample Decision Compare — GrihaGrid','/start':'Plan my home — GrihaGrid','/login':'Log in — GrihaGrid','/register':'Create account — GrihaGrid','/dashboard':'My projects — GrihaGrid','/orders':'Orders — GrihaGrid','/privacy':'Privacy — GrihaGrid','/terms':'Terms — GrihaGrid','/refund':'Refunds — GrihaGrid'};document.title=path.startsWith('/report/')?'Decision book — GrihaGrid':path.startsWith('/projects/')&&path.endsWith('/brief')?'Brief Check — GrihaGrid':path.startsWith('/projects/')&&path.endsWith('/compare')?'Decision Compare — GrihaGrid':path.startsWith('/projects/')?'Project home — GrihaGrid':path.startsWith('/orders/')?'Purchased artifact — GrihaGrid':path.startsWith('/share/decision/')?'Shared decision — GrihaGrid':path.startsWith('/align/')?'Family review — GrihaGrid':(titles[path]||'Page not found — GrihaGrid')},[path]);
  useEffect(()=>{
    if(focusedPath.current===path)return undefined;
    focusedPath.current=path;
    let frame;
    let focusedHeading=null;
    let restoreTabIndex=()=>{};
    const focusHeading=()=>{
      const heading=document.querySelector('main h1');
      if(!heading||heading===focusedHeading)return;
      restoreTabIndex();
      const previousTabIndex=heading.getAttribute('tabindex');
      focusedHeading=heading;
      heading.setAttribute('tabindex','-1');
      restoreTabIndex=()=>{
        if(previousTabIndex===null)heading.removeAttribute('tabindex');
        else heading.setAttribute('tabindex',previousTabIndex);
      };
      heading.addEventListener('blur',restoreTabIndex,{once:true});
      heading.focus({preventScroll:true});
    };
    frame=window.requestAnimationFrame(()=>{
      focusHeading();
      const hash=window.location.hash.slice(1);
      const target=hash?document.getElementById(safeDecodePathSegment(hash)):null;
      if(target)target.scrollIntoView({block:'start'});
      else window.scrollTo({top:0,behavior:'auto'});
    });
    const observer=new MutationObserver(()=>{
      if(focusedHeading?.isConnected)return;
      const active=document.activeElement;
      if(active&&active!==document.body&&active!==document.documentElement)return;
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(focusHeading);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      if(focusedHeading)focusedHeading.removeEventListener('blur',restoreTabIndex);
      restoreTabIndex();
    };
  },[path]);
  const historicalReportMatch=path.match(/^\/report\/([^/]+)\/revision\/([1-9]\d*)$/);
  const reportMatch=path.match(/^\/report\/([^/]+)$/);
  const briefMatch=path.match(/^\/projects\/([^/]+)\/brief$/);
  const decisionMatch=path.match(/^\/projects\/([^/]+)\/compare$/);
  const projectHomeMatch=path.match(/^\/projects\/([^/]+)$/);
  const artifactMatch=path.match(/^\/orders\/([^/]+)\/artifact$/);
  const shareMatch=path.match(/^\/share\/decision\/([^/]+)$/);
  const alignmentMatch=path.match(/^\/align\/([^/]+)$/);
  const checkoutOrder=path==='/checkout/return'?new URLSearchParams(window.location.search).get('order'):null;
  if(path==='/start')return <StartPage user={user}/>;
  if(path==='/login'||path==='/register')return <AuthPage key={path} mode={path.slice(1)} onAuthenticated={authenticated=>{authRevision.current+=1;authenticatedSession.current=true;setUser(authenticated)}}/>;
  if(path==='/dashboard')return <Dashboard user={user} onLogout={()=>{authRevision.current+=1;authenticatedSession.current=false;setUser(null)}}/>;
  if(path==='/orders')return <OrderHistoryPage user={user} onLogout={()=>{authRevision.current+=1;authenticatedSession.current=false;setUser(null)}}/>;
  if(briefMatch)return <BriefPage projectId={safeDecodePathSegment(briefMatch[1])}/>;
  if(decisionMatch)return <DecisionComparePage projectId={safeDecodePathSegment(decisionMatch[1])}/>;
  if(projectHomeMatch)return <ProjectHomePage projectId={safeDecodePathSegment(projectHomeMatch[1])}/>;
  if(historicalReportMatch)return <ReportPage id={safeDecodePathSegment(historicalReportMatch[1])} revision={Number(historicalReportMatch[2])}/>;
  if(reportMatch)return <ReportPage id={safeDecodePathSegment(reportMatch[1])}/>;
  if(artifactMatch)return <PurchasedArtifactPage orderId={safeDecodePathSegment(artifactMatch[1])}/>;
  if(shareMatch)return <SharedDecisionPage token={safeDecodePathSegment(shareMatch[1])}/>;
  if(alignmentMatch)return <FamilyAlignmentReviewPage token={alignmentMatch[1]}/>;
  if(path==='/checkout/return')return <CheckoutReturnPage orderId={checkoutOrder}/>;
  let page=path==='/'?<HomePage user={user}/>:<NotFoundPage/>;
  if(path==='/pricing')page=<PricingPage/>;else if(path==='/about')page=<AboutPage/>;else if(path==='/plans')page=<SamplePlanPage/>;else if(path==='/compare/sample')page=<SampleDecisionComparePage/>;else if(path==='/privacy'||path==='/terms'||path==='/refund')page=<LegalPage type={path.slice(1)}/>;
  return <AppShell user={user}>{page}</AppShell>;
}
