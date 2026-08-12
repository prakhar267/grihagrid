import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Blueprint, Buildings, Check, CheckCircle, Compass,
  CurrencyInr, DownloadSimple, FileText, House, List, LockKey, MapPin,
  Plus, Ruler, ShieldCheck, SignOut, Sparkle, Trash, UploadSimple, UserCircle,
  WarningCircle, X,
} from "@phosphor-icons/react";
import { api, ApiError, formatLakh } from "./api.js";

const cityFactors = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: .98, Chennai: 1.02, Jaipur: .88, Other: .95 };
const qualityRates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };
const floorFactors = { G: .72, "G+1": 1.22, "G+2": 1.65 };

function useCommerceCatalog() {
  const [availability,setAvailability]=useState({});
  useEffect(()=>{let active=true;api('/api/commerce/catalog').then(result=>{if(active)setAvailability(Object.fromEntries((result.plans||[]).map(plan=>[plan.id,Boolean(plan.acceptingOrders)])))}).catch(()=>{if(active)setAvailability({})});return()=>{active=false}},[]);
  return availability;
}

function route(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const hash = path.includes("#") ? path.slice(path.indexOf("#") + 1) : "";
  window.requestAnimationFrame(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash)) : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    else {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const heading = document.querySelector("main h1");
      if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
    }
  });
}

function Brand({ inverted = false }) {
  return <button className={`brand ${inverted ? "brand--inverted" : ""}`} onClick={() => route("/")} aria-label="GrihaGrid home">GrihaGrid</button>;
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
  const [width, setWidth] = useState(initial?.width || 30);
  const [length, setLength] = useState(initial?.length || 50);
  const [city, setCity] = useState(initial?.city || "Bengaluru");
  const [floors, setFloors] = useState(initial?.floors || "G+1");
  const [quality] = useState(initial?.quality || "Signature");
  const estimate = useMemo(() => {
    const builtUp = Math.round(width * length * floorFactors[floors]);
    const midpoint = builtUp * qualityRates[quality] * cityFactors[city];
    return { builtUp, low: midpoint * .92, high: midpoint * 1.1 };
  }, [width, length, city, floors, quality]);
  return <div className={`estimate-instrument ${condensed ? "estimate-instrument--condensed" : ""}`}>
    <div className="instrument-title"><span>Plot–cost estimator</span><span className="instrument-status"><i/> Live</span></div>
    <div className="instrument-inputs">
      <label><span>Plot size</span><div className="dimension-inputs"><input aria-label="Plot width in feet" type="number" min="10" max="500" value={width} onChange={e => setWidth(Math.max(10, +e.target.value || 10))}/><b>×</b><input aria-label="Plot length in feet" type="number" min="10" max="500" value={length} onChange={e => setLength(Math.max(10, +e.target.value || 10))}/><em>ft</em></div></label>
      <label><span>Location</span><select aria-label="Location" value={city} onChange={e => setCity(e.target.value)}>{Object.keys(cityFactors).map(c => <option key={c}>{c}</option>)}</select></label>
      <label><span>Floors</span><select aria-label="Number of floors" value={floors} onChange={e => setFloors(e.target.value)}>{Object.keys(floorFactors).map(f => <option key={f}>{f}</option>)}</select></label>
    </div>
    <div className="instrument-output"><span>Estimated construction cost</span><strong>{formatLakh(estimate.low)} – {formatLakh(estimate.high)}</strong><small>{estimate.builtUp.toLocaleString("en-IN")} sq ft built-up · Signature finish</small></div>
    <button className="text-link" onClick={() => { sessionStorage.setItem('grihagrid.estimator',JSON.stringify({width,length,city,floors,quality})); route("/start"); }}>Use these details <ArrowRight/></button>
  </div>;
}

