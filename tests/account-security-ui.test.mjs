import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function accountSecuritySources() {
  const [app, styles] = await Promise.all([
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);
  const start = app.indexOf("function accountSecurityFailure(");
  const end = app.indexOf("function Dashboard(", start);
  assert.ok(start >= 0 && end > start, "account security must remain a discrete frontend flow");
  return { app, styles, component: app.slice(start, end) };
}

test("account security is a titled private route linked from both workspace account surfaces", async () => {
  const { app } = await accountSecuritySources();
  assert.match(app, /security\(\?:\\\/\|\$\)/u, "security must participate in private-session revalidation");
  assert.match(app, /'\/security':'Account security — GrihaGrid'/u);
  assert.match(app, /if\(path==='\/security'\)return <AccountSecurityPage/u);
  assert.equal((app.match(/<WorkspaceAccount user=/gu) || []).length, 2, "Dashboard and Orders remain the two workspace account surfaces");
  const workspaceAccount = app.slice(app.indexOf("function WorkspaceAccount("), app.indexOf("function Footer("));
  assert.match(workspaceAccount, /aria-label="Account security"[\s\S]*?route\('\/security'\)/u);
});

test("password change submits only the exact reviewed API contract and keeps the replacement session", async () => {
  const { component } = await accountSecuritySources();
  const passwordFlow = component.slice(component.indexOf("async function changePassword"), component.indexOf("if(user==null"));
  assert.match(
    passwordFlow,
    /api\('\/api\/auth\/password',\{method:'PUT',signal:controller\.signal,body:\{currentPassword:form\.currentPassword,newPassword:form\.newPassword\}\}\)/u,
  );
  assert.doesNotMatch(passwordFlow, /method:'POST'/u);
  assert.doesNotMatch(passwordFlow, /body:\{[^}]*confirmPassword/u, "confirmation is a browser-only check and must not enter the request");
  assert.match(passwordFlow, /onAuthenticated\(result\.user\);[\s\S]*?setPhase\("success"\)/u);
  assert.match(passwordFlow, /setForm\(\{currentPassword:"",newPassword:"",confirmPassword:""\}\)/u, "successful submission must clear all secrets from React state");
});

test("session and reuse copy matches cookie behavior without overstating password history", async () => {
  const { component } = await accountSecuritySources();
  assert.match(component, /This browser remains signed in with a fresh session\./u);
  assert.match(component, /Other tabs in the same browser profile share the replacement cookie and may remain signed in\./u);
  assert.match(component, /Every genuinely older or copied session[^.]*other browsers and devices, has been revoked\./u);
  assert.match(component, /different from your current password/u);
  assert.doesNotMatch(component, /password you have not used/u);
  assert.doesNotMatch(component, /Other tabs will be signed out/u);
});

test("session review is bounded, identifier-free, and never calls sign-in times device activity", async () => {
  const { component } = await accountSecuritySources();
  assert.match(component, /api\('\/api\/auth\/sessions',\{signal:controller\.signal\}\)/u);
  assert.match(component, /payload\.sessions\.length>21/u);
  assert.match(component, /keys\.join\(","\)!=="current,expiresAt,startedAt"/u);
  assert.match(component, /GrihaGrid shows valid sign-in times, not devices or locations/u);
  assert.match(component, /A repeated login or copied browser cookie can look like the same session/u);
  assert.match(component, /The session inventory shows sign-in and expiry times, never device, location, IP, or browser labels/u);
  assert.match(component, /No other active session is visible/u);
  assert.doesNotMatch(component, /without collecting/u);
  assert.match(component, /Only the newest 20 are shown/u);
  assert.doesNotMatch(component, /last active/iu);
  assert.doesNotMatch(component, /userAgent|ipAddress|sessionId|session\.id/u);
});

test("revoke-others submits only the current password and preserves honest recovery states", async () => {
  const { component } = await accountSecuritySources();
  const failureMapping = component.slice(
    component.indexOf("function sessionRevocationFailure"),
    component.indexOf("function sessionReviewLoadFailure"),
  );
  assert.match(
    component,
    /api\('\/api\/auth\/sessions\/revoke-others',\{method:'POST',signal:controller\.signal,body:\{currentPassword\}\}\)/u,
  );
  assert.doesNotMatch(component, /body:\{currentPassword,[^}]+\}/u);
  assert.match(component, /Sign out other sessions/u);
  assert.match(component, /Anyone who still knows your password can sign in again/u);
  assert.match(component, /Other sessions may already be closed/u);
  assert.match(component, /No sign-out has been claimed/u);
  assert.match(component, /nextReview\.sessions\.length!==1\|\|nextReview\.hasMore/u);
  assert.match(component, /setCurrentPassword\(""\);setExpanded\(false\);setActionPhase\("success"\)/u);
  assert.match(
    failureMapping,
    /code==="auth_state_changed"\)return \{ambiguous:true,/u,
    "a concurrent boundary may already have revoked sessions and must stay unconfirmed",
  );
  assert.match(
    failureMapping,
    /error instanceof ApiError&&error\.status===408&&error\.payload==null\)return ambiguous/u,
    "a local timeout may follow a committed revocation and must stay unconfirmed",
  );
  assert.match(component, /if\(failure\.ambiguous\)setCurrentPassword\(""\)/u);
  assert.match(
    component,
    /useEffect\(\(\)=>\{\s*actionRef\.current\?\.abort\(\);actionRef\.current=null;onBusyChange\(false\);\s*setExpanded\(false\);setCurrentPassword\(""\);setActionPhase\("idle"\);setActionFailure\(null\);\s*\},\[refreshKey\]\)/u,
    "a password rotation must abort and clear the now-stale revoke step-up state",
  );
});

