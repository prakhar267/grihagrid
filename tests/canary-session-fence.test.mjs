import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { inspect } from "node:util";
import test from "node:test";
import {
  accumulateCanarySessionCleanupEvidence,
  buildCanarySessionCleanupSql,
  buildCanarySessionSnapshotSql,
  normalizeCanaryEmail,
  parseCanarySessionSnapshot,
  validateCanaryEnvironment,
  verifyCanarySessionCleanupEvidence,
  verifyRetryableLateCanarySessionArrival,
} from "../scripts/canary-session-fence.mjs";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const BASELINE_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_NEW_SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CANARY_EMAIL = "canary@example.com";

function snapshot(userId = USER_A, sessionIds = []) {
  return [{
    success: true,
    results: [
      { record_type: "user", id: userId },
      ...sessionIds.map((id) => ({ record_type: "session", id })),
    ],
  }];
}

function cleanup(sessionIds = []) {
  return [{
    success: true,
    results: sessionIds.map((id) => ({ id })),
  }];
}

test("validates the environment and normalizes a bounded canary email", () => {
  assert.equal(validateCanaryEnvironment("staging"), "staging");
  assert.equal(validateCanaryEnvironment("production"), "production");
  assert.throws(() => validateCanaryEnvironment("preview"), /invalid canary environment/u);
  assert.equal(normalizeCanaryEmail("  Canary+Release@Example.COM "), "canary+release@example.com");
  assert.throws(() => normalizeCanaryEmail("not-an-email"), /canary email is invalid/u);
  assert.throws(() => normalizeCanaryEmail(`x@${"a".repeat(251)}.com`), /length is invalid/u);
  assert.throws(() => normalizeCanaryEmail("canary\u0000@example.com"), /invalid characters/u);
});

test("builds one active-user snapshot query with an escaped normalized email", () => {
  const sql = buildCanarySessionSnapshotSql({
    environment: "staging",
    email: " Canary.O'Neil@Example.COM ",
  });
  assert.match(sql, /WITH canary_user AS/u);
  assert.match(sql, /email = 'canary\.o''neil@example\.com'/u);
  assert.match(sql, /deleted_at IS NULL/u);
  assert.match(sql, /JOIN canary_user ON canary_user\.id = sessions\.user_id/u);
  assert.match(sql, /SELECT 'user' AS record_type/u);
  assert.match(sql, /SELECT 'session' AS record_type/u);
});

test("parses a single successful Wrangler batch and canonicalizes session order", () => {
  const parsed = parseCanarySessionSnapshot(snapshot(USER_A, [NEW_SESSION, BASELINE_SESSION]));
  assert.equal(parsed.userId, USER_A);
  assert.deepEqual(parsed.sessionIds, [BASELINE_SESSION, NEW_SESSION]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.sessionIds));
});

test("fails closed on malformed Wrangler result batches and row shapes", () => {
  assert.throws(() => parseCanarySessionSnapshot({}), /must contain D1 result batches/u);
  assert.throws(() => parseCanarySessionSnapshot([]), /exactly one D1 result batch/u);
  assert.throws(
    () => parseCanarySessionSnapshot([...snapshot(), ...snapshot()]),
    /exactly one D1 result batch/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot([{ success: false, results: [] }]),
    /failed D1 batch/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot([{ success: true }]),
    /D1 results are missing/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot([{ success: true, results: [{ record_type: "user", id: USER_A, email: CANARY_EMAIL }] }]),
    /row shape is invalid/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot([{ success: true, results: [{ record_type: "token", id: USER_A }] }]),
    /unexpected record type/u,
  );
});

test("rejects snapshots with zero or multiple active users", () => {
  assert.throws(
    () => parseCanarySessionSnapshot([{ success: true, results: [] }]),
    /exactly one active canary user/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot([{
      success: true,
      results: [
        { record_type: "user", id: USER_A },
        { record_type: "user", id: USER_B },
      ],
    }]),
    /exactly one active canary user/u,
  );
});

