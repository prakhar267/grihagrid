import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decryptBackup, encryptBackup } from "../scripts/backup-crypto.mjs";

const TEST_PASSPHRASE = "test-only high entropy backup passphrase 2026";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "grihagrid-backup-crypto-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function setTestPassphrase(t, value = TEST_PASSPHRASE) {
  const original = process.env.D1_BACKUP_PASSPHRASE;
  process.env.D1_BACKUP_PASSPHRASE = value;
  t.after(() => {
    if (original === undefined) delete process.env.D1_BACKUP_PASSPHRASE;
    else process.env.D1_BACKUP_PASSPHRASE = original;
  });
}

function permissionBits(mode) {
  return mode & 0o777;
}

test("backup encryption streams an authenticated, randomized envelope and round-trips at mode 0600", async (t) => {
  setTestPassphrase(t);
  const directory = await temporaryDirectory(t);
  const plaintext = Buffer.concat([
    Buffer.from("-- D1 export containing synthetic confidential rows\n", "utf8"),
    Buffer.alloc(2 * 1024 * 1024, 0x61),
  ]);
  const source = join(directory, "backup.sql");
  const encryptedOne = join(directory, "backup-one.sql.ggrid");
  const encryptedTwo = join(directory, "backup-two.sql.ggrid");
  const restored = join(directory, "restored.sql");
  await writeFile(source, plaintext, { mode: 0o644 });

  await encryptBackup(source, encryptedOne);
  await encryptBackup(source, encryptedTwo);
  await decryptBackup(encryptedOne, restored);

  const firstEnvelope = await readFile(encryptedOne);
  const secondEnvelope = await readFile(encryptedTwo);
  assert.equal(firstEnvelope.subarray(0, 8).toString("ascii"), "GGRIDBK1");
  assert.notDeepEqual(firstEnvelope, secondEnvelope, "fresh salt and IV must randomize every envelope");
  assert.equal(firstEnvelope.includes(plaintext.subarray(0, 48)), false);
  assert.deepEqual(await readFile(restored), plaintext);
  assert.equal(permissionBits((await stat(source)).mode), 0o600);
  assert.equal(permissionBits((await stat(encryptedOne)).mode), 0o600);
  assert.equal(permissionBits((await stat(restored)).mode), 0o600);
});

test("decryption rejects the wrong passphrase and tampering without leaving plaintext", async (t) => {
  setTestPassphrase(t);
  const directory = await temporaryDirectory(t);
  const source = join(directory, "backup.sql");
  const encrypted = join(directory, "backup.sql.ggrid");
  const wrongPassphraseOutput = join(directory, "wrong.sql");
  const tampered = join(directory, "tampered.sql.ggrid");
  const tamperedOutput = join(directory, "tampered.sql");
  await writeFile(source, "CREATE TABLE private_data (value TEXT);\n", { mode: 0o600 });
  await encryptBackup(source, encrypted);

  process.env.D1_BACKUP_PASSPHRASE = "different test-only passphrase value 2026";
  await assert.rejects(() => decryptBackup(encrypted, wrongPassphraseOutput), /authenticate|authentication/u);
  await assert.rejects(() => stat(wrongPassphraseOutput), { code: "ENOENT" });

  process.env.D1_BACKUP_PASSPHRASE = TEST_PASSPHRASE;
  const damagedEnvelope = await readFile(encrypted);
  damagedEnvelope[40] ^= 0xff;
  await writeFile(tampered, damagedEnvelope, { mode: 0o600 });
  await assert.rejects(() => decryptBackup(tampered, tamperedOutput), /authenticate|authentication/u);
  await assert.rejects(() => stat(tamperedOutput), { code: "ENOENT" });
});

test("CLI takes its passphrase only from the environment and does not echo secrets or plaintext", async (t) => {
  const directory = await temporaryDirectory(t);
  const source = join(directory, "backup.sql");
  const encrypted = join(directory, "backup.sql.ggrid");
  const restored = join(directory, "restored.sql");
  const plaintext = "synthetic-secret-row-that-must-not-appear-in-logs";
  await writeFile(source, plaintext, { mode: 0o600 });
  const script = new URL("../scripts/backup-crypto.mjs", import.meta.url);
  const environment = { ...process.env, D1_BACKUP_PASSPHRASE: TEST_PASSPHRASE };

  const encryption = spawnSync(process.execPath, [script.pathname, "encrypt", source, encrypted], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(encryption.status, 0, encryption.stderr);
  assert.doesNotMatch(`${encryption.stdout}${encryption.stderr}`, new RegExp(TEST_PASSPHRASE, "u"));
  assert.doesNotMatch(`${encryption.stdout}${encryption.stderr}`, new RegExp(plaintext, "u"));

  const decryption = spawnSync(process.execPath, [script.pathname, "decrypt", encrypted, restored], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(decryption.status, 0, decryption.stderr);
  assert.equal(await readFile(restored, "utf8"), plaintext);
  assert.doesNotMatch(`${decryption.stdout}${decryption.stderr}`, new RegExp(TEST_PASSPHRASE, "u"));
  assert.doesNotMatch(`${decryption.stdout}${decryption.stderr}`, new RegExp(plaintext, "u"));

  const missingSecret = spawnSync(process.execPath, [script.pathname, "encrypt", source, join(directory, "missing.ggrid")], {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "D1_BACKUP_PASSPHRASE")),
  });
  assert.notEqual(missingSecret.status, 0);
  assert.match(missingSecret.stderr, /D1_BACKUP_PASSPHRASE must be set/u);
});