function HomePage() {
  const availability=useCommerceCatalog();
  return <main>
    <section className="monograph-hero">
      <div className="monograph-copy">
        <span className="kicker">AI home planning for Indian plots</span>
        <h1>Know what fits.<br/>Know what it costs.</h1>
        <p>Upload your plot details. Instantly see what fits, get an estimated construction cost, and walk into your first architect meeting prepared.</p>
        <div className="hero-actions"><button className="copper-button copper-button--large" onClick={() => route("/start")}>Plan my home <ArrowRight/></button><button className="underlined-action" onClick={() => route("/plans")}>See a sample plan</button></div>
        <EstimateInstrument condensed/>
        <div className="hero-steps" aria-label="How GrihaGrid works">
          <div><span>01</span><UploadSimple/><p>Share plot<br/>details</p></div>
          <div><span>02</span><Blueprint/><p>See what fits<br/>& likely cost</p></div>
          <div><span>03</span><UserCircle/><p>Consult an architect<br/><em>optional</em></p></div>
        </div>
        <div className="hero-trust"><span><ShieldCheck/> Your project is private and secure</span><span>Concept first. Professionals before construction.</span></div>
      </div>
      <div className="monograph-visual">
        <img width="1536" height="1024" src="/assets/v2/monograph-house-v2.jpg" onError={e => { e.currentTarget.src = "/assets/grihagrid-hero.jpg"; }} alt="Contemporary Indian home with an overlaid 30 by 50 foot plot plan"/>
      </div>
    </section>

    <section id="how" className="editorial-section editorial-section--split">
      <SectionHeading kicker="Before the first drawing" title="A confident brief changes every conversation." copy="GrihaGrid turns scattered wishes into a measured starting point: a plot envelope, a room programme, a live budget range, and the questions a professional needs to answer."/>
      <div className="editorial-list">
        {[['01','Feasibility','See whether the home you imagine can fit after practical setbacks and circulation.'],['02','Cost intelligence','Explore a transparent range by city, size and finish—not a false fixed quote.'],['03','Professional handoff','Carry one coherent brief into architect, contractor and family conversations.']].map(([n,t,c]) => <article key={n}><span>{n}</span><div><h3>{t}</h3><p>{c}</p></div></article>)}
      </div>
    </section>

    <section className="report-story">
      <div className="report-story-image"><img loading="lazy" width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Warm modern independent home elevation concept"/><span>Elevation direction · Warm modern</span></div>
      <div className="report-story-copy"><span className="kicker">Your decision book</span><h2>Useful before it becomes technical.</h2><p>A concise report that helps your family align on the home—and helps your architect begin with context instead of a blank page.</p>
        <dl><div><dt>Plot fit</dt><dd>Good · 74/100</dd></div><div><dt>Likely built-up</dt><dd>1,830 sq ft</dd></div><div><dt>Planning range</dt><dd>₹37L–₹44L</dd></div><div><dt>Key constraint</dt><dd>Ground-floor parking width</dd></div></dl>
        <button className="underlined-action" onClick={() => route("/plans")}>Open the sample plan <ArrowRight/></button>
      </div>
    </section>

    <section className="editorial-section process-section"><SectionHeading kicker="The process" title="From a plot to an architect-ready brief." align="center"/>
      <div className="process-line">{[[Ruler,'Map the plot','Dimensions, road edge, facing and city context.'],[House,'Shape the home','Family needs, floors, parking and preferences.'],[CurrencyInr,'See the range','A city- and finish-adjusted planning budget.'],[Blueprint,'Take the next step','Download the brief or add an expert review.']].map(([Icon,t,c],i) => <div key={t}><span>0{i+1}</span><Icon/><h3>{t}</h3><p>{c}</p></div>)}</div>
    </section>

    <section className="pricing-editorial"><div><span className="kicker">Simple, one-project pricing</span><h2>Start with clarity.<br/><i>Buy detail when it matters.</i></h2><p>No subscription. Your free feasibility remains yours.</p></div><div className="pricing-lines">
      {[['Feasibility','Free','Plot fit, room programme and indicative cost range.',null],['Planning report','₹499','Full concept brief, phase budget, material direction and PDF.','plan'],['Architect reviewed','₹3,499','Professional review, five questions and one revision round.','expert']].map(([name,price,copy,sku],i)=>{const accepting=!sku||availability[sku];return <article key={name}><span>0{i+1}</span><div><h3>{name}</h3><p>{copy}</p></div><strong>{price}{sku&&!accepting&&<small>Opening soon</small>}</strong><button disabled={!accepting} onClick={() => {if(sku)sessionStorage.setItem('grihagrid.plan',sku);route('/start')}} aria-label={accepting?`Choose ${name}`:`${name} is not accepting orders`}><ArrowRight/></button></article>})}
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
    ["Can I keep my project private?", "Yes. Projects are account-scoped, sessions use secure cookies, and private files are served through authenticated access rather than public links."],
    ["Can an architect review it?", "Yes. The reviewed tier adds professional comments, answers to five questions and one revision round. Availability depends on your city and project scope."],
  ];
  return <section className="faq-editorial"><SectionHeading kicker="Questions worth asking" title="Clear boundaries build trust."/><div>{faqs.map(([q,a],i)=><details key={q} open={i===0}><summary><span>0{i+1}</span>{q}<Plus/></summary><p>{a}</p></details>)}</div></section>;
}

const plans = [
  {name:"Feasibility",price:"Free",lead:"Answer the first questions.",items:["Plot-fit assessment","Room programme","City-adjusted cost range","Private saved project"],eta:"Immediate",sku:null},
  {name:"Planning report",price:"₹499",lead:"A complete decision brief.",items:["Everything in Feasibility","Floor-by-floor concept","Phase-wise budget","Material direction","Printable decision book"],eta:"Within 15 minutes",featured:true,sku:"plan"},
  {name:"Site-informed",price:"₹999",lead:"Grounded in your photographs.",items:["Everything in Planning report","Site-photo observations","Elevation direction","Risk and approval checklist"],eta:"Within 30 minutes",sku:"site_plus"},
  {name:"Architect reviewed",price:"₹3,499",lead:"Professional confidence.",items:["Everything in Site-informed","Architect review notes","Five answered questions","One revision round"],eta:"One business day",sku:"expert"},
];