test("rejects malformed and duplicate user or session identifiers", () => {
  assert.throws(() => parseCanarySessionSnapshot(snapshot("user-a")), /canonical UUID/u);
  assert.throws(
    () => parseCanarySessionSnapshot(snapshot(USER_A, ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])),
    /canonical UUID/u,
  );
  assert.throws(
    () => parseCanarySessionSnapshot(snapshot(USER_A, [BASELINE_SESSION, BASELINE_SESSION])),
    /duplicate session identifiers/u,
  );
});

test("cleanup SQL deletes only the observed new-session delta within the exact account scope", () => {
  const sql = buildCanarySessionCleanupSql({
    environment: "production",
    email: CANARY_EMAIL,
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [OTHER_NEW_SESSION, BASELINE_SESSION, NEW_SESSION]),
  });
  assert.match(sql, /DELETE FROM sessions/u);
  assert.match(sql, new RegExp(NEW_SESSION, "u"));
  assert.match(sql, new RegExp(OTHER_NEW_SESSION, "u"));
  assert.doesNotMatch(sql, new RegExp(BASELINE_SESSION, "u"));
  assert.match(sql, new RegExp(`user_id = '${USER_A}'`, "u"));
  assert.match(sql, new RegExp(`users\\.id = '${USER_A}'`, "u"));
  assert.match(sql, /users\.email = 'canary@example\.com'/u);
  assert.match(sql, /users\.deleted_at IS NULL/u);
  assert.match(sql, /RETURNING id;/u);
});

test("cleanup SQL becomes a scoped no-op when no new session exists", () => {
  const sql = buildCanarySessionCleanupSql({
    environment: "staging",
    email: CANARY_EMAIL,
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION]),
  });
  assert.match(sql, /WHERE 0 = 1/u);
  assert.match(sql, new RegExp(`user_id = '${USER_A}'`, "u"));
  assert.doesNotMatch(sql, new RegExp(BASELINE_SESSION, "u"));
});

test("cleanup SQL refuses a changed canary user", () => {
  assert.throws(() => buildCanarySessionCleanupSql({
    environment: "staging",
    email: CANARY_EMAIL,
    beforePayload: snapshot(USER_A, []),
    observedPayload: snapshot(USER_B, [NEW_SESSION]),
  }), /canary user changed/u);
});

test("proof accepts an exact cleanup and returns identifier-free count evidence", () => {
  const evidence = verifyCanarySessionCleanupEvidence({
    environment: "staging",
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
    cleanupPayload: cleanup([NEW_SESSION]),
    finalPayload: snapshot(USER_A, [BASELINE_SESSION]),
  });
  assert.deepEqual(Object.keys(evidence).sort(), [
    "baselineSessions",
    "checkedAt",
    "environment",
    "finalSessions",
    "newSessions",
    "observedSessions",
    "removedSessions",
    "restoredExactly",
  ].sort());
  assert.equal(evidence.baselineSessions, 1);
  assert.equal(evidence.observedSessions, 2);
  assert.equal(evidence.newSessions, 1);
  assert.equal(evidence.removedSessions, 1);
  assert.equal(evidence.finalSessions, 1);
  assert.equal(evidence.restoredExactly, true);
  const serialized = JSON.stringify(evidence);
  for (const secret of [CANARY_EMAIL, USER_A, BASELINE_SESSION, NEW_SESSION]) {
    assert.ok(!serialized.includes(secret), "public proof must not contain an email or UUID");
  }
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/u);
});

test("proof rejects under-deletion, over-deletion, and duplicate cleanup rows", () => {
  const common = {
    environment: "production",
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
    finalPayload: snapshot(USER_A, [BASELINE_SESSION]),
  };
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({ ...common, cleanupPayload: cleanup([]) }),
    /exact new-session delta/u,
  );
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({ ...common, cleanupPayload: cleanup([NEW_SESSION, OTHER_NEW_SESSION]) }),
    /exact new-session delta/u,
  );
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({ ...common, cleanupPayload: cleanup([NEW_SESSION, NEW_SESSION]) }),
    /duplicate identifiers/u,
  );
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({ ...common, cleanupPayload: cleanup(["not-a-uuid"]) }),
    /canonical UUID/u,
  );
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({
      ...common,
      cleanupPayload: [{ success: false, results: [] }],
    }),
    /failed D1 batch/u,
  );
});

