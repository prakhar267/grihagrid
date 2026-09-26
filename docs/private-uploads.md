# Private static-image uploads

Migrations `0019_private_image_uploads.sql` and `0025_private_file_cleanup.sql`
and the Worker implement an
owner-scoped R2 path for static JPEG, PNG, and WebP images. The capability is
false unless the current schema and `FILES` binding are both present.

## Accepted-file contract

- raw request body only; multipart and PDF are rejected;
- at most 10 MiB input and 40 megapixels;
- exact declared type/signature and bounded structural parsing;
- exact image termination, with trailing/polyglot data rejected;
- PNG ancillary metadata removed, JPEG APP/COM metadata removed, and WebP
  EXIF/XMP/ICC removed; animated WebP is rejected;
- SHA-256 and size describe only the normalized stored bytes;
- at most 20 ready images per project and 100 per account.

Only rows with `storage_state=ready` and the static-image sanitization profile
are listed or downloadable. Existing pre-migration metadata is
`legacy_blocked`. Downloads require ownership and use attachment, `nosniff`, and
`private, no-store`; object keys are never public API values.

## Activation

Create private, non-public buckets named `grihagrid-private-files` and
`grihagrid-staging-private-files` with an operator identity that has R2 scope.
Verify each bucket and environment independently, then uncomment the matching
`FILES` binding and run readiness plus the authenticated upload tests. The
26 September 2026 account inspection returns Cloudflare error 10042: R2 must
be enabled through the dashboard. Subscription terms and usage charges have not
been accepted. Bindings remain commented and no activation is claimed.

[Recoverable deletion](private-file-cleanup.md) is an activation prerequisite.
Verify both ordinary removal and an R2-outage retry, a deletion during upload,
and recurring maintenance in each environment. Production currently runs daily;
staging lacks a cron slot and needs an explicit maintenance arrangement.
Admission rejects full projects/accounts before writing R2 and rate-limits
uploads to 30 attempts per IP per hour; database guards remain authoritative
under concurrency. These bounds are not an account-wide free-storage guarantee.
Choose and verify a total storage/cost ceiling before opening public uploads.

Do not widen this path to PDF, SVG, archives, video, or arbitrary documents.
Those formats require a separate quarantine, parsing, malware-scanning,
retention, and download-threat model.
