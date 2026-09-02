import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("mobile navigation keeps account actions reachable and restores menu focus", () => {
  const header = app.slice(app.indexOf("function Header("), app.indexOf("function Hero("));
  assert.match(header, /const menuButtonRef = useRef\(null\)/u);
  assert.match(header, /menuButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(header, /<div className="main-nav-mobile-actions">/u);
  assert.match(header, /\{user \? "My projects" : "Log in"\}/u);
  assert.match(header, /Plan my home/u);
  assert.match(styles, /\.main-nav-mobile-actions \{\s*display: none;/u);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.main-nav-mobile-actions \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.main-nav-mobile-actions \{\s*grid-template-columns: 1fr;/u);
});

test("hero image, estimator range, and route focus remain stable across viewport sizes", () => {
  assert.match(styles, /\.monograph-visual > img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/u);
  assert.match(styles, /\.instrument-output \{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\)/u);
  assert.match(styles, /\.instrument-output strong \{[\s\S]*?white-space: nowrap;/u);
  assert.match(styles, /main h1\[tabindex="-1"\]:focus \{\s*outline: none;/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /@media print/u);
});

test("authentication capability copy never promises unavailable email delivery", () => {
  const auth = app.slice(app.indexOf("function AuthPage("), app.indexOf("function accountSecurityFailure("));
  const recovery = app.slice(app.indexOf("function PasswordRecoveryPage("), app.indexOf("function EmailVerificationPage("));
  assert.match(app, /function useReadinessCapability\(capability\)/u);
  assert.match(auth, /useReadinessCapability\("passwordRecovery"\)/u);
  assert.match(auth, /Sign-in sends only your email and password/u);
  assert.match(auth, /Account creation sends only your name, email and password/u);
  assert.match(auth, /passwordRecovery\.phase==="ready"&&passwordRecovery\.enabled/u);
  assert.match(auth, /Email recovery is not available in this release/u);
  assert.match(recovery, /const requestUnavailable=!confirming&&passwordRecovery\.phase!=="loading"&&!passwordRecovery\.enabled/u);
  assert.match(recovery, /This release cannot deliver recovery links\. No request was sent/u);
  assert.match(recovery, /Checking email delivery/u);
  assert.match(styles, /\.auth-capability-note,[\s\S]*?\.auth-capability-loading/u);
});

test("an unsaved Decision Compare cannot record an owner choice", () => {
  const decision = app.slice(app.indexOf("function DecisionDocument("), app.indexOf("function PurchasePanel("));
  assert.match(decision, /choiceAvailable = true/u);
  assert.match(decision, /disabled=\{!choiceAvailable\|\|choosing\|\|selectionLocked\|\|selectedId===scenario\.id\}/u);
  assert.match(decision, /aria-describedby=\{!choiceAvailable\?'decision-preview-note':undefined\}/u);
  assert.match(decision, /id="decision-preview-note"/u);
  assert.match(decision, /choiceAvailable=\{hasSavedComparison\}/u);
});
