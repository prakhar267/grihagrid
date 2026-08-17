import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const storage = await readFile(new URL("../src/anonymous-draft.js", import.meta.url), "utf8");

test("returning visitors must explicitly resume or discard before draft hydration", () => {
  const start = app.slice(app.indexOf("function StartPage("), app.indexOf("function Choice("));
  assert.match(start, /if\(recovery\)return[\s\S]*aria-labelledby="draft-resume-title"[\s\S]*Continue where you left off\./u);
  assert.match(start, />Resume brief <ArrowRight\/>/u);
  assert.match(start, /<Trash\/> Discard and start over/u);
  assert.match(start, /Dedicated account, password, estimate and upload fields are excluded/u);
  assert.match(start, /Project-name text is included—use a neutral label/u);
  assert.doesNotMatch(start, /aria-modal=/u);
  assert.ok(start.indexOf("if(recovery)return") < start.indexOf("const frozen="));
});

test("the wizard exposes honest save, expiry, exit, discard, conflict, and exact-retry states", () => {
  const start = app.slice(app.indexOf("function StartPage("), app.indexOf("function Choice("));
  for (const copy of [
    "Saved on this browser until",
    "The current exact copy is kept only in this open tab",
    "Save & exit",
    "Discard draft",
    "another tab changed this draft",
    "Exact retry protected.",
    "Retry exact save",
  ]) assert.match(start, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(start, /window\.addEventListener\("storage",onStorage\)/u);
  assert.match(start, /window\.addEventListener\("pageshow",reconcile\)/u);
  assert.match(start, /if\(!draftAccess\.usableRef\.current\)return/u);
  assert.match(start, /document\.addEventListener\("visibilitychange",onVisibility\)/u);
  assert.match(start, /if\(!user&&!record&&!dirtyRef\.current\)\{abandonPendingProjectHandoff\(\);clearDraftNavigationState\(\);route\("\/"\);return\}/u);
  assert.match(start, /if\(user&&!record\)\{abandonPendingProjectHandoff\(\);clearDraftNavigationState\(\);route\("\/"\);return\}/u);
  assert.match(start, /activeDraft\|\|\(!user&&dirtyRef\.current\)\?"Save & exit":"Exit"/u);
  assert.match(start, /claimAnonymousDraftPayloadSource\(result\.record\)/u);
});

test("full draft payloads no longer enter session storage or navigation history", () => {
  const legacyCleanupStart = storage.indexOf("export function clearLegacyPendingProjectState(");
  const legacyCleanupEnd = storage.indexOf("\n}\n", legacyCleanupStart) + 3;
  const currentDraftStorage = storage.slice(0, legacyCleanupStart) + storage.slice(legacyCleanupEnd);
  assert.doesNotMatch(app, /setSessionValue\("grihagrid\.pendingProject"/u);
  assert.doesNotMatch(app, /pendingProject\s*:/u);
  assert.doesNotMatch(app, /history\.(?:pushState|replaceState)\([^\n]*draft/u);
  assert.doesNotMatch(currentDraftStorage, /sessionStorage|history\.state|document\.cookie/u);
  assert.match(app, /useEffect\(\(\)=>\{clearLegacyPendingProjectState\(\);purgeInvalidAnonymousDraftOnBoot\(\)\},\[\]\)/u);
  assert.match(app, /clearDraftNavigationState\(\)/u);
  assert.match(storage, /delete next\.pendingProject/u);
});

test("auth continuation carries credentials separately from the exact browser draft", () => {
  const auth = app.slice(app.indexOf("function AuthPage("), app.indexOf("function accountSecurityFailure("));
  assert.match(auth, /const authBody=isLogin\?\{email:form\.email,password:form\.password\}:\{name:form\.name,email:form\.email,password:form\.password\}/u);
  assert.match(auth, /type="password"[^>]*value=\{form\.password\}[^>]*onChange=\{e=>setForm\(\{\.\.\.form,password:e\.target\.value\}\)\}/u);
  assert.match(auth, /readAnonymousDraftContinuation\(localStorageRef\.current,projectCreationKey\)/u);
  assert.match(auth, /'idempotency-key':pending\.projectCreationKey/u);
  assert.match(auth, /body:projectRequestBody\(pending\.draft\)/u);
  assert.match(auth, /clearAnonymousDraftAfterCreation\(localStorageRef\.current,pending\)/u);
  assert.doesNotMatch(auth, /authBody[^\n]*(?:draft|projectCreationKey|pending)/u);
  assert.match(auth, /!sameAnonymousDraftVersion\(pending,continuation\)/u);
  assert.match(auth, /current\.writeId===expectedWriteId&&current\.revision===expectedRevision/u);
  assert.match(auth, /const accessEpoch=draftAccess\.epochRef\.current/u);
  assert.match(auth, /continuationRequested&&!accessStillCurrent\(\)\)throw new Error\("draft_access_lost"\)/u);
  assert.ok(auth.lastIndexOf('if(!accessStillCurrent())throw new Error("draft_access_lost")') < auth.indexOf("await apiResponse('/api/projects'"));
  assert.match(auth, /const project=acceptedAnonymousProjectCreationResponse\(response\.payload,response\.status,pending\);if\(!project\)throw new Error\("project_response_invalid"\)/u);
  assert.ok(auth.indexOf("acceptedAnonymousProjectCreationResponse") < auth.indexOf("clearAnonymousDraftAfterCreation"));
  assert.match(auth, /const cleanup=accessStillCurrent\(\)\?clearAnonymousDraftAfterCreation/u);
  assert.match(auth, /err instanceof ApiError&&err\.status===401[\s\S]*markContinuation\(pending,"awaiting_auth"\)[\s\S]*onAuthenticated\(null\);setAuthenticated\(false\)/u);
  assert.match(auth, /if\(pending&&!retained\)return/u);
  assert.ok(auth.indexOf('err?.message==="draft_access_lost"') < auth.indexOf("markContinuation(pending,\"retry_required\")"));
  assert.doesNotMatch(auth, /readAnonymousDraftContinuation\([^\n]+\)\|\|continuation/u);
  assert.match(auth, /else if\(user===null\|\|!continuationRequested\)setAuthenticated\(false\)/u);
  assert.match(auth, /api\("\/api\/auth\/me"\)[\s\S]*isApplicationUnauthenticated\(err\)[\s\S]*onAuthenticated\(null\)/u);
  assert.match(auth, /if\(result\.user\)\{onAuthenticated\(result\.user\);replaceRoute\("\/dashboard"\)\}/u);
  assert.match(auth, /if\(user&&!continuationRequested\)return <main[\s\S]*Checking your account\./u);
  assert.match(app, /safeState=\{projectCreationKey:key/u);
  assert.match(app, /projectContinuation:true/u);
  assert.match(app, /anonymousDraftWriteId: envelope\.writeId/u);
  assert.match(app, /anonymousDraftRevision: envelope\.revision/u);
  assert.match(app, /readAnonymousDraftAttribution\(storage, envelope\)/u);
  assert.match(app, /retainAnonymousDraftAttribution\(localStorageRef\.current,result\.record,entryPoint\)/u);
  assert.match(storage, /!\[null, "public_estimator"\]\.includes\(value\.entryPoint\)/u);
  assert.doesNotMatch(storage, /\[null, "public_estimator", "shared_estimate"\]/u);
});

test("all shared draft access is gated by one workflow-scoped Web Lock", () => {
  const access = app.slice(app.indexOf("function useAnonymousDraftStorageAccess("), app.indexOf("function AnonymousDraftAccessGate("));
  assert.match(access, /holdAnonymousDraftLock\(lockManager/u);
  assert.match(access, /if\(status==="acquired"\)[\s\S]*safeLocalStorage\(\)/u);
  assert.match(access, /status==="contended"\?"contended":"memory"/u);
  assert.match(access, /window\.addEventListener\("pagehide",onPageHide\)/u);
  assert.match(access, /window\.addEventListener\("pageshow",onPageShow\)/u);
  assert.match(access, /storageRef\.current=null;usableRef\.current=false;epochRef\.current\+=1;releaseRef\.current\(\);setPhase\("checking"\)/u);
  assert.match(app, /draftWorkflow=path==="\/start"[\s\S]*projectContinuation===true/u);
  assert.match(app, /This brief is open in another tab/u);
});

test("recovery and auth states preserve the monograph layout at narrow widths", () => {
  for (const selector of [
    ".draft-resume-sheet",
    ".draft-resume-actions",
    ".anonymous-draft-status",
    ".anonymous-draft-frozen",
    ".auth-continuation-ready",
    ".auth-continuation-missing",
  ]) assert.match(styles, new RegExp(selector.replace(".", "\\."), "u"));
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px)"));
  assert.match(mobile, /\.draft-resume-actions[\s\S]*flex-direction: column/u);
  assert.match(mobile, /\.draft-resume-actions \.copper-button,[\s\S]*width: 100%/u);
  assert.match(mobile, /\.draft-resume-sheet \{[\s\S]*min-height: 0;[\s\S]*padding: 1\.25rem 1rem/u);
  assert.match(mobile, /\.draft-resume-sheet h1 \{[\s\S]*font-size: 2\.45rem/u);
});

test("resume and validation transitions preserve truthful disclosure and focus", () => {
  const start = app.slice(app.indexOf("function StartPage("), app.indexOf("function Choice("));
  assert.match(start, /Saved on this browser/u);
  assert.match(start, /browser copy/u);
  assert.match(start, /plaintext in this browser profile/u);
  assert.match(start, /recoveryPersisted\?"Saved on this browser":"Kept in this open tab"/u);
  assert.match(start, /resumeFocusPendingRef\.current=true/u);
  assert.equal([...start.matchAll(/resumeFocusPendingRef\.current=true/gu)].length, 2);
  assert.match(start, /document\.querySelector\("\.wizard-sheet h1"\)/u);
  assert.match(start, /const sameHandoff=window\.history\.state\?\.projectCreationKey===projectCreationKey/u);
  assert.match(start, /const scenario=sameHandoff\?parseStoredEstimatorScenario/u);
  assert.match(start, /if\(projectCreationKey!==current\.projectCreationKey\)\{abandonPendingProjectHandoff\(\);clearDraftNavigationState\(\)\}/u);
  assert.match(start, /if\(!canonical\)[\s\S]*An older saved value will not be submitted/u);
  assert.match(start, /prepareAnonymousDraftSubmission\(data,activeDraftRef\.current\)/u);
  assert.match(start, /prepareAnonymousDraftExit\(data,step,record\)/u);
  assert.match(start, /older browser copy was not substituted/u);
  assert.match(start, /document\.querySelector\("\.wizard-sheet :invalid"\)/u);
  assert.match(start, /aria-invalid=\{saveState==="invalid"&&!validAnonymousProjectName\(data\.name\)/u);
  assert.match(start, /aria-describedby=\{saveState==="invalid"&&!validAnonymousProjectName\(data\.name\)\?"draft-save-error"/u);
  assert.match(start, /sameAnonymousDraftVersion\(recoverable,record\)/u);
  assert.match(start, /sameAnonymousDraftVersion\(readAnonymousDraftContinuation\(localStorageRef\.current,submission\.projectCreationKey\),submission\)/u);
  assert.match(start, /const retained=submission\?markDraftStatus[\s\S]*if\(submission&&!retained\)return/u);
  assert.match(start, /err\.status===401[\s\S]*onSessionEnded\(\);replaceRoute\("\/login",anonymousDraftContinuationState\(pending,localStorageRef\.current\)\)/u);
  assert.match(start, /projectRequestDispatched\?"This tab lost exclusive access while the save was in flight/u);
  const routeFocus = app.slice(app.indexOf("const settleRouteScroll="), app.indexOf("const Route=routes[path]"));
  assert.match(routeFocus, /else window\.scrollTo\(\{top:0,behavior:'auto'\}\)/u);
  assert.equal([...routeFocus.matchAll(/settleRouteScroll\(\)/gu)].length, 2);
});