test("proof rejects final baseline mismatches and final user replacement", () => {
  const common = {
    environment: "production",
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
    cleanupPayload: cleanup([NEW_SESSION]),
  };
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({
      ...common,
      finalPayload: snapshot(USER_A, []),
    }),
    /restore the exact baseline/u,
  );
  assert.throws(
    () => verifyCanarySessionCleanupEvidence({
      ...common,
      finalPayload: snapshot(USER_B, [BASELINE_SESSION]),
    }),
    /canary user changed after/u,
  );
});

test("failure inspection never exposes canary email, user IDs, or session IDs", () => {
  const unsafeEmail = "private-canary-address";
  const failures = [
    () => normalizeCanaryEmail(unsafeEmail),
    () => parseCanarySessionSnapshot(snapshot(USER_A, ["private-session-identifier"])),
    () => buildCanarySessionCleanupSql({
      environment: "staging",
      email: CANARY_EMAIL,
      beforePayload: snapshot(USER_A, []),
      observedPayload: snapshot(USER_B, [NEW_SESSION]),
    }),
    () => verifyCanarySessionCleanupEvidence({
      environment: "production",
      beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
      observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
      cleanupPayload: cleanup([]),
      finalPayload: snapshot(USER_A, [BASELINE_SESSION]),
    }),
  ];

  for (const fail of failures) {
    let error;
    try { fail(); } catch (caught) { error = caught; }
    assert.ok(error instanceof Error);
    const rendered = inspect(error, { depth: 8 });
    for (const privateValue of [unsafeEmail, CANARY_EMAIL, USER_A, USER_B, BASELINE_SESSION, NEW_SESSION]) {
      assert.ok(!rendered.includes(privateValue), "canary session failure output must remain identifier-free");
    }
  }
});

test("stabilization evidence catches a session that arrives after the first exact cleanup", () => {
  const first = accumulateCanarySessionCleanupEvidence({
    currentEvidence: verifyCanarySessionCleanupEvidence({
      environment: "staging",
      beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
      observedPayload: snapshot(USER_A, [BASELINE_SESSION]),
      cleanupPayload: cleanup([]),
      finalPayload: snapshot(USER_A, [BASELINE_SESSION]),
    }),
    reconciliationPass: 1,
    stabilizedForMs: 0,
  });
  const second = accumulateCanarySessionCleanupEvidence({
    currentEvidence: verifyCanarySessionCleanupEvidence({
      environment: "staging",
      beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
      observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
      cleanupPayload: cleanup([NEW_SESSION]),
      finalPayload: snapshot(USER_A, [BASELINE_SESSION]),
    }),
    previousEvidence: first,
    reconciliationPass: 2,
    stabilizedForMs: 40_000,
  });

  assert.equal(second.reconciliationPasses, 2);
  assert.equal(second.stabilizedForMs, 40_000);
  assert.equal(second.totalNewSessions, 1);
  assert.equal(second.totalRemovedSessions, 1);
  assert.equal(second.restoredExactly, true);
  const serialized = JSON.stringify(second);
  for (const privateValue of [CANARY_EMAIL, USER_A, BASELINE_SESSION, NEW_SESSION]) {
    assert.ok(!serialized.includes(privateValue));
  }
});

