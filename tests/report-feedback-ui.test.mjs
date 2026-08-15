import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { __test } from "../worker/index.js";
import { reportFeedbackConcernState } from "../src/report-feedback-state.js";

const root = new URL("../", import.meta.url);

async function sources() {
  const [app, styles] = await Promise.all([
    readFile(new URL("src/App.jsx", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);
  const start = app.indexOf("function ReportFeedback(");
  const end = app.indexOf("function ReportPage(", start);
  assert.ok(start >= 0 && end > start, "ReportFeedback must remain a discrete report-footer component");
  return { app, styles, component: app.slice(start, end) };
}

test("report feedback binds reads and writes to one exact immutable report", async () => {
  const { app, component } = await sources();
  assert.match(
    component,
    /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/revisions\/\$\{projectRevision\}\/reports\/\$\{reportSchemaVersion\}\/feedback/u,
  );
  assert.match(component, /api\(endpoint,\{signal\}\)/u, "GET must load only the exact report feedback record");
  assert.match(component, /api\(endpoint,\{method:"PUT",body:\{outcome,sections\}\}\)/u, "PUT body stays exact and bounded");
  assert.match(
    app,
    /Number\.isInteger\(projectRevision\).*reportSchemaVersion===2.*<ReportFeedback/u,
    "ReportPage must mount feedback only for the exact supported report schema",
  );
  assert.match(
    app,
    /const envelope=normalizeReportEnvelope\(reportResult,id(?:,revision)?\);[\s\S]*?projectRevision:envelope\.projectRevision[\s\S]*?reportSchemaVersion:envelope\.reportSchemaVersion/u,
    "rendered facts and feedback identity must come from the report's atomic revision envelope",
  );
  assert.doesNotMatch(
    app.slice(app.indexOf("function ReportPage("), app.indexOf("function LegalPage(")),
    /Promise\.all\(\[[\s\S]*?\/revisions\/\$\{revision\}[\s\S]*?\/report/u,
    "historical report rendering must not race a separate revision-detail read",
  );
  assert.match(app, /readonly=\{archived\}/u, "archived reports must render feedback read-only");
  assert.match(component, /err\.status===409&&err\.payload\?\.code==="project_archived"[\s\S]*?setArchivedDuringSave\(true\)/u, "a concurrent archive must fail closed into read-only UI");
  assert.match(component, /const readOnly=readonly\|\|archivedDuringSave/u);
  assert.match(component, /onProjectArchived\?\.\(\)/u, "the parent report must receive the authoritative archive transition");
  assert.match(component, /archiveNoticeRef\.current\?\.focus\(\)/u, "focus must move to the archive notice after the save form disappears");
  assert.match(component, /ref=\{archiveNoticeRef\} tabIndex="-1"/u);
  assert.match(component, /setArchiveConflict\(\{attemptedOutcome:outcome,hadSavedFeedback:Boolean\(feedback\)\}\)/u);
  assert.match(component, /Your latest feedback \{archiveConflict\?\.hadSavedFeedback\?"change":"response"\} was not saved/u);
  assert.match(component, /archiveConflict\?"Previously recorded feedback":"Feedback recorded"/u);
  assert.match(component, /reportFeedbackConcernState\(feedback\?\.outcome,archiveConflict\?\.attemptedOutcome\)/u);
  assert.match(component, /concernState\.visible&&<ReportFeedbackConcern unsaved=\{concernState\.unsaved\}/u);
  assert.match(component, /normalizeReportFeedback\(result\.feedback,projectRevision,reportSchemaVersion\)/u);
  assert.doesNotMatch(component, /normalizeReportFeedback\([^)]*\)\|\|/u, "save success must never be fabricated from malformed feedback");
  assert.match(app, /value\.projectRevision===projectRevision[\s\S]*?value\.reportSchemaVersion===reportSchemaVersion/u);
});

test("archive-race concern copy distinguishes saved and rejected outcomes", () => {
  assert.deepEqual(reportFeedbackConcernState(null, null), { visible: false, unsaved: false });
  assert.deepEqual(reportFeedbackConcernState("helpful", "needs_review"), { visible: true, unsaved: true });
  assert.deepEqual(reportFeedbackConcernState(null, "needs_review"), { visible: true, unsaved: true });
  assert.deepEqual(reportFeedbackConcernState("needs_review", "needs_review"), { visible: true, unsaved: false });
  assert.deepEqual(reportFeedbackConcernState("needs_review", "helpful"), { visible: true, unsaved: false });
});

test("report feedback exposes only the approved structured vocabulary", async () => {
  const { app, component } = await sources();
  const outcomeBlock = app.slice(app.indexOf("const reportFeedbackOutcomes"), app.indexOf("const reportFeedbackSections"));
  const sectionBlock = app.slice(app.indexOf("const reportFeedbackSections"), app.indexOf("function normalizeReportFeedback"));
  assert.deepEqual(
    [...outcomeBlock.matchAll(/\["([a-z_]+)",/gu)].map((match) => match[1]),
    ["helpful", "unclear", "needs_review"],
  );
  assert.deepEqual(
    [...sectionBlock.matchAll(/\["([a-z_]+)",/gu)].map((match) => match[1]),
    ["overall", "brief_check", "programme", "cost_range", "assumptions", "next_actions"],
  );
  assert.match(component, /sections\.length>=3/u, "the control must enforce the three-section cap");
  assert.match(component, /section==="overall".*\["overall"\]/u, "overall must replace every section selection");
  assert.doesNotMatch(component, /<textarea\b/iu, "feedback must not collect free text");
  assert.match(component, /outcome==="needs_review"&&<ReportFeedbackConcern\/>/u);
  assert.match(app, /function ReportFeedbackConcern\(\{ unsaved=false \}\)[\s\S]*?The rejected response was not included in product learning and did not alert support\.[\s\S]*?This structured response improves aggregate product learning but does not alert support\./u, "saved and rejected concerns need truthful, distinct product-learning copy");
  assert.match(app, /without sending sensitive site details/u);
  assert.match(app, /\["programme", "Likely built-up & programme"\]/u);
  assert.match(app, /\["cost_range", "Planning range & cost allocation"\]/u);
});

test("feedback controls are keyboard-native, accessible, and excluded from print", async () => {
  const { component, styles } = await sources();
  assert.match(component, /<fieldset className="report-feedback__outcomes"/u);
  assert.match(component, /type="radio"/u);
  assert.match(component, /<fieldset className="report-feedback__sections"/u);
  assert.match(component, /aria-describedby=\{sectionGuidanceId\}/u);
  assert.match(component, /id=\{sectionGuidanceId\} aria-live="polite" aria-atomic="true"/u);
  assert.match(component, /3 of 3 parts selected\. Clear a selected part before choosing another\./u);
  assert.match(component, /type="checkbox"/u);
  assert.match(component, /role="status"/u);
  assert.match(component, /role="alert"/u);
  assert.match(component, /aria-live="polite"/u);
  assert.match(component, /never changes the saved report/u);
  assert.match(component, /not a request for, or a substitute for, professional review/u);
  assert.match(styles, /@media print\s*\{\s*\.report-feedback\s*\{\s*display: none !important;/u);
  assert.doesNotMatch(component, /report-feedback__print-note/u, "no feedback content may enter the printed report");
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.report-feedback__sections > div[\s\S]*?grid-template-columns: 1fr;/u);
  assert.match(styles, /\.report-feedback__actions small\s*\{[\s\S]*?color: var\(--muted\);[\s\S]*?font-size: 0\.74rem;/u);
  assert.match(styles, /\.report-feedback__concern[\s\S]*?border-left: 3px solid var\(--copper\)/u);
});

test("report feedback appears at the report decision boundary before downstream tools", async () => {
  const { app } = await sources();
  const report = app.slice(app.indexOf("function ReportPage("), app.indexOf("function LegalPage("));
  const feedback = report.indexOf("<ReportFeedback");
  const boundary = report.indexOf('className="report-boundary"');
  assert.ok(boundary >= 0, "the professional report boundary must exist");
  assert.ok(feedback > boundary);
  for (const downstream of ["report-compare-bridge", "<AiPlanningBrief", "<PurchasePanel", "<ProjectFiles"]) {
    assert.ok(feedback < report.indexOf(downstream), `feedback must precede ${downstream}`);
  }
});

test("report feedback metrics suppress small categorical cohorts and reject drift", () => {
  const row = {
    eligible_reports: 8,
    total_responses: 5,
    by_outcome_json: JSON.stringify([{ outcome: "helpful", count: 5 }]),
    by_section_json: JSON.stringify([{ section: "overall", count: 5 }]),
    by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 5 }]),
  };
  assert.deepEqual(__test.reportFeedbackMetricsFromRow(row), {
    eligibleReports: 8,
    totalResponses: 5,
    responseRate: 0.625,
    minimumCohortSize: 5,
    breakdownsSuppressed: false,
    byOutcome: [{ outcome: "helpful", count: 5 }],
    bySection: [{ section: "overall", count: 5 }],
    byOutcomeSection: [{ outcome: "helpful", section: "overall", count: 5 }],
  });
  assert.deepEqual(__test.reportFeedbackMetricsFromRow({ ...row, eligible_reports: 4, total_responses: 1 }), {
    eligibleReports: 4,
    totalResponses: 1,
    responseRate: 0.25,
    minimumCohortSize: 5,
    breakdownsSuppressed: true,
    byOutcome: [],
    bySection: [],
    byOutcomeSection: [],
  });
  assert.throws(
    () => __test.reportFeedbackMetricsFromRow({ ...row, eligible_reports: 4, total_responses: 5 }),
    /did not reconcile/iu,
  );
});

test("legacy report rendering never fabricates v2 facts or feedback", async () => {
  const { app } = await sources();
  assert.match(app, /const legacyArtifact=historical&&reportSchemaVersion<2;/u);
  assert.match(app, /const check=legacyArtifact\?null:briefCheckRecord/u, "legacy artifacts must not recompute Brief Check");
  assert.match(app, /!legacyArtifact&&<section className="report-hero"/u, "legacy artifacts must not borrow current input styling facts");
  assert.match(app, /legacyArtifact\?<>[\s\S]*?report\.summary\?\.verdict[\s\S]*?report\.risks[\s\S]*?report\.nextActions/u);
  assert.match(app, /reportSchemaVersion===2&&<ReportFeedback/u, "legacy schema v1 must never mount feedback");
});