function PricingPage() {
  const availability=useCommerceCatalog();
  return <main className="page-main"><section className="page-hero"><span className="kicker">One plot · one payment</span><h1>Choose how much confidence you need.</h1><p>Begin free. Upgrade the same project when deeper planning—or professional judgment—becomes useful.</p></section><section className="plan-table">{plans.map((p,i)=>{const accepting=!p.sku||availability[p.sku];return <article className={p.featured?"featured":""} key={p.name}><div className="plan-index">0{i+1}</div><div className="plan-name">{p.featured&&<span>Recommended</span>}<h2>{p.name}</h2><p>{p.lead}</p></div><div className="plan-price"><strong>{p.price}</strong><small>{p.sku&&!accepting?'Opening soon':p.eta}</small></div><ul>{p.items.map(x=><li key={x}><Check/>{x}</li>)}</ul><button disabled={!accepting} className={p.featured?"copper-button":"outline-button"} onClick={()=>{if(p.sku)sessionStorage.setItem('grihagrid.plan',p.sku);route('/start')}}>{i===0?'Start free':accepting?'Choose plan':'Not accepting orders'} {accepting&&<ArrowRight/>}</button></article>})}</section><section className="scope-note"><WarningCircle/><div><h2>Planning before permission.</h2><p>No tier replaces the licensed professionals, soil investigation, structural design or municipal approval required to build safely.</p></div></section></main>;
}

function AboutPage() {
  return <main className="page-main"><section className="about-editorial"><span className="kicker">Why GrihaGrid exists</span><h1>Every home begins as a family conversation.</h1><p className="lead">But too often that conversation is forced into drawings, quotes and commitments before the family understands what is possible.</p><div className="about-columns"><p>GrihaGrid creates a calmer first step. Plot dimensions and family needs become an honest feasibility view, a visible budget range and a structured brief that a professional can challenge and improve.</p><p>AI helps us make exploration fast and affordable. Licensed people remain responsible for the decisions that affect safety, permission and construction.</p></div></section><section className="values-rule">{[['Clarity over theatre','Assumptions and ranges stay visible.'],['Context over templates','Indian plots, cities and family patterns shape the brief.'],['Professionals at the right moment','Automation explores; experts validate.']].map(([t,c],i)=><article key={t}><span>0{i+1}</span><h2>{t}</h2><p>{c}</p></article>)}</section><section className="principle-quote"><blockquote>Help every family ask better questions before the first expensive answer.</blockquote><p>That is the standard we use to choose what GrihaGrid builds.</p></section></main>;
}

function SamplePlanPage() {
  return <main className="sample-page"><section className="sample-cover"><div><span className="kicker">Sample decision book · Pune</span><h1>A 30 × 50 ft<br/>family home.</h1><p>East-facing · G+1 · Three bedrooms · Signature finish</p><button className="copper-button" onClick={()=>route('/start')}>Create mine <ArrowRight/></button></div><img width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Sample warm modern home elevation"/></section><section className="sample-facts"><div><span>Fit</span><strong>Feasible*</strong><small>Subject to local validation</small></div><div><span>Built-up</span><strong>1,830 sq ft</strong><small>Likely concept area</small></div><div><span>Planning range</span><strong>₹37L–₹44L</strong><small>Signature finish · Pune</small></div></section><section className="sample-narrative"><div><span className="kicker">Executive readout</span><h2>The brief fits—with one important trade-off.</h2></div><div><p>Three bedrooms and generous common spaces are viable across two floors. Ground-floor parking width is the main constraint; a compact stair and vertically aligned wet areas protect both usable space and cost.</p><p><strong>Strong directional fit:</strong> East entry, southeast kitchen and southwest primary bedroom can work without compromising circulation.</p></div></section></main>;
}

const wizardSteps = ["Plot", "Home", "Context", "Review"];

