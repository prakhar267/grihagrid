import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const MAX_JSON_BYTES = 64 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

function joinBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function paddedJsonBytes(limit, character = "x") {
  const prefix = encoder.encode('{"padding":"');
  const suffix = encoder.encode('"}');
  const encodedCharacter = encoder.encode(character);
  const remaining = limit - prefix.byteLength - suffix.byteLength;
  assert.ok(remaining >= 0 && remaining % encodedCharacter.byteLength === 0);
  return joinBytes(prefix, encoder.encode(character.repeat(remaining / encodedCharacter.byteLength)), suffix);
}

function jsonBytesAtLength(value, length) {
  const jsonBytes = encoder.encode(JSON.stringify(value));
  assert.ok(jsonBytes.byteLength <= length);
  return joinBytes(jsonBytes, encoder.encode(" ".repeat(length - jsonBytes.byteLength)));
}

function readerRequest(chunks, {
  contentLength = null,
  contentType = "application/json",
  readErrorAt = null,
  cancelRejects = false,
} = {}) {
  const headers = new Headers();
  if (contentType != null) headers.set("content-type", contentType);
  if (contentLength != null) headers.set("content-length", contentLength);
  const state = {
    bodyCancels: 0,
    getReaders: 0,
    readCalls: 0,
    readerCancels: 0,
    releases: 0,
  };
  let index = 0;
  const reader = {
    async read() {
      state.readCalls += 1;
      if (readErrorAt === state.readCalls) throw new Error("private reader failure");
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    async cancel() {
      state.readerCancels += 1;
      if (cancelRejects) throw new Error("private cancellation failure");
    },
    releaseLock() {
      state.releases += 1;
    },
  };
  const body = {
    async cancel() {
      state.bodyCancels += 1;
      if (cancelRejects) throw new Error("private cancellation failure");
    },
    getReader() {
      state.getReaders += 1;
      return reader;
    },
  };
  return {
    request: {
      headers,
      body,
      get bodyUsed() {
        return state.getReaders > 0 || state.bodyCancels > 0;
      },
    },
    state,
  };
}

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.status, status);
    assert.equal(error?.code, code);
    return true;
  });
}

test("declared request lengths accept canonical bounds and reject ambiguous values", () => {
  const request = (value) => ({
    headers: { get: (name) => (name === "content-length" ? value : null) },
  });
  assert.equal(__test.declaredBodyLength(request(null), MAX_JSON_BYTES), null);
  assert.equal(__test.declaredBodyLength(request("0"), MAX_JSON_BYTES), 0);
  assert.equal(__test.declaredBodyLength(request("00001"), MAX_JSON_BYTES), 1);
  assert.equal(__test.declaredBodyLength(request("\t 00001 \t"), MAX_JSON_BYTES), 1);
  assert.equal(__test.declaredBodyLength(request(String(MAX_JSON_BYTES)), MAX_JSON_BYTES), MAX_JSON_BYTES);

  for (const value of ["", " ", "-1", "+1", "1.0", "1e3", "0x10", "NaN", "Infinity", "2, 2", "12x", "\u00a01"]) {
    assert.throws(
      () => __test.declaredBodyLength(request(value), MAX_JSON_BYTES),
      (error) => error?.status === 400 && error?.code === "invalid_content_length",
      value,
    );
  }
  for (const value of [String(MAX_JSON_BYTES + 1), `0${MAX_JSON_BYTES + 1}`, "9".repeat(1_000)]) {
    assert.throws(
      () => __test.declaredBodyLength(request(value), MAX_JSON_BYTES),
      (error) => error?.status === 413 && error?.code === "payload_too_large",
      value.slice(0, 32),
    );
  }
});

test("length preflight cancels without acquiring a reader", async () => {
  for (const [contentLength, status, code] of [
    ["not-a-length", 400, "invalid_content_length"],
    [String(MAX_JSON_BYTES + 1), 413, "payload_too_large"],
  ]) {
    const { request, state } = readerRequest([encoder.encode("{}")], { contentLength });
    await rejectsWith(__test.readBoundedBody(request, MAX_JSON_BYTES), status, code);
    assert.equal(state.bodyCancels, 1);
    assert.equal(state.getReaders, 0);
    assert.equal(state.readCalls, 0);
  }
});

