import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BadgeIndianRupee, BedDouble, Building2, Check, ChevronDown,
  CircleAlert, ClipboardCheck, Clock3, Compass, Download, FileText, Grid2X2,
  HardHat, Home, IndianRupee, Layers3, LogOut, Mail, MapPin, Menu, Moon,
  Plus, Ruler, ShieldCheck, Sparkles, Sun, Upload, UserRound, X, Zap,
} from "lucide-react";

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const cities = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: 0.98, Chennai: 1.02, Jaipur: 0.88, Other: 0.95 };
const qualityRates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };

function go(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function Brand() {
  return <button className="brand" onClick={() => go("/")} aria-label="GrihaGrid home"><span className="brand-mark"><Grid2X2 size={18}/></span><span>Griha<span>Grid</span></span></button>;
}

function Header({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  return <header className="topbar"><div className="nav-shell"><Brand/>
    <nav className={open ? "nav-links open" : "nav-links"} aria-label="Primary">
      {[['Home','/'],['Pricing','/pricing'],['How it works','/#how'],['About','/about']].map(([label,path]) => <button key={label} onClick={() => {go(path); setOpen(false)}}>{label}</button>)}
    </nav>
    <div className="nav-actions">
      <button className="icon-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
      <button className="text-button desktop-only" onClick={() => go('/login')}>Log in</button>
      <button className="button small" onClick={() => go('/start')}>Start free</button>
      <button className="icon-button menu-button" aria-label="Open menu" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button>
    </div>
  </div></header>
}

function Footer() {
  return <footer><div className="footer-grid"><div><Brand/><p>AI-powered home feasibility, layouts and cost intelligence for Indian plots.</p><span className="secure"><ShieldCheck size={15}/> Your project data stays private</span></div>
    <div><h4>Product</h4><button onClick={() => go('/pricing')}>Pricing</button><button onClick={() => go('/start')}>Start a project</button><button onClick={() => go('/dashboard')}>Demo dashboard</button></div>
    <div><h4>Company</h4><button onClick={() => go('/about')}>About</button><a href="mailto:hello@grihagrid.in">Contact</a><a href="mailto:architects@grihagrid.in">Join as an architect</a></div>
    <div><h4>Legal</h4><button onClick={() => go('/privacy')}>Privacy</button><button onClick={() => go('/terms')}>Terms</button><button onClick={() => go('/refund')}>Refund policy</button></div>
  </div><div className="footer-bottom"><span>© 2026 GrihaGrid Labs. Concept-stage planning, not municipal or structural approval.</span><span>Built for India</span></div></footer>
}

function SectionTitle({ eyebrow, title, copy }) { return <div className="section-title">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{copy && <p>{copy}</p>}</div> }

function ToggleGroup({ label, value, options, onChange }) {
  return <fieldset className="toggle-field"><legend>{label}</legend><div className="segmented">{options.map(o => <button type="button" className={value === o ? 'active' : ''} key={o} onClick={() => onChange(o)}>{o}</button>)}</div></fieldset>
}

function EstimateCalculator({ compact = false }) {
  const [width, setWidth] = useState(30); const [length, setLength] = useState(50);
  const [floors, setFloors] = useState('G+1'); const [quality, setQuality] = useState('Signature'); const [city, setCity] = useState('Pune');
  const built = Math.round(width * length * ({G: .72, 'G+1': 1.22, 'G+2': 1.65}[floors]));
  const total = built * qualityRates[quality] * cities[city];
  const low = total * .92 / 100000; const high = total * 1.1 / 100000;
  return <div className={`calculator ${compact ? 'compact' : ''}`}>
    <div className="calculator-controls">
      <label>Plot width <strong>{width} ft</strong><input aria-label={`Plot width ${width} ft`} type="range" min="18" max="80" value={width} onChange={e => setWidth(+e.target.value)}/></label>
      <label>Plot length <strong>{length} ft</strong><input aria-label={`Plot length ${length} ft`} type="range" min="30" max="120" value={length} onChange={e => setLength(+e.target.value)}/></label>
      <ToggleGroup label="Floors" value={floors} options={['G','G+1','G+2']} onChange={setFloors}/>
      <ToggleGroup label="Finish" value={quality} options={['Essential','Signature','Premium','Luxury']} onChange={setQuality}/>
      <label className="select-label">City<select value={city} onChange={e => setCity(e.target.value)} aria-label="City">{Object.keys(cities).map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    <div className="estimate-result"><span className="result-badge">Live estimate</span><p>{money.format(width * length)} sq ft plot · {money.format(built)} sq ft built-up</p><strong>₹{money.format(low)}L – ₹{money.format(high)}L</strong><small>{quality} · ₹{money.format(qualityRates[quality])}/sq ft · {city}</small><button className="button full" onClick={() => go('/start')}>Build my free plan <ArrowRight size={17}/></button><small>Indicative planning range. Final quotes require local professionals.</small></div>
  </div>
}

const steps = [
  [Ruler,'Describe your plot','Add dimensions, road side, facing, location and what your family needs.'],
  [Sparkles,'Generate a concept','Get a feasibility score, room schedule and planning directions in minutes.'],
  [FileText,'Unlock your report','Review floor concepts, phased costs, materials and build timeline.'],
  [UserRound,'Add expert review','Ask a verified architect to validate assumptions and refine the concept.'],
];

const reportFeatures = [
  [Layers3,'Floor-by-floor concepts','Room schedules and layouts shaped around your plot envelope.'],
  [CircleAlert,'Constraints and fixes','Parking, light, ventilation and wet-area issues, surfaced early.'],
  [BadgeIndianRupee,'Cost plan and BOQ','Phase-wise ranges, material allowances and cash-flow guidance.'],
  [Compass,'Vastu and bylaw cues','Directional preferences and city-specific planning checkpoints.'],
  [Home,'Front elevation direction','An original street-view concept and practical material palette.'],
  [ClipboardCheck,'Expert validation','Optional human review, notes and a revision trail in one workspace.'],
];

const plans = [
  {name:'Feasibility',price:'Free',desc:'Know what fits and what it may cost.',eta:'Instant',features:['Buildable area check','Cost range by city','Room-fit score','Saved project'],cta:'Start free'},
  {name:'Plan',price:'₹499',desc:'A complete planning report for one plot.',eta:'Within 15 min',features:['Everything in Feasibility','Floor concept pack','Phase-wise cost plan','Materials starter BOQ','Downloadable PDF'],cta:'Choose Plan',tag:'Most popular'},
  {name:'Site+',price:'₹999',desc:'Tailored using your site photos and context.',eta:'Within 30 min',features:['Everything in Plan','Photo-informed site notes','Elevation direction','Risk and compliance checklist'],cta:'Choose Site+',tag:'Best value'},
  {name:'Expert',price:'₹3,499',desc:'Reviewed by a verified architect.',eta:'1 business day',features:['Everything in Site+','Architect review notes','Five answered questions','One revision round'],cta:'Request review'},
];

function PricingCards() { return <div className="pricing-grid">{plans.map((p,i) => <article className={`price-card ${i===1?'featured':''}`} key={p.name}>{p.tag && <span className="plan-tag">{p.tag}</span>}<h3>{p.name}</h3><p>{p.desc}</p><div className="price">{p.price}</div><span className="eta"><Clock3 size={14}/>{p.eta}</span><ul>{p.features.map(f => <li key={f}><Check size={15}/>{f}</li>)}</ul><button className={i===1?'button full':'button secondary full'} onClick={() => go('/start')}>{p.cta}<ArrowRight size={16}/></button></article>)}</div> }

function HomePage() {
  const faqs = [
    ['How accurate is the cost range?','It is a planning range based on built-up area, finish level and current regional benchmarks. It is not a contractor quote; Expert plans add a local professional review.'],
    ['Will I receive sanction drawings?','No. GrihaGrid produces concept-stage planning material. Licensed local architects and engineers must prepare and sign municipal, structural and services drawings.'],
    ['Can I upgrade the same project later?','Yes. Your plot brief remains attached to the project, so you can unlock a higher tier without starting again.'],
    ['How is my data protected?','Project access is private by default. Uploaded files use private object storage and short-lived download links. You can request deletion from project settings.'],
  ];
  return <>
    <main>
      <section className="hero shell"><div className="hero-copy"><span className="eyebrow"><Sparkles size={15}/> AI home planning for Indian plots</span><h1>Know what fits.<br/><span>Know what it costs.</span></h1><p>Turn your plot and family brief into a clear home concept, cost plan and expert-ready report — before you spend on drawings or contractors.</p><div className="button-row"><button className="button" onClick={() => go('/start')}>Plan my home free <ArrowRight size={18}/></button><button className="button secondary" onClick={() => go('/pricing')}>See plans</button></div><span className="microcopy"><ShieldCheck size={15}/> No card required · Your project stays private</span></div>
      <div className="hero-visual"><img src="/assets/grihagrid-hero.png" alt="Modern Indian two-storey home with a subtle floor plan overlay"/><div className="metric-float"><span>Planning range</span><strong>₹35.8L – ₹42.9L</strong><small>30 × 50 ft · Pune</small></div></div></section>
      <section className="proof shell" aria-label="Key outcomes"><div><strong>₹0</strong><span>to test feasibility</span></div><div><strong>&lt; 15 min</strong><span>to a complete plan</span></div><div><strong>8 cities</strong><span>with local cost factors</span></div><div><strong>Human review</strong><span>when accuracy matters</span></div></section>
      <section id="how" className="section shell"><SectionTitle title="From plot to plan in four clear steps" copy="A guided workflow that removes the blank-page problem from home planning."/><div className="steps-grid">{steps.map(([Icon,title,copy],i)=><article className="step-card" key={title}><span className="step-icon"><Icon/></span><span className="step-number">0{i+1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="section shell"><SectionTitle eyebrow="Live feasibility" title="See your likely build range now" copy="Adjust the inputs and get an immediate planning range based on your plot."/><EstimateCalculator/></section>
      <section className="section shell"><SectionTitle title="One report. Every early decision." copy="Designed for family alignment, architect conversations and contractor shortlisting."/><div className="feature-grid">{reportFeatures.map(([Icon,title,copy])=><article key={title}><span className="feature-icon"><Icon/></span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="section shell"><SectionTitle eyebrow="Transparent, one-time pricing" title="Start free. Pay only when the detail matters." copy="No subscription and no surprise fees."/><PricingCards/></section>
      <section className="section shell faq-wrap"><SectionTitle title="Questions, answered plainly"/><div className="faq-list">{faqs.map(([q,a],i)=><details key={q} open={i===0}><summary>{q}<ChevronDown/></summary><p>{a}</p></details>)}</div></section>
      <section className="cta-band shell"><div><span className="eyebrow">Your plot deserves clarity</span><h2>Make the expensive decisions after you can see the plan.</h2><p>Start with a free feasibility check. No card, no sales call.</p></div><button className="button light" onClick={() => go('/start')}>Start my project <ArrowRight/></button></section>
    </main><Footer/>
  </>
}

function PricingPage(){return <main className="page shell"><SectionTitle eyebrow="One plot · one payment" title="Choose the confidence level you need" copy="Start free, then unlock deeper planning or a verified architect review when you are ready."/><PricingCards/><div className="assurance-row"><span><ShieldCheck/> Private project data</span><span><IndianRupee/> Clear GST at checkout</span><span><Download/> PDF and invoice access</span></div></main>}

function AboutPage(){return <main className="page shell"><div className="about-hero"><span className="eyebrow">Why GrihaGrid</span><h1>Home planning should start with evidence, not guesswork.</h1><p>Most first-time home builders spend weeks collecting contradictory opinions before they understand what fits or what it will cost. GrihaGrid gives families a structured starting point, then brings professionals in when professional judgment matters.</p></div><div className="values-grid"><article><h3>Clarity first</h3><p>Every result shows assumptions, ranges and limitations. No black-box promises.</p></article><article><h3>Built for context</h3><p>Indian plots, regional cost bands, Vastu preferences and local approval realities.</p></article><article><h3>Human when needed</h3><p>AI accelerates exploration. Verified architects validate decisions with real consequences.</p></article></div><div className="mission"><Building2/><div><h2>Our north star</h2><p>Help every family enter their first architect or contractor conversation with a clear brief, a realistic budget and the confidence to ask better questions.</p></div></div></main>}

function AuthPage({mode='login'}) { const isLogin=mode==='login'; return <main className="auth-page"><div className="auth-card"><Brand/><button className="back-link" onClick={()=>go('/')}>&larr; Back to home</button><h1>{isLogin?'Welcome back':'Create your workspace'}</h1><p>{isLogin?'Continue planning your home.':'Save your first feasibility project in minutes.'}</p><form onSubmit={e=>{e.preventDefault();go('/dashboard')}}>{!isLogin&&<label>Full name<input required placeholder="Asha Verma" autoComplete="name"/></label>}<label>Email<input required type="email" placeholder="you@example.com" autoComplete="email"/></label><label>Password<input required minLength="8" type="password" placeholder="At least 8 characters" autoComplete={isLogin?'current-password':'new-password'}/></label><button className="button full" type="submit">{isLogin?'Log in':'Create account'}<ArrowRight size={17}/></button></form><p className="switch-auth">{isLogin?'New to GrihaGrid? ':'Already have an account? '}<button onClick={()=>go(isLogin?'/register':'/login')}>{isLogin?'Create an account':'Log in'}</button></p><small>Demo mode: authentication routes to the sample dashboard. Production magic-link support is included in the Worker API.</small></div></main> }

const wizardSteps=['Plot','Home','Context','Review'];
function StartPage(){
  const [step,setStep]=useState(0); const [data,setData]=useState({width:30,length:50,city:'Pune',facing:'East',floors:'G+1',bedrooms:'3',parking:'1 car',style:'Warm modern'});
  const update=(k,v)=>setData({...data,[k]:v});
  return <main className="wizard-page"><div className="wizard-shell"><div className="wizard-top"><Brand/><button className="text-button" onClick={()=>go('/')}>Save & exit</button></div><div className="progress-row">{wizardSteps.map((s,i)=><div className={i<=step?'active':''} key={s}><span>{i<step?<Check/>:i+1}</span><small>{s}</small></div>)}</div><section className="wizard-card">
    {step===0&&<><span className="eyebrow">Step 1 of 4</span><h1>Tell us about your plot</h1><p>Use your sale deed or latest survey for the most useful result.</p><div className="form-grid"><label>Plot width (ft)<input type="number" min="10" value={data.width} onChange={e=>update('width',e.target.value)}/></label><label>Plot length (ft)<input type="number" min="10" value={data.length} onChange={e=>update('length',e.target.value)}/></label><label>City<select value={data.city} onChange={e=>update('city',e.target.value)}>{Object.keys(cities).map(c=><option key={c}>{c}</option>)}</select></label><label>Road-facing side<select value={data.facing} onChange={e=>update('facing',e.target.value)}>{['North','East','South','West'].map(x=><option key={x}>{x}</option>)}</select></label></div></>}
    {step===1&&<><span className="eyebrow">Step 2 of 4</span><h1>What should the home hold?</h1><p>Choose a practical starting brief; you can refine it later.</p><div className="wizard-options"><ToggleGroup label="Floors" value={data.floors} options={['G','G+1','G+2']} onChange={v=>update('floors',v)}/><ToggleGroup label="Bedrooms" value={data.bedrooms} options={['2','3','4','5+']} onChange={v=>update('bedrooms',v)}/><ToggleGroup label="Parking" value={data.parking} options={['None','1 car','2 cars']} onChange={v=>update('parking',v)}/></div></>}
    {step===2&&<><span className="eyebrow">Step 3 of 4</span><h1>Add site context</h1><p>Optional photos improve the Site+ report. You can skip them for a free feasibility result.</p><label className="upload-zone"><Upload/><strong>Upload plot photos</strong><span>JPG, PNG or HEIC · up to 10 MB each</span><input type="file" accept="image/*" multiple/></label><label>Preferred exterior style<select value={data.style} onChange={e=>update('style',e.target.value)}>{['Warm modern','Contemporary','Traditional Indian','Minimal','Tropical'].map(x=><option key={x}>{x}</option>)}</select></label></>}
    {step===3&&<><span className="eyebrow">Step 4 of 4</span><h1>Your brief is ready</h1><p>Review the assumptions before generating your free result.</p><div className="brief-summary"><div><span>Plot</span><strong>{data.width} × {data.length} ft · {data.facing}</strong></div><div><span>Home</span><strong>{data.floors} · {data.bedrooms} bedrooms</strong></div><div><span>Location</span><strong>{data.city}</strong></div><div><span>Style</span><strong>{data.style}</strong></div></div><div className="notice"><CircleAlert/><span>This is an early planning concept, not a municipal, architectural or structural approval.</span></div></>}
    <div className="wizard-actions">{step>0&&<button className="button secondary" onClick={()=>setStep(step-1)}>Back</button>}<button className="button" onClick={()=>step<3?setStep(step+1):go('/dashboard')}>{step<3?'Continue':'Generate free feasibility'}<ArrowRight size={17}/></button></div>
  </section></div></main>
}

function Dashboard(){return <main className="dashboard"><aside><Brand/><nav><button className="active"><Grid2X2/>Overview</button><button><FileText/>Projects</button><button><UserRound/>Expert reviews</button></nav><button className="logout"><LogOut/>Log out</button></aside><section className="dash-main"><div className="dash-heading"><div><span className="eyebrow">Your workspace</span><h1>Good morning, Asha</h1><p>Your home plan is taking shape.</p></div><button className="button" onClick={()=>go('/start')}><Plus/>New project</button></div><div className="status-strip"><div><span>Active projects</span><strong>1</strong></div><div><span>Reports ready</span><strong>1</strong></div><div><span>Expert reviews</span><strong>0</strong></div></div><article className="project-card"><div className="project-thumb"><img src="/assets/grihagrid-hero.png" alt="Warm modern home concept"/></div><div className="project-info"><span className="status"><span></span>Feasibility ready</span><h2>Pune family home</h2><p>30 × 50 ft · East-facing · G+1 · 3 bedrooms</p><div className="project-metrics"><div><span>Fit score</span><strong>Good</strong></div><div><span>Built-up</span><strong>1,830 sq ft</strong></div><div><span>Budget range</span><strong>₹37.0L–₹44.2L</strong></div></div><div className="button-row"><button className="button" onClick={()=>go('/report')}>Open report <ArrowRight/></button><button className="button secondary">Upgrade</button></div></div></article></section></main>}

function ReportPage(){return <main className="report-page"><div className="report-bar"><button className="text-button" onClick={()=>go('/dashboard')}>&larr; Dashboard</button><Brand/><button className="button small"><Download/>Download PDF</button></div><div className="report-shell"><div className="report-title"><span className="status"><span></span>Generated 12 Aug 2026</span><h1>Pune family home</h1><p>Concept feasibility report · 30 × 50 ft · East-facing</p></div><div className="report-score"><div><span>Plot fit</span><strong>Good</strong><small>74 / 100</small></div><div><span>Estimated built-up</span><strong>1,830 sq ft</strong><small>G+1 concept</small></div><div><span>Planning range</span><strong>₹37.0L–₹44.2L</strong><small>Signature finish</small></div></div><section className="report-section"><h2>Executive readout</h2><p>Your brief is viable on this plot with comfortable common spaces and three bedrooms. The main constraint is ground-floor parking width; keeping the stair compact and aligning wet areas vertically protects usable space and cost.</p><div className="callout success"><Check/><span><strong>Strong fit:</strong> east entry, southeast kitchen and southwest primary bedroom can be achieved without compromising circulation.</span></div></section><section className="report-section locked"><Layers3/><div><span className="eyebrow">Available on Plan</span><h2>Floor concepts and room dimensions</h2><p>Unlock a dimensioned concept for each floor, plus alternative layout directions.</p></div><button className="button" onClick={()=>go('/pricing')}>Unlock for ₹499</button></section><section className="report-section"><h2>Indicative phase budget</h2>{[['Foundation & structure','32%','₹11.8L–₹14.1L'],['Masonry & plaster','18%','₹6.7L–₹8.0L'],['Services','17%','₹6.3L–₹7.5L'],['Finishes','26%','₹9.6L–₹11.5L'],['External & contingency','7%','₹2.6L–₹3.1L']].map(([n,p,c])=><div className="budget-row" key={n}><span>{n}</span><div><i style={{width:p}}></i></div><strong>{c}</strong></div>)}</section><div className="report-disclaimer"><ShieldCheck/><p><strong>Use this report to plan, not to build.</strong> A licensed local architect and structural engineer must validate site conditions, bylaws, drawings and construction specifications.</p></div></div></main>}

function LegalPage({type}) { const titles={privacy:'Privacy policy',terms:'Terms of use',refund:'Refund and cancellation policy'}; return <main className="page shell legal"><h1>{titles[type]}</h1><p>Last updated: 12 August 2026</p><h2>Plain-language summary</h2><p>GrihaGrid is a concept-stage planning service. We collect only the information needed to operate your account, generate reports and support purchases. Project files are private by default and can be deleted on request.</p><h2>Important limitation</h2><p>Generated plans, costs and compliance notes are indicative. They are not a substitute for licensed architectural, structural, geotechnical, legal or municipal advice.</p><h2>Payments and refunds</h2><p>Free projects require no payment. Paid digital reports may be cancelled before generation starts. Expert reviews may be cancelled before an architect accepts the assignment. Where generation or review has started, refunds are assessed under applicable Indian consumer law.</p><h2>Contact</h2><p>Email privacy and support requests to <a href="mailto:hello@grihagrid.in">hello@grihagrid.in</a>. This draft must be reviewed by counsel before commercial launch.</p></main> }

export function App(){
  const [path,setPath]=useState(window.location.pathname); const [theme,setTheme]=useState(localStorage.getItem('theme')||'dark');
  useEffect(()=>{const fn=()=>setPath(window.location.pathname);window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn)},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme)},[theme]);
  const auth=path==='/login'||path==='/register', dashboard=path==='/dashboard', report=path==='/report', wizard=path==='/start';
  if(auth)return <AuthPage mode={path.slice(1)}/>; if(dashboard)return <Dashboard/>; if(report)return <ReportPage/>; if(wizard)return <StartPage/>;
  let content=path==='/pricing'?<PricingPage/>:path==='/about'?<AboutPage/>:path.startsWith('/privacy')?<LegalPage type="privacy"/>:path.startsWith('/terms')?<LegalPage type="terms"/>:path.startsWith('/refund')?<LegalPage type="refund"/>:<HomePage/>;
  return <><Header theme={theme} setTheme={setTheme}/>{content}{path!=='/'&&<Footer/>}</>;
}
