#!/usr/bin/env python3
"""Copy verified ciphertext only. No decryption, persistent secret, or token fallback."""
import base64
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

SOURCE = "prakhar267/grihagrid"
SOURCE_ID = 1332268730
VAULT = "prakhar267/grihagrid-backups"
WORKFLOW_ID = 351480423
WORKFLOW_PATH = ".github/workflows/production-backup.yml"
WORKFLOW_NAME = "Production D1 encrypted backup"
WORKFLOW_SHA256 = "19a514318b4e034b960c26e0d5b17c05993c828cd6baa02836a21992db47fbea"
MAX_ARCHIVE = 16 * 1024 * 1024
MAX_MANIFEST = 16 * 1024
MAX_AGE_SECONDS = 26 * 3600
FILES = {"manifest.json", "d1-export.sql.ggrid"}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value), "invalid-timestamp")
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def fresh(value, now):
    captured = timestamp(value)
    require(-300 <= now - captured <= MAX_AGE_SECONDS, "stale-or-future-backup")
    return captured


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate-json-key")
        result[key] = value
    return result


def decode_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def retention_days(expires_at, now):
    # Upload expiry is relative to upload time, not original capture time. Reserve
    # more than this job's entire two-minute limit rather than extending retention.
    days = min(7, int((timestamp(expires_at) - now - 180) // 86400))
    require(days >= 1, "insufficient-source-retention")
    return days


def validate_source(run, artifact, workflow, workflow_bytes, main_sha, comparison, now):
    require(workflow.get("id") == WORKFLOW_ID and workflow.get("path") == WORKFLOW_PATH
            and workflow.get("name") == WORKFLOW_NAME and workflow.get("state") == "active", "untrusted-workflow")
    require(sha256(workflow_bytes) == WORKFLOW_SHA256, "workflow-content-changed")
    require(type(run.get("id")) is int and run["id"] > 0, "invalid-run-id")
    require(run.get("workflow_id") == WORKFLOW_ID and run.get("name") == WORKFLOW_NAME
            and run.get("path") == WORKFLOW_PATH and run.get("head_branch") == "main"
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("event") in ("schedule", "workflow_dispatch"), "untrusted-run")
    for key in ("repository", "head_repository"):
        require(run.get(key, {}).get("id") == SOURCE_ID
                and run[key].get("full_name") == SOURCE, "untrusted-source-repository")
    head = run.get("head_sha", "")
    require(re.fullmatch(r"[0-9a-f]{40}", head) and re.fullmatch(r"[0-9a-f]{40}", main_sha), "invalid-source-sha")
    require(comparison.get("status") in ("identical", "ahead")
            and comparison.get("merge_base_commit", {}).get("sha") == head, "source-not-on-main")
    started, completed = fresh(run["created_at"], now), fresh(run["updated_at"], now)
    require(started <= completed, "invalid-run-time")
    require(type(artifact.get("id")) is int and artifact["id"] > 0
            and artifact.get("name") == f"production-d1-scheduled-{run['id']}"
            and artifact.get("expired") is False and timestamp(artifact["expires_at"]) > now,
            "missing-or-expired-artifact")
    require(type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= MAX_ARCHIVE,
            "artifact-too-large")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest", "")), "missing-artifact-digest")
    captured = fresh(artifact["created_at"], now)
    require(started - 300 <= captured <= completed + 300, "artifact-outside-run")
    provenance = artifact.get("workflow_run", {})
    require(provenance.get("id") == run["id"] and provenance.get("repository_id") == SOURCE_ID
            and provenance.get("head_repository_id") == SOURCE_ID
            and provenance.get("head_branch") == "main" and provenance.get("head_sha") == head,
            "artifact-provenance-mismatch")


def validate_archive(data, artifact, run, now):
    require(0 < len(data) <= MAX_ARCHIVE and sha256(data) == artifact["digest"][7:], "archive-digest-mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        require(len(members) == 2 and {item.filename for item in members} == FILES, "unexpected-zip-members")
        for item in members:
            kind = stat.S_IFMT(item.external_attr >> 16)
            limit = MAX_MANIFEST if item.filename == "manifest.json" else MAX_ARCHIVE
            require(not item.is_dir() and kind in (0, stat.S_IFREG) and not item.flag_bits & 1
                    and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    and 0 < item.file_size <= limit, "unsafe-zip-member")
        # Exact constant names only: no filesystem extraction or path interpretation.
        content = {item.filename: archive.read(item) for item in members}
    manifest = decode_json(content["manifest.json"])
    require(isinstance(manifest, dict) and set(manifest) == {
        "environment", "database", "createdAt", "keyVersion", "encryption", "rawPermissions",
        "rawSha256", "encryptedSha256", "timeTravelBookmark", "isolatedRestore"}, "invalid-manifest-shape")
    require(manifest["environment"] == "production" and manifest["database"] == "grihagrid-db"
            and manifest["encryption"] == "GGRIDBK1-AES-256-GCM"
            and manifest["keyVersion"] == "2026-08-15-1" and manifest["rawPermissions"] == "600", "invalid-backup-contract")
    captured = fresh(manifest["createdAt"], now)
    require(timestamp(run["created_at"]) - 300 <= captured <= timestamp(artifact["created_at"]) + 300,
            "capture-outside-run")
    require(re.fullmatch(r"[0-9a-f]{64}", manifest["rawSha256"])
            and re.fullmatch(r"[A-Za-z0-9._:-]{16,256}", manifest["timeTravelBookmark"]), "invalid-recovery-evidence")
    require(manifest["isolatedRestore"] == {"integrity": "ok", "foreignKeyViolations": 0,
            "schema": "current", "requiredSchemaObjectsVerified": 83, "requiredColumnsVerified": 173},
            "restore-schema-not-verified")
    ciphertext = content["d1-export.sql.ggrid"]
    require(len(ciphertext) >= 52 and ciphertext.startswith(b"GGRIDBK1")
            and sha256(ciphertext) == manifest["encryptedSha256"], "ciphertext-contract-mismatch")
    return content, manifest


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token):
        require(bool(token), "missing-workflow-token")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, url, limit, authenticated=True):
        headers = {"User-Agent": "GrihaGrid-backup-vault", "Accept": "application/vnd.github+json"}
        if authenticated:
            require(url.startswith("https://api.github.com/"), "unsafe-authentication-target")
            headers.update({"Authorization": f"Bearer {self.token}", "X-GitHub-Api-Version": "2022-11-28"})
        try:
            response = self.opener.open(urllib.request.Request(url, headers=headers), timeout=10)
        except urllib.error.HTTPError as error:
            if authenticated and error.code == 302:
                location = error.headers.get("Location", "")
                error.close()
                target = urllib.parse.urlsplit(location)
                require(target.scheme == "https" and not target.username and not target.password
                        and target.port in (None, 443) and target.hostname
                        and target.hostname.endswith((".blob.core.windows.net", ".githubusercontent.com")),
                        "unsafe-artifact-redirect")
                return self.request(location, limit, authenticated=False)
            status = error.code
            error.close()
            raise ValueError(f"github-http-{status}") from None
        with response:
            data = response.read(limit + 1)
            require(len(data) <= limit, "response-too-large")
            return data

    def json(self, path):
        return decode_json(self.request(f"https://api.github.com/{path}", 1024 * 1024))


def receive(api, output, now):
    require(os.environ.get("GITHUB_REPOSITORY") == VAULT, "unexpected-receiver-repository")
    vault = api.json(f"repos/{VAULT}")
    require(vault.get("full_name") == VAULT and vault.get("private") is True
            and vault.get("archived") is False, "receiver-not-private")
    prefix = f"repos/{SOURCE}"
    workflow = api.json(f"{prefix}/actions/workflows/{WORKFLOW_ID}")
    runs = api.json(f"{prefix}/actions/workflows/{WORKFLOW_ID}/runs?branch=main&status=success&per_page=1")["workflow_runs"]
    require(len(runs) == 1, "no-successful-backup")
    run = runs[0]
    require(type(run.get("id")) is int and re.fullmatch(r"[0-9a-f]{40}", run.get("head_sha", "")), "invalid-run-reference")
    main_sha = api.json(f"{prefix}/commits/main")["sha"]
    require(re.fullmatch(r"[0-9a-f]{40}", main_sha), "invalid-main-reference")
    comparison = api.json(f"{prefix}/compare/{run['head_sha']}...{main_sha}")
    source = api.json(f"{prefix}/contents/{WORKFLOW_PATH}?ref={run['head_sha']}")
    require(source.get("encoding") == "base64", "invalid-workflow-encoding")
    workflow_bytes = base64.b64decode(source["content"], validate=False)
    artifacts = api.json(f"{prefix}/actions/runs/{run['id']}/artifacts?per_page=100")
    matches = [item for item in artifacts["artifacts"] if item.get("name") == f"production-d1-scheduled-{run['id']}"]
    require(artifacts["total_count"] <= 100 and len(matches) == 1, "ambiguous-backup-artifact")
    artifact = matches[0]
    validate_source(run, artifact, workflow, workflow_bytes, main_sha, comparison, now)
    private_retention = retention_days(artifact["expires_at"], now)
    data = api.request(f"https://api.github.com/{prefix}/actions/artifacts/{artifact['id']}/zip", MAX_ARCHIVE)
    content, manifest = validate_archive(data, artifact, run, now)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        for name, value in content.items():
            with (output / name).open("xb") as handle:
                os.chmod(output / name, 0o600)
                handle.write(value)
    except BaseException:
        shutil.rmtree(output)
        raise
    return {"source": SOURCE, "runId": run["id"], "sourceSha": run["head_sha"],
            "workflowSha256": WORKFLOW_SHA256, "artifactId": artifact["id"],
            "archiveSha256": sha256(data), "capturedAt": manifest["createdAt"],
            "sourceExpiresAt": artifact["expires_at"], "ciphertextSha256": manifest["encryptedSha256"],
            "privateRetentionDays": private_retention,
            "restoreSchemaObjects": 83, "restoreSchemaColumns": 173,
            "decrypted": False, "publicSourceCopyRemainsUntilExpiry": True}


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "one-output-directory-required")
        receipt = receive(GitHub(os.environ.get("GH_TOKEN")), Path(sys.argv[1]), dt.datetime.now(dt.timezone.utc).timestamp())
        print(json.dumps(receipt, sort_keys=True))
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as handle:
                handle.write(f"source_run_id={receipt['runId']}\n")
                handle.write(f"retention_days={receipt['privateRetentionDays']}\n")
    except Exception as error:
        # Never echo network exceptions, signed download URLs, tokens, or manifest values.
        code = str(error) if type(error) is ValueError and re.fullmatch(r"[a-z0-9-]{1,80}", str(error)) else "verification-failed"
        print(f"Backup receiver failed: {code}", file=sys.stderr)
        sys.exit(1)
