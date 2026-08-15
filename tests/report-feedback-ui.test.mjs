import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { __test } from "../worker/index.js";
import { reportFeedbackConcernState, resolveArchivedReportFeedback } from "../src/report-feedback-state.js";

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
  assert.match(component, /const conflict=\{attemptedOutcome:outcome,hadSavedFeedback:Boolean\(feedback\)\}/u);
  assert.match(component, /setPhase\("archive_refreshing"\)[\s\S]*?readFeedback:\(\)=>api\(endpoint\)/u, "archive conflict must lock first, then GET the exact feedback endpoint");
  assert.match(component, /setFeedback\(authoritative\.feedback\)[\s\S]*?setPhase\("ready"\)/u, "only the authoritative refresh may restore a read-only summary");
  assert.match(component, /setPhase\("archive_refresh_error"\)/u, "a failed authoritative refresh must stay fail-closed");
  assert.match(component, /phase==="ready"&&readOnly&&<div className="report-feedback__readonly"/u, "cached feedback must never render during refresh or refresh failure");
  assert.match(component, /\(phase==="ready"\|\|phase==="saving"\)&&!readOnly&&<form/u, "ordinary saves must retain the disabled form and focus continuity");
  assert.match(component, /phase==="archive_refresh_error"[\s\S]*?Reload report/u);
  assert.match(component, /Your latest feedback \{archiveConflict\?\.hadSavedFeedback\?"change":"response"\} was not saved[\s\S]*?phase==="ready"\?\(feedback\?"The latest saved response is shown below\.":"No feedback response was recorded\."\)/u);
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

test("archive conflict replaces a concurrently stale cache with the authoritative saved response", async () => {
  const cachedFeedback = Object.freeze({
    outcome: "helpful",
    sections: Object.freeze(["overall"]),
    updatedAt: "2026-08-15T10:00:00.000Z",
  });
  const concurrentFeedback = Object.freeze({
    outcome: "needs_review",
    sections: Object.freeze(["assumptions"]),
    updatedAt: "2026-08-15T10:01:00.000Z",
  });
  let reads = 0;
  const resolved = await resolveArchivedReportFeedback({
    cachedFeedback,
    attemptedOutcome: "helpful",
    readFeedback: async () => {
      reads += 1;
      return { feedback: concurrentFeedback };
    },
    normalizeFeedback: (value) => ({ ...value, sections: [...value.sections] }),
  });

  assert.equal(reads, 1, "the archive conflict must perform one authoritative read");
  assert.notStrictEqual(resolved.feedback, cachedFeedback);
  assert.deepEqual(resolved.feedback, {
    outcome: "needs_review",
    sections: ["assumptions"],
    updatedAt: "2026-08-15T10:01:00.000Z",
  });
  assert.deepEqual(resolved.conflict, { attemptedOutcome: "helpful", hadSavedFeedback: true });
  assert.deepEqual(
    reportFeedbackConcernState(resolved.feedback.outcome, resolved.conflict.attemptedOutcome),
    { visible: true, unsaved: false },
    "the authoritative concurrent concern must drive read-only safety guidance",
  );
});

test("archive conflict preserves a rejected concern after the authoritative refresh", async () => {
  const authoritativeFeedback = Object.freeze({
    outcome: "helpful",
    sections: Object.freeze(["overall"]),
    updatedAt: "2026-08-15T10:01:00.000Z",
  });
  const resolved = await resolveArchivedReportFeedback({
    cachedFeedback: null,
    attemptedOutcome: "needs_review",
    readFeedback: async () => ({ feedback: authoritativeFeedback }),
    normalizeFeedback: (value) => ({ ...value, sections: [...value.sections] }),
  });

  assert.deepEqual(resolved.feedback, {
    outcome: "helpful",
    sections: ["overall"],
    updatedAt: "2026-08-15T10:01:00.000Z",
  });
  assert.deepEqual(resolved.conflict, { attemptedOutcome: "needs_review", hadSavedFeedback: false });
  assert.deepEqual(
    reportFeedbackConcernState(resolved.feedback.outcome, resolved.conflict.attemptedOutcome),
    { visible: true, unsaved: true },
    "the rejected concern must remain visible even when another session saved a different outcome",
  );
});