test("password fields, errors, pending state, and success state preserve accessible focus", async () => {
  const { component } = await accountSecuritySources();
  assert.match(component, /Current password<input ref=\{currentRef\} required type="password" maxLength="128" autoComplete="current-password"/u);
  assert.equal((component.match(/autoComplete="new-password"/gu) || []).length, 2);
  assert.equal((component.match(/maxLength="128"/gu) || []).length, 4);
  assert.match(component, /form\.newPassword!==form\.confirmPassword/u);
  assert.match(component, /target\.current\?\.focus\(\{preventScroll:true\}\)/u);
  assert.match(component, /successRef\.current\?\.focus\(\{preventScroll:true\}\)/u);
  assert.match(component, /tabIndex="-1" role="alert"/u);
  assert.match(component, /tabIndex="-1" role="status" aria-live="polite" aria-atomic="true"/u);
  assert.match(component, /aria-busy=\{pending\}/u);
  assert.match(component, /Updating your password and revoking older sessions/u);
  assert.match(component, /We could not confirm whether the password changed/u, "lost responses must not be presented as confirmed failure or success");
  assert.match(
    component,
    /error instanceof ApiError&&error\.status===408&&error\.payload==null\)return ambiguous/u,
    "a local timeout may follow a committed rotation and must stay unconfirmed",
  );
});

test("account security adapts at zoom and mobile sizes and excludes secrets from print", async () => {
  const { styles } = await accountSecuritySources();
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.security-layout\s*\{[\s\S]*?grid-template-columns: 1fr;/u);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.security-panel\s*\{[\s\S]*?align-items: stretch;/u);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.security-session-summary\s*\{[\s\S]*?grid-template-columns: 1fr;/u);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.security-session-step-up > div\s*\{[\s\S]*?flex-direction: column-reverse;/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /@media print\s*\{[\s\S]*?\.security-session-review,[\s\S]*?\.security-panel > form,[\s\S]*?display: none !important;/u);
  assert.match(styles, /\.security-print-note\s*\{[\s\S]*?display: block;/u);
  assert.match(styles, /\.security-intro,\s*\.security-panel\s*\{[\s\S]*?min-width: 0;/u);
});