test("generic JSON accepts an exact 64 KiB chunked object and split UTF-8", async () => {
  const exact = paddedJsonBytes(MAX_JSON_BYTES);
  const exactSplit = [exact.subarray(0, 1), exact.subarray(1, 32_769), exact.subarray(32_769)];
  const exactRequest = readerRequest(exactSplit);
  const parsed = await __test.readJson(exactRequest.request);
  assert.equal(parsed.padding.length, MAX_JSON_BYTES - encoder.encode('{"padding":""}').byteLength);
  assert.equal(exactRequest.state.readerCancels, 0);
  assert.equal(exactRequest.state.releases, 1);

  const multibyte = encoder.encode('{"value":"घर🏠"}');
  const emojiStart = multibyte.indexOf(0xf0);
  assert.ok(emojiStart > 0);
  const multibyteRequest = readerRequest([
    multibyte.subarray(0, emojiStart + 1),
    multibyte.subarray(emojiStart + 1, emojiStart + 3),
    multibyte.subarray(emojiStart + 3),
  ]);
  assert.deepEqual(await __test.readJson(multibyteRequest.request), { value: "घर🏠" });
  assert.equal(multibyteRequest.state.releases, 1);

  const understated = readerRequest([encoder.encode("{}")], { contentLength: "1" });
  assert.deepEqual(await __test.readJson(understated.request), {});
  assert.equal(understated.state.releases, 1, "application code must not enforce transport length equality");
});

test("actual streamed bytes override absent or understated lengths and cancel at byte 65,537", async () => {
  const exact = paddedJsonBytes(MAX_JSON_BYTES);
  for (const contentLength of [null, "2"]) {
    const tail = encoder.encode("tail-must-not-be-read");
    const { request, state } = readerRequest([exact, encoder.encode(" "), tail], {
      contentLength,
      cancelRejects: contentLength === "2",
    });
    await rejectsWith(__test.readJson(request), 413, "payload_too_large");
    assert.equal(state.readCalls, 2);
    assert.equal(state.readerCancels, 1);
    assert.equal(state.releases, 1);
  }

  const oneChunk = readerRequest([joinBytes(exact, encoder.encode(" "))]);
  await rejectsWith(__test.readJson(oneChunk.request), 413, "payload_too_large");
  assert.equal(oneChunk.state.readerCancels, 1);
  assert.equal(oneChunk.state.releases, 1);

  const encodedOversize = readerRequest([
    encoder.encode(`{"padding":"${"é".repeat(33_000)}"}`),
  ]);
  await rejectsWith(__test.readJson(encodedOversize.request), 413, "payload_too_large");
});

