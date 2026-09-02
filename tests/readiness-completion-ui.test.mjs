import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function sources() {
  const [app, api, styles, vite] = await Promise.all([
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("src/api.js", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
    readFile(new URL("vite.config.mjs", root), "utf8"),
  ]);
  return { app, api, styles, vite };
}

test("account lifecycle actions use fragment-only tokens, generic recovery, private export, and explicit deletion", async () => {
  const { app } = await sources();
  assert.match(app, /function lifecycleTokenFromFragment\(\)/u);
  assert.ok(app.includes('const match=/^#token=([A-Za-z0-9_-]{43})$/u.exec(window.location.hash)'));
  assert.ok(app.includes('window.history.replaceState(window.history.state,"",window.location.pathname)'));
  assert.match(app, /api\('\/api\/auth\/password-reset\/request',\{method:'POST',body:\{email:form\.email\}\}\)/u);
  assert.match(app, /The response is the same whether or not an account exists/u);
  assert.match(app, /api\('\/api\/account\/export'\)/u);
  assert.match(app, /confirmation!=="DELETE"/u);
  assert.match(app, /api\('\/api\/account',\{method:'DELETE',body:\{currentPassword:deletion\.password,confirmation:deletion\.confirmation\}\}\)/u);
  assert.match(app, /'\/forgot-password':'Recover account — GrihaGrid'/u);
  assert.match(app, /'\/verify-email':'Verify email — GrihaGrid'/u);
});

test("private uploads send one bounded image body and never use browser multipart buffering", async () => {
  const { app, api } = await sources();
  const projectFiles = app.slice(app.indexOf("function ProjectFiles("), app.indexOf("function AiPlanningBrief("));
  assert.match(projectFiles, /\['image\/jpeg','image\/png','image\/webp'\]\.includes\(file\.type\)/u);
  assert.match(projectFiles, /file\.size<=10\*1024\*1024/u);
  assert.match(projectFiles, /slice\(0,Math\.max\(0,20-files\.length\)\)/u);
  assert.match(projectFiles, /'x-file-name':encodeURIComponent\(file\.name\)/u);
  assert.match(projectFiles, /body:file/u);
  assert.doesNotMatch(projectFiles, /FormData/u);
  assert.doesNotMatch(projectFiles, /application\/pdf/u);
  assert.match(api, /!\(body instanceof Blob\)/u);
});

test("professional review UI exposes traced owner and verified-reviewer journeys without approval claims", async () => {
  const { app, styles } = await sources();
  assert.match(app, /function ProfessionalReviewPanel\(/u);
  assert.match(app, /function ProfessionalReviewWorkbench\(/u);
  assert.match(app, /api\('\/api\/professional-reviews'\)/u);
  assert.match(app, /\/professional-reviews\/\$\{encodeURIComponent\(review\.id\)\}\/claim/u);
  assert.match(app, /needs_owner_input/u);
  assert.match(app, /It is not municipal approval, structural certification, or permission to build/u);
  assert.match(app, /Never treat this workflow as approval, structural design, sanction/u);
  assert.match(app, /'\/review-workbench':'Professional review workbench — GrihaGrid'/u);
  assert.match(app, /review-workbench\(\?:\\\/\|\$\)/u);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.review-workbench__layout,[\s\S]*?grid-template-columns: 1fr/u);
  assert.match(styles, /@media print[\s\S]*?\.professional-review-panel__record > form,[\s\S]*?display: none !important/u);
});

test("the production bundle is split into application, React, icons, and residual vendor chunks", async () => {
  const { vite } = await sources();
  assert.match(vite, /manualChunks\(id\)/u);
  assert.match(vite, /return "icons"/u);
  assert.match(vite, /return "react"/u);
  assert.match(vite, /return "vendor"/u);
});
