import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const program = String.raw`
import base64, copy, importlib.util, io, json, os, pathlib, stat, sys, tempfile, zipfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("vault", "ops/backup-vault/receive_backup.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
now = v.timestamp("2026-09-17T12:00:00Z")
workflow_bytes = pathlib.Path(".github/workflows/production-backup.yml").read_bytes()
head = "a" * 40
run = dict(id=123, workflow_id=v.WORKFLOW_ID, name=v.WORKFLOW_NAME, path=v.WORKFLOW_PATH,
           head_branch="main", status="completed", conclusion="success", event="schedule",
           repository=dict(id=v.SOURCE_ID, full_name=v.SOURCE),
           head_repository=dict(id=v.SOURCE_ID, full_name=v.SOURCE), head_sha=head,
           created_at="2026-09-17T11:55:00Z", updated_at="2026-09-17T11:58:00Z")
workflow = dict(id=v.WORKFLOW_ID, path=v.WORKFLOW_PATH, name=v.WORKFLOW_NAME, state="active")
comparison = dict(status="identical", merge_base_commit=dict(sha=head))
cipher = b"GGRIDBK1" + bytes(range(100))
manifest = dict(environment="production", database="grihagrid-db", createdAt="2026-09-17T11:56:00Z",
                keyVersion="2026-08-15-1", encryption="GGRIDBK1-AES-256-GCM", rawPermissions="600",
                rawSha256="b" * 64, encryptedSha256=v.sha256(cipher), timeTravelBookmark="synthetic-bookmark-only",
                isolatedRestore=dict(integrity="ok", foreignKeyViolations=0, schema="current",
                                     requiredSchemaObjectsVerified=83, requiredColumnsVerified=173))
artifact = dict(id=456, name="production-d1-scheduled-123", expired=False, expires_at="2026-09-24T11:57:00Z",
                created_at="2026-09-17T11:57:00Z", workflow_run=dict(id=123, repository_id=v.SOURCE_ID,
                head_repository_id=v.SOURCE_ID, head_branch="main", head_sha=head))
def zip_data(m=manifest, c=cipher, names=None, symlink=False):
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", compression=zipfile.ZIP_DEFLATED) as z:
        members = names or [("manifest.json", json.dumps(m).encode()), ("d1-export.sql.ggrid", c)]
        for name, content in members:
            item = zipfile.ZipInfo(name)
            if symlink and name == "manifest.json":
                item.create_system = 3
                item.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(item, content)
    return memory.getvalue()
data = zip_data()
artifact.update(size_in_bytes=len(data), digest="sha256:" + v.sha256(data))
def archive(candidate=data, m=None, c=None, names=None, symlink=False):
    if m is not None or c is not None or names is not None or symlink:
        candidate = zip_data(m if m is not None else manifest, c if c is not None else cipher, names, symlink)
    metadata = {**artifact, "digest": "sha256:" + v.sha256(candidate), "size_in_bytes": len(candidate)}
    return v.validate_archive(candidate, metadata, run, now)
def source(r=run, a=artifact, w=workflow, b=workflow_bytes, comparison=comparison):
    return v.validate_source(r, a, w, b, head, comparison, now)
case = sys.argv[1]
if case == "valid":
    source()
    content, checked = archive()
    assert content["d1-export.sql.ggrid"] == cipher and checked == manifest
elif case == "traversal":
    archive(names=[("../manifest.json", b"{}"), ("d1-export.sql.ggrid", cipher)])
elif case == "duplicate":
    archive(names=[("manifest.json", b"{}"), ("manifest.json", b"{}")])
elif case == "extra":
    archive(names=[("manifest.json", b"{}"), ("d1-export.sql.ggrid", cipher), ("raw.sql", b"private")])
elif case == "symlink": archive(symlink=True)
elif case == "oversize-manifest":
    archive(names=[("manifest.json", b"x" * (v.MAX_MANIFEST + 1)), ("d1-export.sql.ggrid", cipher)])
elif case == "corrupt-zip": archive(candidate=data[:25])
elif case == "archive-digest": v.validate_archive(data + b"changed", artifact, run, now)
elif case == "cipher-digest": archive(c=cipher + b"changed")
elif case == "magic":
    changed = b"BADMAGC" + cipher[7:]
    archive(m={**manifest, "encryptedSha256": v.sha256(changed)}, c=changed)
elif case == "schema": archive(m={**manifest, "isolatedRestore": {**manifest["isolatedRestore"], "requiredColumnsVerified": 172}})
elif case == "stale": archive(m={**manifest, "createdAt": "2026-09-15T11:56:00Z"})
elif case == "future": archive(m={**manifest, "createdAt": "2026-09-18T11:56:00Z"})
elif case == "outside-run": archive(m={**manifest, "createdAt": "2026-09-17T10:00:00Z"})
elif case == "expired": source(a={**artifact, "expires_at": "2026-09-17T11:00:00Z"})
elif case == "fork": source(r={**run, "head_repository": {"id": 1, "full_name": "outsider/fork"}})
elif case == "failed-run": source(r={**run, "conclusion": "failure"})
elif case == "pull-request": source(r={**run, "event": "pull_request"})
elif case == "artifact-run": source(a={**artifact, "workflow_run": {**artifact["workflow_run"], "id": 124}})
elif case == "workflow-hash": source(b=workflow_bytes + b"changed")
elif case == "not-main": source(comparison={"status": "diverged", "merge_base_commit": {"sha": "b" * 40}})
elif case == "retention":
    days = v.retention_days(artifact["expires_at"], now)
    assert days == 6 and now + 120 + days * 86400 < v.timestamp(artifact["expires_at"])
elif case == "insufficient-retention": v.retention_days("2026-09-18T12:01:00Z", now)
elif case in ("redirect", "unsafe-redirect", "oversize-response"):
    class Response(io.BytesIO):
        pass
    class Opener:
        calls = []
        def open(self, request, timeout):
            self.calls.append(request)
            assert timeout == 10
            if len(self.calls) == 1 and case != "oversize-response":
                assert request.get_header("Authorization") == "Bearer ephemeral-test-token"
                host = "evil.example" if case == "unsafe-redirect" else "archive.blob.core.windows.net"
                raise v.urllib.error.HTTPError(request.full_url, 302, "redirect", {
                    "Location": "https://" + host + "/file?signature=never-log-this"
                }, io.BytesIO())
            if case == "oversize-response": return Response(b"123456")
            assert request.get_header("Authorization") is None
            return Response(b"ciphertext")
    client = v.GitHub("ephemeral-test-token")
    client.opener = Opener()
    try:
        result = client.request("https://api.github.com/repos/source/artifact/zip", 5 if case == "oversize-response" else 100)
    except ValueError as error:
        assert "ephemeral-test-token" not in str(error) and "never-log-this" not in str(error)
        assert len(client.opener.calls) == 1
        raise
    assert result == b"ciphertext" and len(client.opener.calls) == 2
elif case in ("receive", "public-vault", "permission-denied"):
    class Fake:
        def json(self, path):
            if path == "repos/" + v.VAULT: return dict(full_name=v.VAULT, private=case != "public-vault", archived=False)
            if path.endswith("/workflows/" + str(v.WORKFLOW_ID)): return workflow
            if "/runs?" in path: return {"workflow_runs": [run]}
            if path.endswith("/commits/main"): return {"sha": head}
            if "/compare/" in path: return comparison
            if "/contents/" in path: return {"encoding": "base64", "content": base64.b64encode(workflow_bytes).decode()}
            if "/artifacts?" in path: return {"artifacts": [artifact], "total_count": 1}
            raise AssertionError("unexpected API request")
        def request(self, url, limit):
            if case == "permission-denied": raise ValueError("github-http-403")
            assert url.endswith("/456/zip") and limit == v.MAX_ARCHIVE
            return data
    os.environ["GITHUB_REPOSITORY"] = v.VAULT
    with tempfile.TemporaryDirectory() as folder:
        output = pathlib.Path(folder) / "copy"
        try:
            receipt = v.receive(Fake(), output, now)
        except Exception:
            assert not output.exists(), "rejected source must leave no output"
            raise
        assert set(p.name for p in output.iterdir()) == v.FILES
        assert (output / "d1-export.sql.ggrid").read_bytes() == cipher
        assert stat.S_IMODE(output.stat().st_mode) == 0o700
        assert all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in output.iterdir())
        assert receipt["capturedAt"] == manifest["createdAt"] and receipt["decrypted"] is False
        assert "timeTravelBookmark" not in json.dumps(receipt)
else: raise AssertionError("unknown case")
print("accepted")
`;