test("invalid UTF-8, reader failures, non-byte chunks, empty bodies, and reused bodies stay bounded", async () => {
  const invalidUtf8 = readerRequest([
    joinBytes(encoder.encode('{"value":"'), new Uint8Array([0xc3]), encoder.encode('"}')),
  ]);
  await rejectsWith(__test.readJson(invalidUtf8.request), 400, "invalid_json");
  assert.equal(invalidUtf8.state.releases, 1);

  for (const options of [{ readErrorAt: 1 }, {}]) {
    const chunk = options.readErrorAt ? encoder.encode("{}") : "not bytes";
    const { request, state } = readerRequest([chunk], options);
    await rejectsWith(__test.readJson(request), 400, "invalid_json");
    assert.equal(state.readerCancels, 1);
    assert.equal(state.releases, 1);
  }

  await rejectsWith(__test.readJson({ headers: new Headers({ "content-type": "application/json" }), body: null }), 400, "invalid_json");
  for (const scalar of ["null", "[]", "true", "1", '"value"']) {
    await rejectsWith(__test.readJson(readerRequest([encoder.encode(scalar)]).request), 400, "invalid_json");
  }

  const consumed = new Request(`${ORIGIN}/api/estimate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await consumed.text();
  await rejectsWith(__test.readJson(consumed), 400, "invalid_json");
});

test("wrong JSON media cancels before reading and public bearer adapters remain indistinguishable", async () => {
  const wrongMedia = readerRequest([encoder.encode("{}")], { contentType: "text/plain" });
  await rejectsWith(__test.readJson(wrongMedia.request), 415, "unsupported_media_type");
  assert.equal(wrongMedia.state.bodyCancels, 1);
  assert.equal(wrongMedia.state.getReaders, 0);

  const family = readerRequest([encoder.encode(`{"token":"${"f".repeat(43)}"}`)], {
    contentLength: "1, 1",
  });
  await rejectsWith(__test.readPublicFamilyAlignmentRequest(family.request), 404, "family_alignment_not_found");
  assert.equal(family.state.bodyCancels, 1);
  assert.equal(family.state.getReaders, 0);

  const report = readerRequest([encoder.encode(`{"token":"${"s".repeat(43)}"}`)], {
    readErrorAt: 1,
  });
  await rejectsWith(__test.readPublicReportShareToken(report.request), 404, "report_share_not_found");
  assert.equal(report.state.readerCancels, 1);
  assert.equal(report.state.releases, 1);
});

test("raw webhook reads preserve exact bounded bytes and map transport failures", async () => {
  const exact = new Uint8Array(MAX_WEBHOOK_BYTES);
  exact[0] = 0x7b;
  exact[exact.length - 1] = 0x7d;
  const accepted = readerRequest([exact.subarray(0, 97), exact.subarray(97)] , { contentType: null });
  assert.deepEqual(await __test.readBoundedWebhookBody(accepted.request), exact);
  assert.equal(accepted.state.releases, 1);

  const overflow = readerRequest([exact, new Uint8Array([0])], { contentType: null });
  await rejectsWith(__test.readBoundedWebhookBody(overflow.request), 413, "payload_too_large");
  assert.equal(overflow.state.readerCancels, 1);
  assert.equal(overflow.state.releases, 1);

  const malformed = readerRequest([encoder.encode("{}")], { contentLength: "2, 2", contentType: null });
  await rejectsWith(__test.readBoundedWebhookBody(malformed.request), 400, "invalid_webhook");
  assert.equal(malformed.state.bodyCancels, 1);
});

test("generic admission rejects oversized login and lead bodies before PBKDF2 or D1", async () => {
  const originalDeriveBits = Object.getPrototypeOf(crypto.subtle).deriveBits;
  let derivations = 0;
  Object.getPrototypeOf(crypto.subtle).deriveBits = async function instrumentedDeriveBits(...args) {
    derivations += 1;
    return originalDeriveBits.apply(this, args);
  };
  try {
    const oversized = jsonBytesAtLength({
      email: "bounded-login@example.test",
      password: "valid-password-for-boundary",
    }, MAX_JSON_BYTES + 1);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(oversized.subarray(0, MAX_JSON_BYTES));
        controller.enqueue(oversized.subarray(MAX_JSON_BYTES));
        controller.close();
      },
    });
    let databaseReads = 0;
    let kvReads = 0;
    let kvWrites = 0;
    const response = await worker.fetch(new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "192.0.2.20" },
      body: stream,
      duplex: "half",
    }), {
      ASSETS: assets,
      APP_ORIGIN: ORIGIN,
      GRIHAGRID_CACHE: {
        async get() { kvReads += 1; return null; },
        async put() { kvWrites += 1; },
      },
      DB: { prepare() { databaseReads += 1; throw new Error("D1 must not be reached"); } },
    }, {});
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "payload_too_large");
    assert.equal(derivations, 0);
    assert.equal(databaseReads, 0);
    assert.deepEqual([kvReads, kvWrites], [1, 1], "the intentional IP perimeter runs before body parsing");

    const leadResponse = await worker.fetch(new Request(`${ORIGIN}/api/leads`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "content-length": String(MAX_JSON_BYTES + 1) },
      body: JSON.stringify({ email: "bounded-lead@example.test", source: "website" }),
    }), {
      ASSETS: assets,
      APP_ORIGIN: ORIGIN,
      DB: { prepare() { databaseReads += 1; throw new Error("D1 must not be reached"); } },
    }, {});
    assert.equal(leadResponse.status, 413);
    assert.equal((await leadResponse.json()).code, "payload_too_large");
    assert.equal(databaseReads, 0);
  } finally {
    Object.getPrototypeOf(crypto.subtle).deriveBits = originalDeriveBits;
  }
});

test("authenticated JSON rejection permits only the required session read and no AI work", async () => {
  const sessionToken = "session-token-for-bounded-body-test";
  const csrfToken = "csrf-token-for-bounded-body-test";
  const sqlStatements = [];
  const DB = {
    prepare(sql) {
      sqlStatements.push(sql.replace(/\s+/gu, " ").trim());
      return {
        bind() {
          return {
            async first() {
              if (!sql.includes("FROM sessions s")) throw new Error("domain D1 must not be reached");
              return {
                session_id: "session-id",
                user_id: "user-id",
                csrf_hash: await __test.digestBase64(csrfToken),
                expires_at: "2099-01-01 00:00:00",
                auth_generation: 1,
                auth_revision_id: null,
                email: "bounded-body@example.test",
                name: "Bounded body",
                user_created_at: "2026-08-21 00:00:00",
              };
            },
          };
        },
      };
    },
  };
  let cancelled = false;
  const oversized = jsonBytesAtLength({ acceptedAiTerms: true }, MAX_JSON_BYTES + 1);
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(oversized.subarray(0, MAX_JSON_BYTES));
      controller.enqueue(oversized.subarray(MAX_JSON_BYTES));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await worker.fetch(new Request(`${ORIGIN}/api/projects/project-id/ai-brief`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: `__Host-grihagrid_session=${sessionToken}; grihagrid_csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
    },
    body: stream,
    duplex: "half",
  }), { ASSETS: assets, APP_ORIGIN: ORIGIN, DB }, {});
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "payload_too_large");
  assert.equal(cancelled, true);
  assert.equal(sqlStatements.length, 1, "only the authenticated session lookup may precede body admission");
  assert.match(sqlStatements[0], /FROM sessions s JOIN users u/u);
  assert.equal(sqlStatements.some((sql) => /ai_generation|ai_planning_briefs|project_revision_reports/u.test(sql)), false);
});

