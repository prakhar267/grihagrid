import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../src/App.jsx", import.meta.url);

async function authSources() {
  const app = await readFile(appUrl, "utf8");
  const failureStart = app.indexOf("function authFailureMessage(");
  const pageStart = app.indexOf("function AuthPage(", failureStart);
  const pageEnd = app.indexOf("function accountSecurityFailure(", pageStart);
  assert.ok(failureStart >= 0 && pageStart > failureStart && pageEnd > pageStart, "auth must remain a discrete frontend flow");
  const failureSource = app.slice(failureStart, pageStart).trim();
  const failureMessage = Function(`"use strict"; return (${failureSource});`)();
  return { component: app.slice(pageStart, pageEnd), failureMessage };
}

test("login sends only email and password while registration adds the optional name", async () => {
  const { component } = await authSources();
  assert.match(
    component,
    /const authBody=isLogin\?\{email:form\.email,password:form\.password\}:\{name:form\.name,email:form\.email,password:form\.password\}/u,
  );
  assert.match(
    component,
    /api\(`\/api\/auth\/\$\{isLogin\?'login':'register'\}`\s*,\s*\{method:'POST',body:authBody\}\)/u,
  );
  assert.doesNotMatch(
    component,
    /body:form/u,
    "the shared form state includes name and must never be sent directly by login",
  );
  assert.match(
    component,
    /setForm\(\{name:"",email:"",password:""\}\)/u,
    "successful authentication must clear credentials from React state",
  );
});

test("authentication errors are mapped by safe code and never render raw server details", async () => {
  const { failureMessage } = await authSources();
  const cases = [
    [{ status: 401, payload: { code: "invalid_credentials" }, message: "attacker-controlled credential detail" }, true, /email|password/iu],
    [{ status: 400, payload: { code: "invalid_login" }, message: "raw login validator detail" }, true, /email|password/iu],
    [{ status: 429, payload: { code: "rate_limited" }, message: "raw KV key" }, true, /wait|try again/iu],
    [{ status: 503, payload: { code: "abuse_control_unavailable" }, message: "D1_ERROR login_attempt_fences" }, true, /temporarily unavailable/iu],
    [{ status: 400, payload: { code: "invalid_registration" }, message: "raw registration validator detail" }, false, /name|email|password/iu],
    [{ status: 400, payload: { code: "invalid_email" }, message: "raw email parser detail" }, false, /email/iu],
    [{ status: 400, payload: { code: "invalid_password" }, message: "raw password parser detail" }, false, /10|password/iu],
    [{ status: 409, payload: { code: "email_in_use" }, message: "raw uniqueness constraint" }, false, /account|email/iu],
  ];
  for (const [error, isLogin, expected] of cases) {
    const message = failureMessage(error, isLogin);
    assert.match(message, expected);
    assert.notEqual(message, error.message, `${error.payload.code} must not surface the server message verbatim`);
  }

  const rawDetail = "D1_ERROR: no such table users; owner@example.test";
  assert.equal(
    failureMessage({ status: 500, payload: { code: "unknown_failure" }, message: rawDetail }, true),
    "We could not sign you in. Try again.",
  );
  assert.equal(
    failureMessage({ status: 500, payload: null, message: rawDetail }, false),
    "We could not create the account. Try again.",
  );
});

test("auth pending and error states preserve accessible focus and input boundaries", async () => {
  const { component } = await authSources();
  assert.match(component, /<form onSubmit=\{submit\} aria-busy=\{busy\}>/u);
  assert.match(component, /useEffect\(\(\)=>\{if\(error\)errorRef\.current\?\.focus\(\{preventScroll:true\}\)\},\[error\]\)/u);
  assert.match(component, /ref=\{errorRef\} className="form-error" tabIndex="-1" role="alert"/u);
  assert.equal((component.match(/disabled=\{busy\}/gu) || []).length >= 5, true);
  assert.match(component, /type="email" maxLength="254"[^>]*autoCapitalize="none" spellCheck="false"/u);
  assert.match(component, /type="password" minLength="10" maxLength="128"[^>]*autoCapitalize="none" spellCheck="false"/u);
});