test("a session first seen after cleanup is retryable without masking unsafe drift", () => {
  assert.deepEqual(verifyRetryableLateCanarySessionArrival({
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION]),
    cleanupPayload: cleanup([]),
    finalPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
  }), { retryableLateArrival: true, lateSessions: 1 });
  assert.throws(() => verifyRetryableLateCanarySessionArrival({
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION]),
    cleanupPayload: cleanup([]),
    finalPayload: snapshot(USER_A, [NEW_SESSION]),
  }), /lost a baseline session/u);
  assert.throws(() => verifyRetryableLateCanarySessionArrival({
    beforePayload: snapshot(USER_A, [BASELINE_SESSION]),
    observedPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
    cleanupPayload: cleanup([]),
    finalPayload: snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]),
  }), /exact new-session delta/u);
});

test("stabilization evidence rejects skipped passes, changed baselines, and backwards time", () => {
  const current = verifyCanarySessionCleanupEvidence({
    environment: "production",
    beforePayload: snapshot(USER_A, []),
    observedPayload: snapshot(USER_A, []),
    cleanupPayload: cleanup([]),
    finalPayload: snapshot(USER_A, []),
  });
  const first = accumulateCanarySessionCleanupEvidence({
    currentEvidence: current,
    reconciliationPass: 1,
    stabilizedForMs: 5_000,
  });
  assert.throws(() => accumulateCanarySessionCleanupEvidence({
    currentEvidence: current,
    previousEvidence: first,
    reconciliationPass: 3,
    stabilizedForMs: 10_000,
  }), /pass sequence is invalid/u);
  assert.throws(() => accumulateCanarySessionCleanupEvidence({
    currentEvidence: current,
    previousEvidence: first,
    reconciliationPass: 2,
    stabilizedForMs: 4_000,
  }), /moved backwards/u);
  assert.throws(() => accumulateCanarySessionCleanupEvidence({
    currentEvidence: { ...current, baselineSessions: 1, finalSessions: 1 },
    previousEvidence: first,
    reconciliationPass: 2,
    stabilizedForMs: 10_000,
  }), /baseline count changed/u);
});