test("webhook overflow skips HMAC and D1 while signed invalid UTF-8 is rejected before D1", async () => {
  const subtlePrototype = Object.getPrototypeOf(crypto.subtle);
  const originalSign = subtlePrototype.sign;
  let signatures = 0;
  subtlePrototype.sign = async function instrumentedSign(...args) {
    signatures += 1;
    return originalSign.apply(this, args);
  };
  const webhookSecret = "bounded-webhook-test-secret";
  let databaseReads = 0;
  const env = {
    ASSETS: assets,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    DB: { prepare() { databaseReads += 1; throw new Error("D1 must not be reached"); } },
  };
  try {
    const oversizedBytes = jsonBytesAtLength({ id: "event-id", event: "payment.captured" }, MAX_WEBHOOK_BYTES + 1);
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedBytes.subarray(0, MAX_WEBHOOK_BYTES));
        controller.enqueue(oversizedBytes.subarray(MAX_WEBHOOK_BYTES));
        controller.close();
      },
    });
    const overflowResponse = await worker.fetch(new Request(`${ORIGIN}/api/payments/razorpay/webhook`, {
      method: "POST",
      headers: { "x-razorpay-signature": "0".repeat(64) },
      body: oversized,
      duplex: "half",
    }), env, {});
    assert.equal(overflowResponse.status, 413);
    assert.equal((await overflowResponse.json()).code, "payload_too_large");
    assert.equal(signatures, 0);
    assert.equal(databaseReads, 0);

    const invalidUtf8 = joinBytes(
      encoder.encode('{"id":"'),
      new Uint8Array([0xc3]),
      encoder.encode('"}'),
    );
    const signature = await __test.hmacSha256Hex(webhookSecret, invalidUtf8);
    assert.equal(signatures, 1, "test setup signs the exact raw bytes once");
    const invalidResponse = await worker.fetch(new Request(`${ORIGIN}/api/payments/razorpay/webhook`, {
      method: "POST",
      headers: { "x-razorpay-signature": signature },
      body: invalidUtf8,
    }), env, {});
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).code, "invalid_json");
    assert.equal(signatures, 2, "the Worker verifies the exact raw bytes before decoding");
    assert.equal(databaseReads, 0);
  } finally {
    subtlePrototype.sign = originalSign;
  }
});