test("archive conflict refresh rejects instead of falling back to cached feedback", async () => {
  await assert.rejects(
    resolveArchivedReportFeedback({
      cachedFeedback: { outcome: "helpful", sections: ["overall"] },
      attemptedOutcome: "needs_review",
      readFeedback: async () => { throw new Error("authoritative read unavailable"); },
      normalizeFeedback: (value) => value,
    }),
    /authoritative read unavailable/u,
  );
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
  const smallCohort = {
    ...row,
    eligible_reports: 4,
    total_responses: 1,
    by_outcome_json: JSON.stringify([{ outcome: "helpful", count: 1 }]),
    by_section_json: JSON.stringify([{ section: "overall", count: 1 }]),
    by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 1 }]),
  };
  assert.deepEqual(__test.reportFeedbackMetricsFromRow(smallCohort), {
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

test("report feedback metrics use all-or-nothing small-cell protection", () => {
  const rareMatrixCell = {
    eligible_reports: 12,
    total_responses: 10,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 5 },
      { outcome: "unclear", count: 5 },
    ]),
    by_section_json: JSON.stringify([
      { section: "overall", count: 5 },
      { section: "brief_check", count: 5 },
    ]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "overall", count: 4 },
      { outcome: "helpful", section: "brief_check", count: 1 },
      { outcome: "unclear", section: "overall", count: 1 },
      { outcome: "unclear", section: "brief_check", count: 4 },
    ]),
  };
  assert.deepEqual(__test.reportFeedbackMetricsFromRow(rareMatrixCell), {
    eligibleReports: 12,
    totalResponses: 10,
    responseRate: 10 / 12,
    minimumCohortSize: 5,
    breakdownsSuppressed: true,
    byOutcome: [],
    bySection: [],
    byOutcomeSection: [],
  });

  const safeCells = {
    eligible_reports: 15,
    total_responses: 10,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 5 },
      { outcome: "unclear", count: 5 },
    ]),
    by_section_json: JSON.stringify([
      { section: "overall", count: 5 },
      { section: "brief_check", count: 5 },
      { section: "programme", count: 5 },
    ]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "overall", count: 5 },
      { outcome: "unclear", section: "brief_check", count: 5 },
      { outcome: "unclear", section: "programme", count: 5 },
    ]),
  };
  assert.deepEqual(__test.reportFeedbackMetricsFromRow(safeCells), {
    eligibleReports: 15,
    totalResponses: 10,
    responseRate: 2 / 3,
    minimumCohortSize: 5,
    breakdownsSuppressed: false,
    byOutcome: [
      { outcome: "helpful", count: 5 },
      { outcome: "unclear", count: 5 },
    ],
    bySection: [
      { section: "overall", count: 5 },
      { section: "brief_check", count: 5 },
      { section: "programme", count: 5 },
    ],
    byOutcomeSection: [
      { outcome: "helpful", section: "overall", count: 5 },
      { outcome: "unclear", section: "brief_check", count: 5 },
      { outcome: "unclear", section: "programme", count: 5 },
    ],
  });
});

test("report feedback metrics reject malformed vocabulary, counts, duplicates, and drift", () => {
  const valid = {
    eligible_reports: 8,
    total_responses: 5,
    by_outcome_json: JSON.stringify([{ outcome: "helpful", count: 5 }]),
    by_section_json: JSON.stringify([{ section: "overall", count: 5 }]),
    by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 5 }]),
  };
  const malformed = [
    [{ ...valid, by_outcome_json: JSON.stringify([{ outcome: "other", count: 5 }]) }, /invalid outcome/iu],
    [{ ...valid, by_section_json: JSON.stringify([{ section: "address", count: 5 }]) }, /invalid section/iu],
    [{ ...valid, by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "address", count: 5 }]) }, /invalid section/iu],
    [{ ...valid, by_outcome_json: JSON.stringify([{ outcome: "helpful", count: "5" }]) }, /nonnegative integer/iu],
    [{ ...valid, by_section_json: JSON.stringify([{ section: "overall", count: -1 }]) }, /nonnegative integer/iu],
    [{ ...valid, by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 1.5 }]) }, /nonnegative integer/iu],
    [{ ...valid, by_outcome_json: JSON.stringify([{ outcome: "helpful", count: 3 }, { outcome: "helpful", count: 2 }]) }, /duplicate outcome/iu],
    [{ ...valid, by_section_json: JSON.stringify([{ section: "overall", count: 3 }, { section: "overall", count: 2 }]) }, /duplicate section/iu],
    [{ ...valid, by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 3 }, { outcome: "helpful", section: "overall", count: 2 }]) }, /duplicate cell/iu],
    [{ ...valid, by_outcome_json: JSON.stringify([{ outcome: "helpful", count: 4 }]) }, /outcome totals did not reconcile/iu],
    [{ ...valid, by_section_json: JSON.stringify([{ section: "overall", count: 4 }]) }, /section totals did not reconcile/iu],
    [{ ...valid, by_outcome_section_json: JSON.stringify([{ outcome: "helpful", section: "overall", count: 4 }]) }, /section totals did not reconcile/iu],
  ];
  for (const [row, pattern] of malformed) {
    assert.throws(() => __test.reportFeedbackMetricsFromRow(row), pattern);
  }
});