function StartPage({ user }) {
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [files,setFiles]=useState([]);
  const [data,setData]=useState(()=>{let scenario={};try{scenario=JSON.parse(sessionStorage.getItem('grihagrid.estimator')||'{}')}catch{}return {name:"My family home",width:30,length:50,city:"Pune",facing:"East",floors:"G+1",bedrooms:"3",parking:"1 car",style:"Warm modern",quality:"Signature",...scenario}});
  const update=(key,value)=>setData(prev=>({...prev,[key]:value}));
  async function createProject(){
    setBusy(true);setError("");
    try { const result=await api("/api/projects",{method:"POST",body:data}); sessionStorage.removeItem("grihagrid.pendingProject");sessionStorage.removeItem('grihagrid.estimator');const failed=[];for(const file of files){const form=new FormData();form.append('file',file);form.append('kind','reference');try{await api(`/api/projects/${result.project.id}/files`,{method:'POST',body:form})}catch{failed.push(file.name)}}if(failed.length)sessionStorage.setItem(`grihagrid.uploadWarning.${result.project.id}`,`${failed.length} file${failed.length===1?'':'s'} could not be saved. Add them again from the report.`);route(`/report/${result.project.id}`); }
    catch(err){ if(err instanceof ApiError && err.status===401){sessionStorage.setItem("grihagrid.pendingProject",JSON.stringify(data));route("/register");} else setError(err.message); }
    finally{setBusy(false)}
  }
  return <main className="wizard-page"><div className="wizard-header"><Brand/><button className="quiet-action" onClick={()=>route('/')}>Exit</button></div><div className="wizard-progress" aria-label="Project brief progress">{wizardSteps.map((label,i)=><div className={i<=step?"active":""} aria-current={i===step?'step':undefined} key={label}><span>{i<step?<Check/>:i+1}</span><small>{label}</small></div>)}</div><section className="wizard-sheet">
    {step===0&&<><span className="kicker">Step one · The plot</span><h1>Begin with the measured ground.</h1><p>Use your sale deed or current survey where possible. You can revise these details later.</p><div className="form-grid"><label>Project name<input value={data.name} onChange={e=>update('name',e.target.value)} maxLength="100"/></label><label>City<select value={data.city} onChange={e=>update('city',e.target.value)}>{Object.keys(cityFactors).map(c=><option key={c}>{c}</option>)}</select></label><label>Plot width <span>feet</span><input type="number" min="10" max="500" value={data.width} onChange={e=>update('width',+e.target.value)}/></label><label>Plot length <span>feet</span><input type="number" min="10" max="500" value={data.length} onChange={e=>update('length',+e.target.value)}/></label><label>Road-facing side<select value={data.facing} onChange={e=>update('facing',e.target.value)}>{['North','East','South','West'].map(x=><option key={x}>{x}</option>)}</select></label></div></>}
    {step===1&&<><span className="kicker">Step two · The home</span><h1>Describe the life it needs to hold.</h1><p>Choose the practical starting point. Your architect can refine the programme later.</p><Choice label="Floors" value={data.floors} choices={['G','G+1','G+2']} onChange={v=>update('floors',v)}/><Choice label="Bedrooms" value={data.bedrooms} choices={['2','3','4','5+']} onChange={v=>update('bedrooms',v)}/><Choice label="Parking" value={data.parking} choices={['None','1 car','2 cars']} onChange={v=>update('parking',v)}/><Choice label="Finish" value={data.quality} choices={['Essential','Signature','Premium','Luxury']} onChange={v=>update('quality',v)}/></>}
    {step===2&&<><span className="kicker">Step three · Context</span><h1>Give the concept a sense of place.</h1><p>Site photographs are optional and are stored privately with your project.</p>{user?<label className="upload-field"><UploadSimple/><strong>{files.length?`${files.length} photograph${files.length===1?'':'s'} selected`:'Choose plot photographs'}</strong><span>JPG, PNG or WebP · up to 10 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setFiles([...e.target.files].filter(file=>file.size<=10*1024*1024))}/></label>:<div className="account-note"><LockKey/><p>Create or log into your private account first, then add site photographs from the report.</p></div>}<label className="select-block">Exterior direction<select value={data.style} onChange={e=>update('style',e.target.value)}>{['Warm modern','Contemporary','Traditional Indian','Tropical modern','Minimal'].map(x=><option key={x}>{x}</option>)}</select></label></>}
    {step===3&&<><span className="kicker">Step four · Review</span><h1>Your first brief is ready.</h1><p>These inputs become the assumption record behind the feasibility result.</p><div className="brief-lines">{[['Plot',`${data.width} × ${data.length} ft · ${data.facing}-facing`],['Home',`${data.floors} · ${data.bedrooms} bedrooms · ${data.parking}`],['Context',`${data.city} · ${data.style}`],['Finish',data.quality]].map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div><div className="warning-note"><WarningCircle/><p>This is a concept-stage planning brief—not a municipal, architectural or structural approval.</p></div>{!user&&<div className="account-note"><LockKey/><p>You will create an account next so this project remains private and can be revisited.</p></div>}</>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="wizard-actions">{step>0&&<button className="outline-button" onClick={()=>setStep(step-1)}><ArrowLeft/> Back</button>}<button disabled={busy} className="copper-button" onClick={()=>step<3?setStep(step+1):createProject()}>{step<3?'Continue':busy?'Creating…':user?'Create feasibility':'Secure my project'} <ArrowRight/></button></div>
  </section></main>;
}

function Choice({label,value,choices,onChange}) { return <fieldset className="choice-field"><legend>{label}</legend><div>{choices.map(choice=><button type="button" aria-pressed={choice===value} className={choice===value?"selected":""} key={choice} onClick={()=>onChange(choice)}>{choice}</button>)}</div></fieldset>; }

function AuthPage({ mode, onAuthenticated }) {
  const isLogin=mode==="login";
  const [form,setForm]=useState({name:"",email:"",password:""});
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function submit(e){e.preventDefault();setBusy(true);setError("");try{const result=await api(`/api/auth/${isLogin?'login':'register'}`,{method:'POST',body:form});onAuthenticated(result.user);const pending=sessionStorage.getItem('grihagrid.pendingProject');if(pending){const project=await api('/api/projects',{method:'POST',body:JSON.parse(pending)});sessionStorage.removeItem('grihagrid.pendingProject');route(`/report/${project.project.id}`);}else route('/dashboard');}catch(err){setError(err.message);}finally{setBusy(false)}}
  return <main className="auth-page"><div className="auth-architecture"><img width="1536" height="1024" src="/assets/v2/monograph-house-v2.jpg" onError={e=>{e.currentTarget.src='/assets/grihagrid-hero.jpg'}} alt="Contemporary Indian home"/><div><Brand inverted/><blockquote>Start with clarity.<br/>Build with confidence.</blockquote></div></div><section className="auth-form"><button className="back-action" onClick={()=>route('/')}><ArrowLeft/> Home</button><span className="kicker">Private project workspace</span><h1>{isLogin?'Welcome back.':'Create your account.'}</h1><p>{isLogin?'Return to your saved home plans.':'Save the brief you just created and keep every revision together.'}</p><form onSubmit={submit}>{!isLogin&&<label>Full name<input required autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Password<input required type="password" minLength="10" autoComplete={isLogin?'current-password':'new-password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><small>At least 10 characters</small></label>{error&&<p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="copper-button" type="submit">{busy?'Please wait…':isLogin?'Log in':'Create account'} <ArrowRight/></button></form><p className="auth-switch">{isLogin?'New to GrihaGrid?':'Already have an account?'} <button onClick={()=>route(isLogin?'/register':'/login')}>{isLogin?'Create account':'Log in'}</button></p></section></main>;
}

function Dashboard({ user, onLogout }) {
  const [projects,setProjects]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  useEffect(()=>{api('/api/projects').then(x=>setProjects(x.projects||[])).catch(e=>{if(e instanceof ApiError&&e.status===401)route('/login');else setError(e.message)}).finally(()=>setLoading(false));},[]);
  async function logout(){await api('/api/auth/logout',{method:'POST',body:{}}).catch(()=>{});onLogout();route('/');}
  async function removeProject(project){if(!window.confirm(`Delete “${project.name}” and its private files? This cannot be undone.`))return;setError("");try{await api(`/api/projects/${project.id}`,{method:'DELETE',body:{}});setProjects(current=>current.filter(item=>item.id!==project.id));}catch(err){setError(err.message)}}
  return <main className="workspace"><aside><Brand/><nav><button className="active"><Blueprint/> Projects</button><button onClick={()=>route('/start')}><Plus/> New brief</button><button onClick={()=>route('/plans')}><FileText/> Sample plan</button></nav><div><p>{user?.name||user?.email}</p><button onClick={logout}><SignOut/> Log out</button></div></aside><section className="workspace-main"><header><div><span className="kicker">Your private workspace</span><h1>Home plans, in one place.</h1></div><button className="copper-button" onClick={()=>route('/start')}><Plus/> New project</button></header>{loading&&<p className="loading-line" role="status">Loading your projects…</p>}{error&&<p className="form-error" role="alert">{error}</p>}{!loading&&!error&&projects.length===0&&<div className="empty-state"><Blueprint/><h2>Your first plot is still blank paper.</h2><p>Create a brief to see feasibility and cost before commissioning drawings.</p><button className="copper-button" onClick={()=>route('/start')}>Plan my home <ArrowRight/></button></div>}<div className="project-list">{projects.map((project,i)=><article key={project.id}><span className="project-number">{String(i+1).padStart(2,'0')}</span><div><small>{project.status?.replaceAll('_',' ')}</small><h2>{project.name}</h2><p>{project.input?.width||project.width||30} × {project.input?.length||project.length||50} ft · {project.input?.city||project.city||'India'} · {project.input?.floors||project.floors||'G+1'}</p></div><div><span>Planning range</span><strong>{formatLakh(project.estimate?.lowInr||project.low_inr)} – {formatLakh(project.estimate?.highInr||project.high_inr)}</strong></div><div className="project-actions"><button onClick={()=>route(`/report/${project.id}`)}>Open <ArrowRight/></button><button className="delete-action" onClick={()=>removeProject(project)} aria-label={`Delete ${project.name}`}><Trash/></button></div></article>)}</div></section></main>;
}

function PurchasePanel({ projectId }) {
  const selected=sessionStorage.getItem('grihagrid.plan');
  const [plan,setPlan]=useState(selected||'plan');const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const availability=useCommerceCatalog();
  const details={plan:['Planning report','₹499'],site_plus:['Site-informed','₹999'],expert:['Architect reviewed','₹3,499']};
  if(!selected)return <section className="purchase-panel"><div><span className="kicker">Need more confidence?</span><h2>Take this brief further.</h2><p>Choose a deeper report or an architect-reviewed handoff when the free feasibility has helped you align.</p></div><button className="underlined-action" onClick={()=>route('/pricing')}>Compare plans <ArrowRight/></button></section>;
  async function checkout(){setBusy(true);setError("");try{const keyName=`grihagrid.checkout.${projectId}.${plan}`;let key=sessionStorage.getItem(keyName);if(!key){key=crypto.randomUUID();sessionStorage.setItem(keyName,key)}const result=await api(`/api/projects/${projectId}/orders`,{method:'POST',headers:{'idempotency-key':key},body:{plan}});sessionStorage.removeItem('grihagrid.plan');if(result.checkoutUrl)window.location.assign(result.checkoutUrl);else if(result.order?.id)route(`/checkout/return?order=${encodeURIComponent(result.order.id)}`);else throw new Error('Checkout is not available for this order.');}catch(err){setError(err.status===503?'Secure checkout is being connected. Your project is saved; no payment was taken.':err.message);}finally{setBusy(false)}}
  const accepting=Boolean(availability[plan]);
  return <section className="purchase-panel purchase-panel--selected"><div><span className="kicker">Selected next step</span><h2>{details[plan][0]}</h2><p>{accepting?'One project · one payment. The checkout provider confirms payment directly with GrihaGrid before fulfillment begins.':'This paid service is visible for comparison, but is not accepting orders yet. Your free project remains saved.'}</p></div><div><label>Plan<select value={plan} onChange={e=>setPlan(e.target.value)}>{Object.entries(details).map(([value,[name,price]])=><option key={value} value={value}>{name} · {price}</option>)}</select></label><button disabled={busy||!accepting} className="copper-button" onClick={checkout}>{busy?'Opening checkout…':accepting?`Continue · ${details[plan][1]}`:'Not accepting orders'} {accepting&&<ArrowRight/>}</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}

function ProjectFiles({ projectId }) {
  const [files,setFiles]=useState([]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{api(`/api/projects/${projectId}/files`).then(x=>setFiles(x.files||[])).catch(e=>{if(e.status!==503)setError(e.message)});},[projectId]);
  async function upload(event){const selected=[...(event.target.files||[])];if(!selected.length)return;setBusy(true);setError("");try{for(const file of selected){const form=new FormData();form.append('file',file);form.append('kind','reference');const result=await api(`/api/projects/${projectId}/files`,{method:'POST',body:form});setFiles(current=>[result.file,...current]);}}catch(err){setError(err.status===503?'Private photo storage is being activated. Your report is already saved; try the upload again shortly.':err.message);}finally{setBusy(false);event.target.value='';}}
  async function remove(file){const name=file.name||file.fileName||file.file_name||'this file';if(!window.confirm(`Delete “${name}”?`))return;try{await api(`/api/projects/${projectId}/files/${file.id}`,{method:'DELETE',body:{}});setFiles(current=>current.filter(item=>item.id!==file.id));}catch(err){setError(err.message)}}
  return <section className="project-files"><div><span className="kicker">Private site context</span><h2>Plot photographs & documents</h2><p>Keep the evidence behind your brief together. Files remain account-scoped.</p></div><label className="file-upload-action"><UploadSimple/>{busy?'Uploading…':'Add files'}<input disabled={busy} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={upload}/></label>{error&&<p className="form-error" role="alert">{error}</p>}{files.length>0&&<div className="file-list">{files.map(file=>{const name=file.name||file.fileName||file.file_name||'Project file';return <div key={file.id}><FileText/><a href={`/api/projects/${projectId}/files/${file.id}`}>{name}</a><span>{Math.max(1,Math.round((file.sizeBytes||file.size_bytes||0)/1024))} KB</span><button onClick={()=>remove(file)} aria-label={`Delete ${name}`}><Trash/></button></div>})}</div>}</section>;
}

function CheckoutReturnPage({ orderId }) {
  const [state,setState]=useState({loading:true,order:null,error:""});
  useEffect(()=>{let active=true;let timer;let attempts=0;async function poll(){try{const result=await api(`/api/orders/${encodeURIComponent(orderId)}`);if(!active)return;setState({loading:false,order:result.order,error:""});if(!['paid','failed','refunded'].includes(result.order.status)&&attempts++<20)timer=window.setTimeout(poll,1500);}catch(err){if(!active)return;if(err instanceof ApiError&&err.status===401){route('/login');return}setState({loading:false,order:null,error:err.message});}}if(orderId)poll();else setState({loading:false,order:null,error:'Missing order reference.'});return()=>{active=false;window.clearTimeout(timer)}},[orderId]);
  const status=state.order?.status;
  const fulfillment=state.order?.fulfillment;
  const paidMessage={ready:'Your purchased report snapshot is ready.',awaiting_input:'Payment is confirmed. Add the requested private site material to continue.',queued:'Payment is confirmed and your expert review is queued.',in_progress:'Your paid deliverable is now in progress.',failed:'Payment is confirmed, but fulfillment needs support attention.',cancelled:'This fulfillment was cancelled.'}[fulfillment?.status]||'Payment is confirmed. Fulfillment status is being prepared.';
  return <main className="checkout-return"><Brand/><section>{state.loading&&<><span className="kicker">Confirming with Razorpay</span><h1>Checking your payment.</h1><p role="status">This usually takes a few seconds. You can safely keep this page open.</p></>}{state.error&&<><WarningCircle/><span className="kicker">Payment status unavailable</span><h1>Your project is safe.</h1><p role="alert">{state.error} No fulfillment has started from this browser return alone.</p><button className="copper-button" onClick={()=>route('/dashboard')}>Open my projects <ArrowRight/></button></>}{state.order&&<><span className="kicker">Order · {state.order.id.slice(0,8)}</span><h1>{status==='paid'?'Payment confirmed.':status==='failed'?'Checkout was not completed.':'Still confirming payment.'}</h1><p>{status==='paid'?paidMessage:status==='failed'?'No entitlement was created. You may safely return to the project and try again.':'We have not received a verified payment event yet. This page will continue checking.'}</p><dl><div><dt>Plan</dt><dd>{state.order.planLabel}</dd></div><div><dt>Amount</dt><dd>₹{(state.order.amountPaise/100).toLocaleString('en-IN')}</dd></div><div><dt>Payment</dt><dd>{status}</dd></div>{fulfillment&&<div><dt>Fulfillment</dt><dd>{fulfillment.status.replaceAll('_',' ')}</dd></div>}</dl><button className="copper-button" onClick={()=>route('/dashboard')}>Open my projects <ArrowRight/></button></>}</section></main>;
}

function ReportPage({ id }) {
  const [project,setProject]=useState(null);const [error,setError]=useState("");
  const [uploadWarning,setUploadWarning]=useState(()=>sessionStorage.getItem(`grihagrid.uploadWarning.${id}`)||"");
  useEffect(()=>{Promise.all([api(`/api/projects/${id}`),api(`/api/projects/${id}/report`)]).then(([projectResult,reportResult])=>setProject({...projectResult.project,generatedReport:reportResult.report})).catch(e=>{if(e instanceof ApiError&&e.status===401)route('/login');else setError(e.message)})},[id]);
  if(error)return <main className="error-page"><WarningCircle/><h1>We could not open this report.</h1><p>{error}</p><button className="copper-button" onClick={()=>route('/dashboard')}>Back to projects</button></main>;
  if(!project)return <main className="error-page"><p>Preparing your decision book…</p></main>;
  const input=project.input||{};const estimate=project.estimate||{};const report=project.generatedReport||{};const firstRisk=report.risks?.[0]||'Local setbacks and site conditions require professional validation.';const costCategories=report.costPlan?.categories||[['Civil and structure',38],['Finishes',26],['Electrical and plumbing',14],['Doors and windows',9],['Approvals and setup',5],['Contingency',8]].map(([name,percent])=>({name,percent,amountInr:Math.round(((estimate.lowInr+estimate.highInr)/2||4000000)*percent/100)}));
  return <main className="report-page"><header><button onClick={()=>route('/dashboard')}><ArrowLeft/> Projects</button><Brand/><button onClick={()=>window.print()}><DownloadSimple/> Download / print</button></header><div className="report-document">{uploadWarning&&<div className="report-upload-warning" role="alert"><WarningCircle/><span>{uploadWarning}</span><button onClick={()=>{sessionStorage.removeItem(`grihagrid.uploadWarning.${id}`);setUploadWarning("")}}>Dismiss</button></div>}<section className="report-cover"><span className="kicker">GrihaGrid feasibility brief · v{report.version||1}</span><h1>{project.name||'My family home'}</h1><p>{input.width} × {input.length} ft · {input.facing||'East'}-facing · {input.city}</p><div><span>Concept stage</span><span>{new Date(report.generatedAt||project.createdAt||Date.now()).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</span></div></section><section className="report-hero"><img loading="lazy" width="1536" height="1024" src="/assets/grihagrid-hero.jpg" alt="Warm modern home direction"/><div><span>Exterior direction</span><strong>{input.style||'Warm modern'}</strong></div></section><section className="report-facts"><div><span>Plot fit</span><strong>Feasible*</strong><small>Subject to local verification</small></div><div><span>Likely built-up</span><strong>{(estimate.builtUpSqft||report.summary?.targetBuiltUpSqft||0).toLocaleString('en-IN')} sq ft</strong><small>{input.floors} concept</small></div><div><span>Planning range</span><strong>{formatLakh(estimate.lowInr||report.costPlan?.lowInr)}–{formatLakh(estimate.highInr||report.costPlan?.highInr)}</strong><small>{input.quality} finish</small></div></section><section className="report-copy"><div><span className="kicker">Executive readout</span><h2>{report.summary?.verdict||'Conceptually feasible, subject to verification.'}</h2></div><div><p>{firstRisk}</p><p>{report.nextActions?.slice(0,2).join(' ')||'Commission a measured survey and validate the brief with every decision-maker before detailed design.'}</p></div></section><section className="report-budget"><h2>Indicative cost allocation</h2>{costCategories.map(category=><div key={category.name}><span>{category.name}</span><i><b style={{width:`${category.percent}%`}}/></i><strong>{formatLakh(category.amountInr)}</strong></div>)}</section><section className="report-boundary"><ShieldCheck/><p><strong>Use this report to decide—not to construct.</strong> A licensed local architect and structural engineer must validate site conditions, bylaws, drawings and specifications.</p></section><PurchasePanel projectId={id}/><ProjectFiles projectId={id}/></div></main>;
}

function LegalPage({ type }) { const title={privacy:'Privacy policy',terms:'Terms of use',refund:'Refund & cancellation'}[type]; return <main className="legal-page"><span className="kicker">Legal · Plain language</span><h1>{title}</h1><p className="legal-date">Effective 13 August 2026</p><section><h2>The short version</h2><p>GrihaGrid is a concept-stage planning service. We collect the minimum information needed to operate your account, save projects, generate reports and support purchases. Project information is private by default.</p><h2>Your files and account</h2><p>Account sessions use secure, HTTP-only cookies. Site photographs are stored privately and accessed only through authenticated requests. You can delete project files and request account deletion.</p><h2>Professional boundary</h2><p>Generated concepts, estimates and compliance cues are indicative. They do not replace licensed architectural, structural, geotechnical, legal, tax or municipal advice.</p><h2>Payments and refunds</h2><p>Free feasibility work requires no payment. Digital reports may be cancelled before generation begins. Expert reviews may be cancelled before a professional accepts the assignment. Final policy is subject to applicable Indian consumer law.</p><h2>Contact</h2><p>Email <a href="mailto:hello@grihagrid.in">hello@grihagrid.in</a>. These policies must receive final counsel review before live payment activation.</p></section></main>; }

function NotFoundPage() { return <main className="error-page"><Compass/><span className="kicker">404 · Outside the plot</span><h1>This page is not in the plan.</h1><p>The address may have changed, or the page may never have existed.</p><button className="copper-button" onClick={()=>route('/')}>Return home <ArrowRight/></button></main>; }

function AppShell({ user, children }) { return <><a className="skip-link" href="#main-content">Skip to content</a><Header user={user}/><div id="main-content">{children}</div><Footer/></>; }

export function App() {
  const [path,setPath]=useState(window.location.pathname);const [user,setUser]=useState(undefined);
  useEffect(()=>{const onPop=()=>setPath(window.location.pathname);window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  useEffect(()=>{api('/api/auth/me').then(x=>setUser(x.user||null)).catch(()=>setUser(null));},[]);
  useEffect(()=>{const titles={'/':'GrihaGrid — Know what fits. Know what it costs.','/pricing':'Pricing — GrihaGrid','/about':'About — GrihaGrid','/plans':'Sample plan — GrihaGrid','/start':'Plan my home — GrihaGrid','/login':'Log in — GrihaGrid','/register':'Create account — GrihaGrid','/dashboard':'My projects — GrihaGrid','/privacy':'Privacy — GrihaGrid','/terms':'Terms — GrihaGrid','/refund':'Refunds — GrihaGrid'};document.title=path.startsWith('/report/')?'Decision book — GrihaGrid':(titles[path]||'Page not found — GrihaGrid')},[path]);
  const reportMatch=path.match(/^\/report\/([^/]+)$/);
  const checkoutOrder=path==='/checkout/return'?new URLSearchParams(window.location.search).get('order'):null;
  if(path==='/start')return <StartPage user={user}/>;
  if(path==='/login'||path==='/register')return <AuthPage key={path} mode={path.slice(1)} onAuthenticated={setUser}/>;
  if(path==='/dashboard')return <Dashboard user={user} onLogout={()=>setUser(null)}/>;
  if(reportMatch)return <ReportPage id={reportMatch[1]}/>;
  if(path==='/checkout/return')return <CheckoutReturnPage orderId={checkoutOrder}/>;
  let page=path==='/'?<HomePage/>:<NotFoundPage/>;
  if(path==='/pricing')page=<PricingPage/>;else if(path==='/about')page=<AboutPage/>;else if(path==='/plans')page=<SamplePlanPage/>;else if(path==='/privacy'||path==='/terms'||path==='/refund')page=<LegalPage type={path.slice(1)}/>;
  return <AppShell user={user}>{page}</AppShell>;
}
