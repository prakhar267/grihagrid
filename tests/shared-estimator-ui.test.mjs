import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [app, styles, documentSource, robots] = await Promise.all([
  readFile(new URL("src/App.jsx", root), "utf8"),
  readFile(new URL("src/styles.css", root), "utf8"),
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("public/robots.txt", root), "utf8"),
]);

const instrumentStart = app.indexOf("function EstimateInstrument(");
const sharedPageStart = app.indexOf("function SharedEstimatorPage(", instrumentStart);
const sharedPageEnd = app.indexOf("function HomePage(", sharedPageStart);
const appStart = app.indexOf("export function App()");
assert.ok(instrumentStart >= 0 && sharedPageStart > instrumentStart, "EstimateInstrument must remain a discrete component");
assert.ok(sharedPageEnd > sharedPageStart, "SharedEstimatorPage must remain a discrete component");
assert.ok(appStart > sharedPageEnd, "App route source must remain available");
const instrument = app.slice(instrumentStart, sharedPageStart);
const sharedPage = app.slice(sharedPageStart, sharedPageEnd);
const appComponent = app.slice(appStart);

test("the shared estimator route is authentication-free and never bootstraps or revalidates a session", () => {
  const authenticationFree = app.slice(app.indexOf("function isAuthenticationFreePath("), app.indexOf("function reportShareCapabilityToken("));
  assert.match(authenticationFree, /isPublicReportSharePath\(pathname\)\|\|isFamilyAlignmentPath\(pathname\)\|\|pathname==="\/estimate"/u);
  assert.match(appComponent, /useState\(\(\)=>isAuthenticationFreePath\(window\.location\.pathname\)\?null:undefined\)/u);
  assert.match(appComponent, /if\(isAuthenticationFreePath\(path\)\)\{[\s\S]*?authenticatedSession\.current=false;setUser\(null\);return\}[\s\S]*?api\('\/api\/auth\/me'\)/u);
  assert.match(appComponent, /if\(isAuthenticationFreePath\(pathname\)\)\{authenticatedSession\.current=false;setUser\(null\);return\}[\s\S]*?if\(checking\|\|!shouldRevalidateSession/u);
  assert.match(appComponent, /'\/estimate':'Shared estimate — GrihaGrid'/u);
  assert.match(appComponent, /if\(path==='\/estimate'\)return <SharedEstimatorPage\/>/u);
  assert.doesNotMatch(sharedPage, /\/api\/auth|csrf|document\.cookie|sessionStorage|localStorage/iu);
});

test("the route parses before rendering, canonicalizes valid links, and never hydrates a partial invalid scenario", () => {
  assert.match(sharedPage, /scenario=useMemo\(\(\)=>parseSharedEstimatorLocation\(window\.location\),\[locationRevision\]\)/u);
  assert.match(sharedPage, /window\.addEventListener\("popstate",onPop\)/u);
  assert.match(sharedPage, /const canonical=buildSharedEstimatorPath\(scenario\)/u);
  assert.match(sharedPage, /if\(!scenario\)\{[\s\S]*window\.history\.replaceState\(\{\},"","\/estimate"\)/u);
  assert.match(sharedPage, /window\.history\.replaceState\(\{\},"",canonical\)/u);
  assert.match(sharedPage, /if\(!scenario\)return <main[\s\S]*?Shared scenario unavailable/u);
  assert.match(sharedPage, /GrihaGrid did not load partial values or substitute defaults\./u);
  assert.match(sharedPage, /open a new estimator without carrying anything from this address/u);
  assert.match(sharedPage, /route\("\/#plot-cost-estimator"\)/u);
  assert.ok(
    sharedPage.indexOf("if(!scenario)return") < sharedPage.indexOf("const canonicalPath=buildSharedEstimatorPath(scenario)"),
    "an invalid URL must exit before the estimator receives initial values",
  );
  assert.doesNotMatch(sharedPage.slice(sharedPage.indexOf("if(!scenario)return"), sharedPage.indexOf("const canonicalPath")), /<EstimateInstrument/u);
  assert.doesNotMatch(sharedPage, /replaceState\(window\.history\.state/u);
});

test("shared pages are noindex and restore the document metadata when the route unmounts", () => {
  assert.match(documentSource, /<meta name="robots" content="index,follow,max-image-preview:large" \/>/u);
  assert.match(sharedPage, /document\.querySelector\('meta\[name="robots"\]'\)/u);
  assert.match(sharedPage, /robots\?\.setAttribute\("content","noindex,nofollow,noarchive"\)/u);
  assert.match(sharedPage, /return\(\)=>\{if\(robots&&previous!=null\)robots\.setAttribute\("content",previous\)\}/u);
  assert.match(robots, /^Disallow: \/estimate$/mu);
  assert.doesNotMatch(robots, /^Allow: \/estimate$/mu);
});

test("the shared page explains live recalculation and continues with the bounded shared source", () => {
  assert.match(sharedPage, /Scenario shared with you/u);
  assert.match(sharedPage, /only plot width, length, city, floor programme and finish/u);
  assert.match(sharedPage, /not a saved price, address, account or project/u);
  assert.match(sharedPage, /recalculates it against the current planning rule each time it opens/u);
  assert.match(sharedPage, /No sign-in, cookie-backed account check or anonymous server record is needed/u);
  assert.match(sharedPage, /<EstimateInstrument key=\{canonicalPath\} initial=\{scenario\} entryPoint="shared_estimate"\/>/u);
  assert.doesNotMatch(sharedPage, /lowInr|highInr|builtUpSqft|estimateRuleVersion|projectCreationKey|accountId|projectId|token/iu);
  assert.doesNotMatch(sharedPage, /dangerouslySetInnerHTML/u);
});

test("share prefers the native sheet, treats cancellation as neutral, and falls back to copying", () => {
  const shareStart = instrument.indexOf("async function shareScenario()");
  const shareEnd = instrument.indexOf("function retryEstimate()", shareStart);
  assert.ok(shareStart >= 0 && shareEnd > shareStart, "shareScenario must remain a discrete interaction");
  const share = instrument.slice(shareStart, shareEnd);
  assert.match(share, /new URL\(buildSharedEstimatorPath\(validation\.request\), window\.location\.origin\)\.href/u);
  assert.match(share, /typeof navigator\.share === "function"/u);
  assert.match(share, /await navigator\.share\(\{[\s\S]*?title: "GrihaGrid plot-cost scenario"[\s\S]*?url,[\s\S]*?\}\)/u);
  assert.match(share, /if \(error\?\.name === "AbortError"\) \{[\s\S]*?phase: "idle", message: ""[\s\S]*?return/u);
  assert.match(share, /await copyText\(url\)/u);
  assert.ok(share.indexOf("await navigator.share") < share.indexOf("await copyText(url)"));
  assert.match(share, /Scenario shared\. The link contains only these five planning inputs\./u);
  assert.match(share, /Link copied\. It contains only these five planning inputs\./u);
  assert.match(share, /This browser could not share or copy the link\. Your scenario is unchanged\./u);
  assert.doesNotMatch(share, /lowInr|highInr|builtUpSqft|projectCreationKey|email|address|token/iu);
});

test("share success and failure expose bounded, focus-safe accessible states", () => {
  assert.match(instrument, /disabled=\{!validation\.valid\|\|shareState\.phase==="sharing"\}/u);
  assert.match(instrument, /aria-busy=\{shareState\.phase==="sharing"\}/u);
  assert.match(instrument, /<ShareNetwork\/> \{shareState\.phase==="sharing"\?"Preparing link…":"Share scenario"\}<\/button>/u);
  assert.match(instrument, /tabIndex=\{shareState\.phase==="error"\?"-1":undefined\}/u);
  assert.match(instrument, /role=\{shareState\.phase==="error"\?"alert":"status"\} aria-live="polite"/u);
  assert.match(instrument, /window\.requestAnimationFrame\(\(\) => shareMessageRef\.current\?\.focus\(\{ preventScroll: true \}\)\)/u);
  assert.match(sharedPage, /className="shared-estimate-workbench" aria-labelledby="shared-estimate-title"/u);
  assert.match(sharedPage, /className="shared-estimate-invalid" role="alert"/u);

  assert.match(styles, /\.instrument-share \{[\s\S]*?min-height: 44px;/u);
  assert.match(styles, /\.instrument-share-message:focus \{[\s\S]*?outline: 2px solid var\(--copper\);/u);
  assert.match(styles, /\.shared-estimate-page \{[\s\S]*?overflow-x: clip;/u);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.instrument-actions \{[\s\S]*?flex-direction: column;/u);
  assert.match(styles, /\.instrument-actions \.text-link,[\s\S]*?\.instrument-share \{[\s\S]*?min-height: 48px;/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms !important;/u);
  assert.match(styles, /@media print[\s\S]*?\.instrument-actions,[\s\S]*?\.instrument-share-message,[\s\S]*?display: none !important;/u);
});
