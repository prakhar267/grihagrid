import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const reportLogic = await readFile(new URL("../src/architect-report.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("private, sample, and selected public programme views render the architect review pack", () => {
  assert.match(app, /function ArchitecturalHandoffSections\(\{ architecture \}\)/u);
  assert.match(app, /normalizeArchitecturalHandoff\(report\.architecturalHandoff\)\|\|buildArchitecturalHandoff\(input,estimate\)/u);
  assert.match(app, /legacyArtifact\?null:normalizeArchitecturalHandoff/u);
  assert.match(app, /<ArchitecturalHandoffSections architecture=\{sampleArchitecture\}\/>/u);
  assert.match(app, /programme\.architecture&&<ArchitecturalHandoffSections architecture=\{programme\.architecture\}\/>/u);
});

test("architect review pack exposes all professional review registers and clear boundaries", () => {
  for (const copy of [
    "Site working diagram · not to scale",
    "Area control",
    "Room data sheet",
    "Floor zoning",
    "Planning logic",
    "Site and climate response",
    "Structure and services",
    "Verification register",
    "Professional issue register",
    "Reference register",
  ]) assert.equal(app.includes(copy), true, copy);
  assert.equal(reportLogic.includes("not a measured, sanction, tender, structural or construction drawing set"), true);
  assert.equal(app.includes("dangerouslySetInnerHTML"), false);
});

test("architect pack has mobile, reduced-motion, horizontal-table, and A4 print treatment", () => {
  assert.match(styles, /\.architect-pack__table-wrap\s*\{[^}]*overflow-x:\s*auto;/su);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.architect-pack__fact-grid/u);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.architect-pack__fact-grid/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /@page\s*\{\s*size:\s*A4;/u);
  assert.match(styles, /\.architect-pack__table thead\s*\{\s*display:\s*table-header-group;/u);
  assert.match(styles, /\.architect-pack__table tfoot\s*\{\s*display:\s*table-row-group;/u);
  assert.match(styles, /\.architect-pack__table tr\s*\{\s*break-inside:\s*avoid;/u);
  for (const selector of [".purchase-panel", ".professional-review-panel", ".report-upload-warning", ".sample-architect-pack__action"]) {
    assert.match(styles, new RegExp(`${selector.replace(".", "\\.")},?`), selector);
  }
});

test("site diagram follows bounded entered proportions without lateral road overflow", () => {
  assert.match(app, /Math\.min\(1\.65,Math\.max\(0\.65,enteredRatio\)\)/u);
  assert.match(app, /aspectRatio:String\(diagramRatio\)/u);
  assert.doesNotMatch(styles, /right:\s*-5\.6rem|left:\s*-5\.6rem/u);
  assert.match(styles, /\.architect-site-diagram--east \.architect-site-diagram__road \{ right: 0; \}/u);
});