for (const name of ["valid", "receive", "retention", "insufficient-retention", "redirect", "unsafe-redirect", "oversize-response", "traversal", "duplicate", "extra", "symlink", "oversize-manifest", "corrupt-zip", "archive-digest", "cipher-digest", "magic", "schema", "stale", "future", "outside-run", "expired", "fork", "failed-run", "pull-request", "artifact-run", "workflow-hash", "not-main", "public-vault", "permission-denied"]) {
  test(`private backup receiver: ${name}`, () => {
    const result = spawnSync("python3", ["-c", program, name], { encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    if (["valid", "receive", "retention", "redirect"].includes(name)) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "accepted");
    } else {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ValueError|BadZipFile/);
      assert.doesNotMatch(result.stdout, /accepted/);
    }
  });
}

test("receiver pins current workflow and stays manual with ephemeral read permissions", () => {
  const source = readFileSync("ops/backup-vault/receive_backup.py", "utf8");
  const workflow = readFileSync("ops/backup-vault/receive-backup.yml", "utf8");
  const digest = createHash("sha256").update(readFileSync(".github/workflows/production-backup.yml")).digest("hex");
  assert.ok(source.includes(`WORKFLOW_SHA256 = "${digest}"`));
  assert.doesNotMatch(workflow, /schedule:|secrets\.|permissions:[\s\S]*write/);
  assert.match(workflow, /timeout-minutes: 2/);
  assert.match(workflow, /retention-days: \$\{\{ steps.receive.outputs.retention_days \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/);
});

test("CLI fails closed without credentials and never echoes environment secrets", () => {
  const result = spawnSync("python3", ["ops/backup-vault/receive_backup.py", "unused"], {
    encoding: "utf8", env: { ...process.env, GH_TOKEN: "", D1_BACKUP_PASSPHRASE: "must-not-be-printed" }, timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Backup receiver failed: missing-workflow-token");
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-printed/);
});
