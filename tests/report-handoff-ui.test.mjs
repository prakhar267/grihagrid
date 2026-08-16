import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("../",import.meta.url);

async function sources() {
  const [app,styles]=await Promise.all([
    readFile(new URL("src/App.jsx",root),"utf8"),
    readFile(new URL("src/styles.css",root),"utf8"),
  ]);
  const ownerStart=app.indexOf("function ReportHandoffPanel(");
  const ownerEnd=app.indexOf("function ReportPage(",ownerStart);
  const publicStart=app.indexOf("function SharedReportState(");
  const publicEnd=app.indexOf("function FamilyReviewComparison(",publicStart);
  assert.ok(ownerStart>=0&&ownerEnd>ownerStart,"ReportHandoffPanel must remain a discrete owner component");
  assert.ok(publicStart>=0&&publicEnd>publicStart,"SharedReportPage must remain a discrete public component");
  return {app,styles,owner:app.slice(ownerStart,ownerEnd),publicPage:app.slice(publicStart,publicEnd)};
}

test("owner handoff sends one exact immutable report identity and bounded section selection",async()=>{
  const {app,owner}=await sources();
  const vocabulary=app.slice(app.indexOf("const reportHandoffSectionOptions"),app.indexOf("const reportHandoffSectionSet"));
  const defaults=app.slice(app.indexOf("const defaultReportHandoffSections"),app.indexOf("function useCommerceCatalog"));
  assert.deepEqual(
    [...vocabulary.matchAll(/\["([a-z_]+)",/gu)].map(match=>match[1]),
    ["overview","programme","cost","timeline","risks","next_actions"],
  );
  assert.match(defaults,/defaultReportHandoffSections = \["overview", "risks", "next_actions"\]/u);
  assert.match(owner,/\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/report-shares/u);
  assert.match(owner,/body:\{projectRevision,reportSchemaVersion,expiresInDays:Number\(days\),sections\}/u);
  assert.match(owner,/headers:\{"idempotency-key":idempotencyKey\(storageKey\)\}/u);
  assert.match(owner,/<option value="1">In 24 hours<\/option><option value="7">In 7 days<\/option><option value="30">In 30 days<\/option>/u);
  assert.match(owner,/<fieldset aria-describedby=\{selectionId\}/u);
  assert.match(owner,/<legend>Choose what the professional can see<\/legend>/u);
  assert.match(owner,/aria-live="polite">\{selectedCount\} of \{reportHandoffSectionOptions.length\} sections selected/u);
});

test("one-time report addresses never come from list metadata or token reconstruction",async()=>{
  const {app,owner}=await sources();
  const metadata=app.slice(app.indexOf("function reportShareMetadata("),app.indexOf("function oneTimeReportShareUrl("));
  assert.doesNotMatch(metadata,/\burl\b|\btoken\b/u,"listed metadata must discard every secret-bearing field");
  assert.match(owner,/const url=oneTimeReportShareUrl\(result\?\.share\?\.url\)/u);
  assert.match(owner,/setSecret\(\{shareId:share.id,url\}\)/u);
  assert.match(owner,/GrihaGrid will not show this address again after you leave or refresh\./u);
  assert.match(owner,/readOnly value=\{secret.url\}/u);
  assert.doesNotMatch(owner,/share\.token|\/share\/report\/\$\{/u,"the browser must never reconstruct a listed secret");
  assert.match(app,/url\.origin!==window\.location\.origin/u,"a created URL must stay on the canonical first-party origin");
  assert.match(app,/url\.pathname!=="\/share\/report"[\s\S]*?!\/\^#\[A-Za-z0-9_-\]\{43\}\$\/u\.test\(url\.hash\)/u);
});

test("current, historical, and archived report handoff states preserve evidence semantics",async()=>{
  const {app,owner}=await sources();
  const report=app.slice(app.indexOf("function ReportPage("),app.indexOf("function LegalPage("));
  assert.match(report,/reportSchemaVersion===2&&<ReportHandoffPanel/u);
  assert.match(report,/projectRevision=\{projectRevision\} reportSchemaVersion=\{reportSchemaVersion\} archived=\{archived\} historical=\{historical\}/u);
  assert.match(owner,/archived\?\(historical\?"Review this archived revision’s handoff history\.":"Review this archived report’s handoff history\."\):historical\?"Share this exact saved revision\.":"Put this report in the room\."/u);
  assert.match(owner,/This saved report remains readable, while link creation and copying are closed\. Active bearer links can still be revoked below\./u);
  assert.match(owner,/if\(archived\)setSecret\(null\)/u);
  assert.match(owner,/archived\?<div className="report-handoff__notice"[\s\S]*?:<form className="report-handoff__form"/u);
  assert.match(owner,/New links and copying are closed\. Any still-active link can be revoked/u);
  assert.match(owner,/state==="active"&&<button className="report-handoff__revoke"/u,"revocation must remain available while archived");
  assert.match(owner,/The saved report is not deleted\. This cannot be undone\./u);
  assert.match(owner,/Revision \{share.projectRevision\}[\s\S]*?this report[\s\S]*?another saved report/u);
});

test("public handoff route is anonymous, exact, identity-free, and handles stable failures",async()=>{
  const {app,publicPage}=await sources();
  const appComponent=app.slice(app.indexOf("export function App()"));
  assert.match(app,/function isPublicReportSharePath\(pathname\) \{[\s\S]*?return pathname==="\/share\/report"/u);
  assert.match(app,/if\(path==='\/share\/report'\)return <SharedReportPage\/>/u);
  assert.match(app,/path==='\/share\/report'\?'Professional handoff — GrihaGrid'/u);
  assert.match(publicPage,/publicApi\("\/api\/shared\/report",\{method:"POST",body:\{token\},signal\}\)/u);
  assert.doesNotMatch(publicPage,/publicApi\([^\n]*token\)/u,"the capability must never occur in a requested URL");
  assert.match(publicPage,/err instanceof ApiError&&err\.status===410\?"closed":err instanceof ApiError&&err\.status===404\?"missing":"error"/u);
  assert.match(publicPage,/Link expired or revoked/u);
  assert.match(publicPage,/Handoff link unavailable/u);
  assert.match(publicPage,/Secure sharing unavailable/u);
  assert.match(publicPage,/A planning report for professional review\./u);
  assert.match(publicPage,/This page contains only the report sections the owner selected\./u);
  assert.match(appComponent,/useState\(\(\)=>isPublicReportSharePath\(window\.location\.pathname\)\?null:undefined\)/u);
  assert.match(appComponent,/if\(isPublicReportSharePath\(path\)\)\{[\s\S]*?authenticatedSession\.current=false;setUser\(null\);return\}[\s\S]*?api\('\/api\/auth\/me'\)/u,"initial public report loads must not bootstrap a credentialed session");
  assert.match(appComponent,/if\(isPublicReportSharePath\(pathname\)\)\{authenticatedSession\.current=false;setUser\(null\);return\}[\s\S]*?if\(checking\|\|!shouldRevalidateSession/u,"focus and resume must not revalidate a session on a public report");
  assert.match(publicPage,/window\.addEventListener\("hashchange",refreshCapability\)/u);
  assert.match(publicPage,/token!==capabilityRef\.current/u,"a stale capability response must not replace a newer fragment");
  for(const forbidden of ["projectId","userId","email","projectName","contentHash","sourceInputHash","JSON.stringify"]){
    assert.equal(publicPage.includes(forbidden),false,`public report renderer must not expose or inspect ${forbidden}`);
  }
});

test("public renderer allowlists selected report sections and preserves week-based timeline facts",async()=>{
  const {app,publicPage}=await sources();
  const normalizer=app.slice(app.indexOf("function normalizePublicReportShare("),app.indexOf("function Brand("));
  for(const key of ["overview","programme","cost","timeline","risks","nextActions"]){
    assert.match(normalizer,new RegExp(`\\b${key}\\b`,"u"));
  }
  assert.match(normalizer,/weeks:publicReportNumber\(phase\.weeks\)/u);
  assert.match(publicPage,/phase\.weeks!==null\?`\$\{phase\.weeks\} week\$\{phase\.weeks===1\?"":"s"\}`/u);
  assert.match(publicPage,/\{overview&&<section/u);
  assert.match(publicPage,/\{programme&&<section/u);
  assert.match(publicPage,/\{cost&&<section/u);
  assert.match(publicPage,/\{timeline&&<section/u);
  assert.match(publicPage,/\{sections\.risks\.length>0&&<section/u);
  assert.match(publicPage,/\{sections\.nextActions\.length>0&&<section/u);
  assert.match(publicPage,/Professional validation is still required\./u);
  assert.doesNotMatch(publicPage,/dangerouslySetInnerHTML/u);
});

test("handoff controls and public report reflow, announce state, and print without private controls",async()=>{
  const {owner,publicPage,styles}=await sources();
  assert.match(owner,/aria-busy=\{phase==="loading"\|\|Boolean\(busy\)\}/u);
  assert.match(owner,/role="status" aria-live="polite"/u);
  assert.match(owner,/role="alert"/u);
  assert.match(owner,/tabIndex="-1"/u);
  assert.match(owner,/messageRef\.current\?\.focus\(\)/u);
  assert.match(owner,/secretRef\.current\?\.focus\(\)/u);
  assert.match(publicPage,/aria-busy="true"/u);
  assert.match(publicPage,/role="alert"[\s\S]*?<h1 ref=\{headingRef\} tabIndex="-1">/u);
  assert.match(publicPage,/<button onClick=\{printSharedReportWithoutCapability\}/u);
  assert.match(styles,/\.report-handoff__link button\s*\{[\s\S]*?min-width: 48px;[\s\S]*?min-height: 48px;/u);
  assert.match(styles,/\.report-handoff__secret:focus-visible,[\s\S]*?outline: 2px solid var\(--copper\);/u);
  assert.match(styles,/\.report-handoff\s*\{[\s\S]*?overflow-wrap: anywhere;/u);
  assert.match(styles,/\.shared-report\s*\{[\s\S]*?overflow-wrap: anywhere;/u);
  assert.match(styles,/@media \(max-width: 520px\)[\s\S]*?\.report-handoff__sections,[\s\S]*?grid-template-columns: 1fr;/u);
  assert.match(styles,/\.shared-report__document,[\s\S]*?width: calc\(100% - 1\.5rem\);/u);
  assert.match(styles,/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms !important;/u);
  assert.match(styles,/@media print\s*\{[\s\S]*?\.report-handoff,[\s\S]*?\.shared-report > header,[\s\S]*?\.shared-report__footer[\s\S]*?display: none !important;/u);
  assert.match(styles,/\.shared-report__document\s*\{[\s\S]*?width: 100%;[\s\S]*?margin: 0;[\s\S]*?border: 0;/u);
});

test("printing scrubs the fragment capability and owner revocation reloads authoritative state",async()=>{
  const {app,owner,publicPage,styles}=await sources();
  const printHelpers=app.slice(app.indexOf("function scrubSharedReportCapabilityForPrint("),app.indexOf("function publicReportText("));
  assert.match(printHelpers,/window\.history\.replaceState\(originalState,"",originalPath\)/u);
  assert.match(printHelpers,/window\.addEventListener\("afterprint",finish,\{once:true\}\)/u);
  assert.doesNotMatch(printHelpers,/setTimeout/u,"a long-running print dialog must never restore the capability early");
  assert.match(printHelpers,/!window\.location\.hash/u);
  assert.match(printHelpers,/`\$\{originalPath\}\$\{originalHash\}`/u);
  assert.match(publicPage,/window\.addEventListener\("beforeprint",beforePrint\)/u,"browser-menu printing must also scrub the capability");
  assert.match(publicPage,/if\(next===capabilityRef\.current\)return/u,"one fragment transition must trigger at most one redemption");
  assert.match(owner,/await api\(`\/api\/projects\/[\s\S]*?method:"DELETE"/u);
  assert.match(owner,/const refreshed=await load\(\)/u);
  assert.doesNotMatch(owner,/revokedAt:new Date/u,"the client must not fabricate a revocation timestamp");
  assert.match(owner,/Last loaded \$\{formatDateTime\(share\.lastAccessedAt\)\}/u);
  assert.match(owner,/Page loads may include previews or scanners; they are not unique people or proof of review\./u);
  assert.match(owner,/Active links first\. Recent history follows\./u);
  assert.match(owner,/shares\.length===50\?"Showing 50"/u,"a full page must disclose bounded history");
  assert.match(owner,/active links first, followed by recent closed history/u);
  assert.match(owner,/\[projectId,projectRevision,reportSchemaVersion\]/u,"same-project revision changes must clear one-time capability state");
  assert.match(styles,/@media print[\s\S]*?\.shared-report__boundary \{[\s\S]*?background: #fff;[\s\S]*?color: #29241f;/u);
});

test("legal copy explains capability access counters, scanner noise, retention, and deletion",async()=>{
  const {app}=await sources();
  const legal=app.slice(app.indexOf("function LegalPage("),app.indexOf("function NotFoundPage("));
  assert.match(legal,/Effective 16 August 2026/u);
  assert.match(legal,/<h2>Professional Handoff<\/h2>/u);
  assert.match(legal,/Anyone holding that capability can read/u);
  assert.match(legal,/aggregate open count and last-opened time/u);
  assert.match(legal,/Browser previews, security scanners, and repeated visits may increment/u);
  assert.match(legal,/do not identify a recipient or prove/u);
  assert.match(legal,/retained for up to 90 days/u);
  assert.match(legal,/project deletion removes them with the project/u);
});