test("CLI writes private SQL files and produces proof without an email environment variable", () => {
  const directory = mkdtempSync(join(tmpdir(), "grihagrid-canary-session-fence-"));
  const script = new URL("../scripts/canary-session-fence.mjs", import.meta.url).pathname;
  const beforeFile = join(directory, "before.json");
  const observedFile = join(directory, "observed.json");
  const cleanupFile = join(directory, "cleanup.json");
  const finalFile = join(directory, "final.json");
  const querySqlFile = join(directory, "query.sql");
  const cleanupSqlFile = join(directory, "cleanup.sql");
  const proofFile = join(directory, "proof.json");
  const withoutEmail = { ...process.env };
  delete withoutEmail.GRIHAGRID_CANARY_EMAIL;

  try {
    writeFileSync(beforeFile, JSON.stringify(snapshot(USER_A, [BASELINE_SESSION])));
    writeFileSync(observedFile, JSON.stringify(snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION])));
    writeFileSync(cleanupFile, JSON.stringify(cleanup([NEW_SESSION])));
    writeFileSync(finalFile, JSON.stringify(snapshot(USER_A, [BASELINE_SESSION])));

    const query = spawnSync(process.execPath, [script, "query-sql", "staging", querySqlFile], {
      encoding: "utf8",
      env: { ...withoutEmail, GRIHAGRID_CANARY_EMAIL: CANARY_EMAIL },
    });
    assert.equal(query.status, 0, query.stderr);
    assert.equal(statSync(querySqlFile).mode & 0o777, 0o600);
    assert.match(readFileSync(querySqlFile, "utf8"), /canary@example\.com/u);

    const validated = spawnSync(
      process.execPath,
      [script, "validate-snapshot", "staging", beforeFile],
      { encoding: "utf8", env: withoutEmail },
    );
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(validated.stdout, "");

    const cleanupRun = spawnSync(
      process.execPath,
      [script, "cleanup-sql", "staging", beforeFile, observedFile, cleanupSqlFile],
      { encoding: "utf8", env: { ...withoutEmail, GRIHAGRID_CANARY_EMAIL: CANARY_EMAIL } },
    );
    assert.equal(cleanupRun.status, 0, cleanupRun.stderr);
    assert.equal(statSync(cleanupSqlFile).mode & 0o777, 0o600);
    assert.match(readFileSync(cleanupSqlFile, "utf8"), new RegExp(NEW_SESSION, "u"));

    const proof = spawnSync(
      process.execPath,
      [script, "proof", "staging", beforeFile, observedFile, cleanupFile, finalFile, proofFile],
      { encoding: "utf8", env: withoutEmail },
    );
    assert.equal(proof.status, 0, proof.stderr);
    const publicProof = readFileSync(proofFile, "utf8");
    assert.match(publicProof, /"restoredExactly": true/u);
    assert.ok(!publicProof.includes(CANARY_EMAIL));
    assert.ok(!publicProof.includes(USER_A));
    assert.ok(!publicProof.includes(NEW_SESSION));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI JSON failures use static identifier-free stderr", () => {
  const directory = mkdtempSync(join(tmpdir(), "grihagrid-canary-session-error-"));
  const script = new URL("../scripts/canary-session-fence.mjs", import.meta.url).pathname;
  const beforeFile = join(directory, "before.json");
  const observedFile = join(directory, "observed.json");
  const outputFile = join(directory, "cleanup.sql");
  const malformed = `{\"private\":\"${USER_A}\"`;
  try {
    writeFileSync(beforeFile, malformed);
    writeFileSync(observedFile, JSON.stringify(snapshot(USER_A)));
    const result = spawnSync(
      process.execPath,
      [script, "cleanup-sql", "staging", beforeFile, observedFile, outputFile],
      { encoding: "utf8", env: { ...process.env, GRIHAGRID_CANARY_EMAIL: CANARY_EMAIL } },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canary session evidence JSON is unreadable/u);
    assert.ok(!result.stderr.includes(USER_A));
    assert.ok(!result.stderr.includes(CANARY_EMAIL));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI rejects an unsafe pre-login snapshot without printing its identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "grihagrid-canary-session-baseline-"));
  const script = new URL("../scripts/canary-session-fence.mjs", import.meta.url).pathname;
  const snapshotFile = join(directory, "snapshot.json");
  try {
    writeFileSync(snapshotFile, JSON.stringify(snapshot(USER_A, ["private-session-identifier"])));
    const result = spawnSync(
      process.execPath,
      [script, "validate-snapshot", "production", snapshotFile],
      { encoding: "utf8", env: process.env },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /session identifier must be a canonical UUID/u);
    assert.ok(!result.stderr.includes(USER_A));
    assert.ok(!result.stderr.includes("private-session-identifier"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shell wrapper snapshots, validates, reconciles, and emits only bounded proof", () => {
  const directory = mkdtempSync(join(tmpdir(), "grihagrid-canary-session-wrapper-"));
  const bin = join(directory, "bin");
  const fakeWrangler = join(bin, "wrangler");
  const stateFile = join(directory, "wrangler-count");
  const proofFile = join(directory, "proof.json");
  const wrapper = new URL("../scripts/run-canary-session-fence.sh", import.meta.url).pathname;
  const repository = new URL("../", import.meta.url).pathname;
  try {
    mkdirSync(bin);
    writeFileSync(fakeWrangler, `#!/usr/bin/env bash
set -euo pipefail
count=0
if [ -f "$FAKE_WRANGLER_STATE" ]; then count="$(< "$FAKE_WRANGLER_STATE")"; fi
count=$((count + 1))
printf '%s' "$count" > "$FAKE_WRANGLER_STATE"
case "$count" in
  1) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION]))}' ;;
  2) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]))}' ;;
  3) printf '%s\n' '${JSON.stringify(cleanup([NEW_SESSION]))}' ;;
  4) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION]))}' ;;
  *) exit 64 ;;
esac
`);
    chmodSync(fakeWrangler, 0o700);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: directory,
      FAKE_WRANGLER_STATE: stateFile,
      CLOUDFLARE_API_TOKEN: "cloudflare-token-not-for-output",
      CLOUDFLARE_ACCOUNT_ID: "cloudflare-account-not-for-output",
      GRIHAGRID_CANARY_EMAIL: CANARY_EMAIL,
      GRIHAGRID_CANARY_PASSWORD: "canary-password-not-for-output",
    };
    const captured = spawnSync("bash", [wrapper, "snapshot", "staging", "candidate"], {
      cwd: repository,
      encoding: "utf8",
      env,
    });
    assert.equal(captured.status, 0, captured.stderr);
    assert.equal(captured.stdout, "");
    const restored = spawnSync("bash", [wrapper, "restore", "staging", "candidate", proofFile, "completed"], {
      cwd: repository,
      encoding: "utf8",
      env,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(restored.stdout, "");
    assert.equal(readFileSync(stateFile, "utf8"), "4");
    const proof = JSON.parse(readFileSync(proofFile, "utf8"));
    assert.equal(proof.reconciliationPasses, 1);
    assert.equal(proof.totalNewSessions, 1);
    assert.equal(proof.totalRemovedSessions, 1);
    assert.equal(proof.restoredExactly, true);
    const serialized = JSON.stringify(proof);
    for (const privateValue of [CANARY_EMAIL, USER_A, BASELINE_SESSION, NEW_SESSION, env.GRIHAGRID_CANARY_PASSWORD]) {
      assert.ok(!serialized.includes(privateValue));
      assert.ok(!restored.stderr.includes(privateValue));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shell wrapper retries and removes a session that first appears in the final snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "grihagrid-canary-session-late-final-"));
  const bin = join(directory, "bin");
  const fakeWrangler = join(bin, "wrangler");
  const stateFile = join(directory, "wrangler-count");
  const proofFile = join(directory, "proof.json");
  const wrapper = new URL("../scripts/run-canary-session-fence.sh", import.meta.url).pathname;
  const repository = new URL("../", import.meta.url).pathname;
  try {
    mkdirSync(bin);
    writeFileSync(fakeWrangler, `#!/usr/bin/env bash
set -euo pipefail
count=0
if [ -f "$FAKE_WRANGLER_STATE" ]; then count="$(< "$FAKE_WRANGLER_STATE")"; fi
count=$((count + 1))
printf '%s' "$count" > "$FAKE_WRANGLER_STATE"
case "$count" in
  1|2) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION]))}' ;;
  3) printf '%s\n' '${JSON.stringify(cleanup([]))}' ;;
  4|5) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION, NEW_SESSION]))}' ;;
  6) printf '%s\n' '${JSON.stringify(cleanup([NEW_SESSION]))}' ;;
  7) printf '%s\n' '${JSON.stringify(snapshot(USER_A, [BASELINE_SESSION]))}' ;;
  *) exit 64 ;;
esac
`);
    chmodSync(fakeWrangler, 0o700);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: directory,
      FAKE_WRANGLER_STATE: stateFile,
      CLOUDFLARE_API_TOKEN: "cloudflare-token-not-for-output",
      CLOUDFLARE_ACCOUNT_ID: "cloudflare-account-not-for-output",
      GRIHAGRID_CANARY_EMAIL: CANARY_EMAIL,
      GRIHAGRID_CANARY_PASSWORD: "canary-password-not-for-output",
    };
    const captured = spawnSync("bash", [wrapper, "snapshot", "production", "rollback"], {
      cwd: repository,
      encoding: "utf8",
      env,
    });
    assert.equal(captured.status, 0, captured.stderr);
    const restored = spawnSync("bash", [wrapper, "restore", "production", "rollback", proofFile, "completed"], {
      cwd: repository,
      encoding: "utf8",
      env,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(restored.stdout, "");
    assert.equal(readFileSync(stateFile, "utf8"), "7");
    const proof = JSON.parse(readFileSync(proofFile, "utf8"));
    assert.equal(proof.reconciliationPasses, 1);
    assert.equal(proof.totalNewSessions, 1);
    assert.equal(proof.totalRemovedSessions, 1);
    assert.equal(proof.restoredExactly, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