test("report feedback metrics suppress every breakdown when any nonzero cell is too small", () => {
  const skewedOutcome = {
    eligible_reports: 10,
    total_responses: 10,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 9 },
      { outcome: "needs_review", count: 1 },
    ]),
    by_section_json: JSON.stringify([{ section: "overall", count: 10 }]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "overall", count: 9 },
      { outcome: "needs_review", section: "overall", count: 1 },
    ]),
  };
  assert.deepEqual(__test.reportFeedbackMetricsFromRow(skewedOutcome), {
    eligibleReports: 10,
    totalResponses: 10,
    responseRate: 1,
    minimumCohortSize: 5,
    breakdownsSuppressed: true,
    byOutcome: [],
    bySection: [],
    byOutcomeSection: [],
  });

  const sparseCrossTab = {
    eligible_reports: 10,
    total_responses: 10,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 5 },
      { outcome: "unclear", count: 5 },
    ]),
    by_section_json: JSON.stringify([
      { section: "assumptions", count: 5 },
      { section: "cost_range", count: 5 },
    ]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "assumptions", count: 4 },
      { outcome: "helpful", section: "cost_range", count: 1 },
      { outcome: "unclear", section: "assumptions", count: 1 },
      { outcome: "unclear", section: "cost_range", count: 4 },
    ]),
  };
  const suppressed = __test.reportFeedbackMetricsFromRow(sparseCrossTab);
  assert.equal(suppressed.breakdownsSuppressed, true);
  assert.deepEqual(suppressed.byOutcome, []);
  assert.deepEqual(suppressed.bySection, []);
  assert.deepEqual(suppressed.byOutcomeSection, []);
});

test("adjacent feedback windows cannot expose a one-response difference", () => {
  const widerWindow = {
    eligible_reports: 10,
    total_responses: 10,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 5 },
      { outcome: "unclear", count: 5 },
    ]),
    by_section_json: JSON.stringify([{ section: "overall", count: 10 }]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "overall", count: 5 },
      { outcome: "unclear", section: "overall", count: 5 },
    ]),
  };
  const adjacentWindow = {
    ...widerWindow,
    eligible_reports: 9,
    total_responses: 9,
    by_outcome_json: JSON.stringify([
      { outcome: "helpful", count: 4 },
      { outcome: "unclear", count: 5 },
    ]),
    by_section_json: JSON.stringify([{ section: "overall", count: 9 }]),
    by_outcome_section_json: JSON.stringify([
      { outcome: "helpful", section: "overall", count: 4 },
      { outcome: "unclear", section: "overall", count: 5 },
    ]),
  };

  assert.equal(__test.reportFeedbackMetricsFromRow(widerWindow).breakdownsSuppressed, false);
  const adjacent = __test.reportFeedbackMetricsFromRow(adjacentWindow);
  assert.equal(adjacent.breakdownsSuppressed, true);
  assert.deepEqual(adjacent.byOutcome, []);
  assert.deepEqual(adjacent.bySection, []);
  assert.deepEqual(adjacent.byOutcomeSection, []);
});

test("legacy report rendering never fabricates v2 facts or feedback", async () => {
  const { app } = await sources();
  assert.match(app, /const legacyArtifact=historical&&reportSchemaVersion<2;/u);
  assert.match(app, /const check=legacyArtifact\?null:briefCheckRecord/u, "legacy artifacts must not recompute Brief Check");
  assert.match(app, /!legacyArtifact&&<section className="report-hero"/u, "legacy artifacts must not borrow current input styling facts");
  assert.match(app, /legacyArtifact\?<>[\s\S]*?report\.summary\?\.verdict[\s\S]*?report\.risks[\s\S]*?report\.nextActions/u);
  assert.match(app, /reportSchemaVersion===2&&<ReportFeedback/u, "legacy schema v1 must never mount feedback");
});
