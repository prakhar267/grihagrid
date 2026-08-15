#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const MAGIC = Buffer.from("GGRIDBK1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const MINIMUM_PASSPHRASE_BYTES = 20;
const OUTPUT_MODE = 0o600;
const SCRYPT_OPTIONS = Object.freeze({
  N: 2 ** 15,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
});
const deriveKey = promisify(scrypt);

function passphraseBuffer() {
  const passphrase = process.env.D1_BACKUP_PASSPHRASE;
  if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") < MINIMUM_PASSPHRASE_BYTES) {
    throw new Error(
      `D1_BACKUP_PASSPHRASE must be set and contain at least ${MINIMUM_PASSPHRASE_BYTES} UTF-8 bytes`,
    );
  }
  return Buffer.from(passphrase, "utf8");
}

async function keyFromEnvironment(salt) {
  const passphrase = passphraseBuffer();
  try {
    return await deriveKey(passphrase, salt, KEY_BYTES, SCRYPT_OPTIONS);
  } finally {
    passphrase.fill(0);
  }
}

async function closeQuietly(fileHandle) {
  if (!fileHandle) return;
  try {
    await fileHandle.close();
  } catch {
    // Preserve the primary operation error.
  }
}

async function removePartialOutput(fileHandle, outputPath) {
  await closeQuietly(fileHandle);
  try {
    await rm(outputPath, { force: true });
  } catch (error) {
    throw new Error("backup operation failed and partial output cleanup also failed", { cause: error });
  }
}

function assertRegularFile(stat, label) {
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
}

function encryptedPayload(header, cipher) {
  let headerWritten = false;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!headerWritten) {
        this.push(header);
        headerWritten = true;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!headerWritten) this.push(header);
      this.push(cipher.getAuthTag());
      callback();
    },
  });
}

export async function encryptBackup(inputPath, outputPath) {
  let input;
  let output;
  let outputCreated = false;
  let key;

  try {
    input = await open(inputPath, "r");
    assertRegularFile(await input.stat(), "backup input");
    await input.chmod(OUTPUT_MODE);

    output = await open(outputPath, "wx", OUTPUT_MODE);
    outputCreated = true;
    await output.chmod(OUTPUT_MODE);

    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const header = Buffer.concat([MAGIC, salt, iv]);
    key = await keyFromEnvironment(salt);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(header);

    await pipeline(
      input.createReadStream({ autoClose: true }),
      cipher,
      encryptedPayload(header, cipher),
      output.createWriteStream({ autoClose: true }),
    );
  } catch (error) {
    if (outputCreated) await removePartialOutput(output, outputPath);
    output = undefined;
    throw error;
  } finally {
    if (key) key.fill(0);
    await closeQuietly(input);
    await closeQuietly(output);
  }
}

async function readExactly(fileHandle, buffer, position, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await fileHandle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error(`encrypted backup has a truncated ${label}`);
    offset += bytesRead;
  }
}

export async function decryptBackup(inputPath, outputPath) {
  let input;
  let output;
  let outputCreated = false;
  let key;

  try {
    input = await open(inputPath, "r");
    const inputStat = await input.stat();
    assertRegularFile(inputStat, "encrypted backup input");
    if (inputStat.size < HEADER_BYTES + AUTH_TAG_BYTES) {
      throw new Error("encrypted backup is truncated");
    }

    const header = Buffer.alloc(HEADER_BYTES);
    await readExactly(input, header, 0, "header");
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("encrypted backup format is not supported");
    }

    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES);
    const authTag = Buffer.alloc(AUTH_TAG_BYTES);
    await readExactly(input, authTag, inputStat.size - AUTH_TAG_BYTES, "authentication tag");

    output = await open(outputPath, "wx", OUTPUT_MODE);
    outputCreated = true;
    await output.chmod(OUTPUT_MODE);

    key = await keyFromEnvironment(salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(header);
    decipher.setAuthTag(authTag);

    const ciphertextBytes = inputStat.size - HEADER_BYTES - AUTH_TAG_BYTES;
    const ciphertext = ciphertextBytes === 0
      ? Readable.from([])
      : input.createReadStream({
          autoClose: true,
          start: HEADER_BYTES,
          end: inputStat.size - AUTH_TAG_BYTES - 1,
        });
    await pipeline(ciphertext, decipher, output.createWriteStream({ autoClose: true }));
  } catch (error) {
    if (outputCreated) await removePartialOutput(output, outputPath);
    output = undefined;
    throw error;
  } finally {
    if (key) key.fill(0);
    await closeQuietly(input);
    await closeQuietly(output);
  }
}

function usage() {
  return "Usage: node scripts/backup-crypto.mjs <encrypt|decrypt> <input-file> <output-file>";
}

async function main() {
  const [operation, inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!operation || !inputPath || !outputPath || extra.length > 0 || !["encrypt", "decrypt"].includes(operation)) {
    throw new Error(usage());
  }
  if (operation === "encrypt") await encryptBackup(inputPath, outputPath);
  else await decryptBackup(inputPath, outputPath);
  process.stdout.write(`Backup ${operation === "encrypt" ? "encryption" : "decryption"} completed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Backup crypto operation failed"}\n`);
    process.exitCode = 1;
  }
}
