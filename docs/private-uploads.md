# Private static-image uploads

Migration `0019_private_image_uploads.sql` and the Worker implement an
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
current operator OAuth grant cannot list or create R2 buckets, so bindings are
deliberately commented and no activation is claimed.

Do not widen this path to PDF, SVG, archives, video, or arbitrary documents.
Those formats require a separate quarantine, parsing, malware-scanning,
retention, and download-threat model.
