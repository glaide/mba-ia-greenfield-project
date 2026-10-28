---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-26T21:49:00-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-26T21:49:30-03:00"
  docs/phases/phase-03-videos/validation.md: "2026-10-26T21:49:15-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-26T21:48:38-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver backend upload (presigned multipart up to 10GB), MinIO storage, BullMQ/Redis processing with an FFmpeg worker, unique video slugs, Range streaming, and download — with draft→processing→ready|failed lifecycle.

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Compose Infra

**Description:** Install AWS SDK, BullMQ, nanoid; add Joi/env for storage and Redis; extend Compose with `minio`, `redis`, and `video-worker` (FFmpeg image).

**Technical actions:**

- Add npm deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@nestjs/bullmq`, `bullmq`, `nanoid` (and `@types` if needed)
- Create `src/config/storage.config.ts` and `src/config/queue.config.ts`; register in `ConfigModule`; extend `env.validation.ts` and `.env.example`
- Compose services: `minio` (9000/9001), `redis` (6379), `video-worker` (build from worker Dockerfile with ffmpeg); wire env hosts `minio`, `redis`, `db`
- Create MinIO bucket on API bootstrap (idempotent `CreateBucket` / HeadBucket)
- NestJS API `depends_on` redis + minio healthy; worker depends on redis, minio, db

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/config/storage.config.spec.ts | Unit | config factory maps env keys |
| src/config/queue.config.spec.ts | Unit | Redis connection config from env |

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` starts `db`, `mailpit`, `minio`, `redis`, `nestjs-api`, `video-worker`
- Env validation rejects missing `S3_*` / `REDIS_*` when required
- Traceable to `phase-03-videos/TD-01`, `TD-03`, `TD-04`

---

### SI-03.2 — Storage Module (S3/MinIO Client)

**Description:** Encapsulate MinIO operations: multipart lifecycle, presigned part URLs, put thumbnail, ranged get stream.

**Technical actions:**

- Create `src/storage/storage.module.ts`, `storage.service.ts`, `storage.constants.ts`
- Methods: `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `putObject`, `getObjectStream(key, range?)`, `ensureBucket`
- Key builders: `videos/{videoId}/original`, `videos/{videoId}/thumbnail.jpg`
- Export `StorageService` for VideosModule and worker

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/storage/storage.service.spec.ts | Unit | key builders; command wiring mocked |
| src/storage/storage.service.integration-spec.ts | Integration | real MinIO multipart + get range |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Integration test completes multipart of a small object against Compose MinIO
- `forcePathStyle: true` and endpoint use Compose service name `minio`

---

### SI-03.3 — Queue Module (BullMQ)

**Description:** Register BullMQ root + `video-processing` queue; expose producer token for enqueueing process jobs.

**Technical actions:**

- `src/queue/queue.module.ts` with `BullModule.forRootAsync` + `registerQueue({ name: 'video-processing' })`
- Constant `VIDEO_PROCESSING_QUEUE = 'video-processing'`; job name `process-video`
- Default job opts: `attempts: 3`, exponential backoff `delay: 5000`
- Export queue module for VideosModule (producer) and worker (processor)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/queue/queue.module.spec.ts | Unit | module compiles with mocked Redis config |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Queue connects to Compose `redis` host
- Traceable to `phase-03-videos/TD-01`

---

### SI-03.4 — Video Entity and Migration

**Description:** Persist videos linked to channels with status, storage keys, slug, duration/metadata.

**Technical actions:**

- Entity `src/videos/entities/video.entity.ts` per Data Model
- Enum `VideoStatus`: `draft`, `processing`, `ready`, `failed`
- Migration `CreateVideos` with FK to `channels`, unique `slug`
- Relation Channel → Videos (one-to-many); do not break Channel 1:1 User

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/entities/video.entity.integration-spec.ts | Integration | insert/constraints/FK |
| src/database/migrations.integration-spec.ts | Integration | update to include CreateVideos (drop enum types in cleanup) |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Migration creates `videos` table; unique slug enforced
- Traceable to `phase-03-videos/TD-06`, `TD-08`

---

### SI-03.5 — Videos Module Skeleton and Ownership

**Description:** Wire `VideosModule` with controller/service/repository; resolve owning channel from JWT user.

**Technical actions:**

- `videos.module.ts`, `videos.service.ts`, `videos.controller.ts`
- Inject Channel repository/service to resolve `channelId` from `userId`
- Domain exceptions: `VideoNotFoundException`, `VideoNotOwnedException`, `VideoInvalidStatusException`, `VideoUploadException`
- Register module in `AppModule`
- Swagger tags `@ApiTags('videos')`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/videos.module.spec.ts | Unit | module compiles |
| src/videos/videos.service.spec.ts | Unit | ownership checks with mocks |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- Authenticated user without channel cannot upload (should not happen post-Fase 02; still guard)

---

### SI-03.6 — Upload Init (Draft + Presigned Multipart)

**Description:** `POST /videos/upload/init` creates draft video + multipart upload; returns slug, uploadId, and first-batch or recipe for part URLs.

**Technical actions:**

- DTO: `title` (optional default), `filename`, `contentType`, `sizeBytes` (max 10GB), `partCount` or server-suggested part size
- Create Video `status=draft`, generate nanoid slug, set `storageKey`
- Start multipart; return `{ id, slug, uploadId, bucket, key, partSize, parts: [{ partNumber, url }] }` (presign requested parts)
- Optional `POST /videos/:id/upload/parts` to mint additional part URLs for owner while draft

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/videos.service.spec.ts | Unit | draft creation + slug; rejects size > 10GB |
| src/videos/videos.service.integration-spec.ts | Integration | draft row + MinIO multipart created |
| test/videos.e2e-spec.ts | E2E | 201 init requires auth; returns uploadId |

**Dependencies:** SI-03.2, SI-03.5

**Acceptance criteria:**

- No video bytes pass through Nest body
- Max size 10GB enforced (`10737418240`)
- Traceable to `phase-03-videos/TD-02`, `TD-08`

---

### SI-03.7 — Upload Complete and Enqueue Processing

**Description:** `POST /videos/:id/upload/complete` completes multipart, sets `processing`, enqueues BullMQ job.

**Technical actions:**

- DTO: `uploadId`, `parts: [{ partNumber, etag }]`
- Verify ownership + status `draft`
- `completeMultipartUpload`; update status `processing`; clear multipart id fields
- `queue.add('process-video', { videoId })`
- On MinIO failure: keep draft or set failed with reason; do not enqueue

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/videos.service.spec.ts | Unit | enqueue called; invalid status rejected |
| src/videos/videos.service.integration-spec.ts | Integration | complete small multipart + job appears in Redis |
| test/videos.e2e-spec.ts | E2E | complete flow transitions to processing |

**Dependencies:** SI-03.3, SI-03.6

**Acceptance criteria:**

- Status `processing` after successful complete
- Job payload includes `videoId`
- Traceable to `phase-03-videos/TD-01`, `TD-08`

---

### SI-03.8 — Video Worker (ffprobe + thumbnail)

**Description:** Worker process consumes `process-video`, extracts metadata/duration, writes thumbnail to MinIO, sets `ready` or `failed`.

**Technical actions:**

- Entry `src/worker.ts` (or `src/videos/worker.main.ts`) bootstrapping Nest context with Queue + Storage + TypeORM + Videos persistence (no HTTP)
- `VideoProcessingProcessor` `@Processor('video-processing')`
- Download/stream original to temp file (or pipe); run ffprobe JSON; ffmpeg one frame at 1s (or 0 if shorter)
- Upload thumbnail; update `durationSeconds`, `metadata` jsonb, `thumbnailKey`, `status=ready`
- On error: set `failed` + `failureReason`; rethrow for BullMQ retry until attempts exhausted
- Dockerfile.worker installs `ffmpeg`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/video-processing.processor.spec.ts | Unit | success path updates ready; error sets failed |
| src/videos/video-processing.processor.integration-spec.ts | Integration | process fixture mp4 against MinIO+DB (skip if no ffmpeg in API image — run in worker context) |

**Dependencies:** SI-03.7

**Acceptance criteria:**

- Worker container processes job without API process doing FFmpeg
- Traceable to `phase-03-videos/TD-04`, `TD-05`, `TD-08`

---

### SI-03.9 — Get Video by Slug

**Description:** Public metadata endpoint by unique slug for ready videos (and owner can read own drafts).

**Technical actions:**

- `GET /videos/:slug` — `@Public()`; return id, slug, title, status, duration, thumbnail URL path, channel summary when `ready`; owners may see non-ready
- Ensure slug uniqueness retry on collision at create

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| test/videos.e2e-spec.ts | E2E | 404 unknown slug; 200 ready video public |

**Dependencies:** SI-03.5, SI-03.6

**Acceptance criteria:**

- Unique slug; no conflict across videos
- Traceable to `phase-03-videos/TD-06`

---

### SI-03.10 — Stream (Range/206) and Download

**Description:** Stream with HTTP Range support; download with Content-Disposition attachment.

**Technical actions:**

- `GET /videos/:slug/stream` `@Public()` — only `ready`; parse `Range`; MinIO ranged get; respond `206` or `200`; headers `Accept-Ranges`, `Content-Range`, `Content-Type`, `Content-Length`
- `GET /videos/:slug/download` — authenticated owner (or public if same as stream policy: **owner or public ready** — Authorization Matrix: ready videos downloadable by anyone authenticated or anonymous — choose **public for ready**, consistent with watch-anonymously product)
- Pipe body; never buffer full 10GB in memory

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/videos/videos.service.spec.ts | Unit | range parse helpers |
| test/videos.e2e-spec.ts | E2E | stream without Range → 200; with Range → 206; download disposition |

**Dependencies:** SI-03.2, SI-03.8, SI-03.9

**Acceptance criteria:**

- Streaming does not require full file download
- Traceable to `phase-03-videos/TD-07`

---

### SI-03.11 — OpenAPI Sync for Videos Endpoints

**Description:** Document all video endpoints in Swagger with DTOs and error codes.

**Technical actions:**

- `@ApiBearerAuth`, `@ApiOperation`, response types on controller methods
- Ensure `npm run` openapi export / existing swagger e2e still passes

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| test/swagger.e2e-spec.ts | E2E | existing suite green; paths include `/videos` |

**Dependencies:** SI-03.6, SI-03.7, SI-03.9, SI-03.10

**Acceptance criteria:**

- Swagger lists upload init/complete, get, stream, download

---

### SI-03.12 — E2E Happy Path, Failure Path, and DoD Gate

**Description:** End-to-end upload→process→stream; failure sets failed; full DoD commands green.

**Technical actions:**

- E2E: register/login → init → PUT parts to MinIO → complete → wait for ready → stream Range
- E2E/integration: force processing failure → status `failed`
- Fix migration test cleanup to drop enum types including any new video enums
- Run `npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run lint`
- Update root and `nestjs-project/CLAUDE.md` videos section

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| test/videos.e2e-spec.ts | E2E | full happy path + failure |

**Dependencies:** SI-03.1–SI-03.11

**Acceptance criteria:**

- Definition of Done complete
- `progress.md` marks all SIs completed

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| channel_id | uuid | FK → channels.id, not null | Owner channel |
| title | varchar(200) | not null | Default from filename or "Untitled" |
| slug | varchar(32) | unique, not null | nanoid |
| status | enum | not null | `draft`, `processing`, `ready`, `failed` |
| storage_key | varchar | not null | Original object key |
| thumbnail_key | varchar | nullable | Set when ready |
| content_type | varchar | not null | e.g. video/mp4 |
| size_bytes | bigint | not null | Declared at init |
| duration_seconds | float | nullable | From ffprobe |
| metadata | jsonb | nullable | ffprobe subset |
| multipart_upload_id | varchar | nullable | Cleared after complete |
| failure_reason | text | nullable | Set when failed |
| created_at | timestamp | not null | |
| updated_at | timestamp | not null | |

**Relations:** Video → Channel (many-to-one)
**Indexes:** unique `(slug)`, `(channel_id)`, `(status)`

---

### API Contracts

#### POST /videos/upload/init (SI-03.6)

**Auth:** Bearer required

**Request body:**
- title: string, optional, max 200
- filename: string, required
- contentType: string, required — must start with `video/`
- sizeBytes: number, required — 1..10737418240
- partCount: number, required — 1..10000

**Response 201:**
- id, slug, status=`draft`, uploadId, key, partSize, parts: [{ partNumber, url }]

**Errors:** 401, 400 validation, 400 VIDEO_FILE_TOO_LARGE, 400 VIDEO_INVALID_CONTENT_TYPE

#### POST /videos/:id/upload/parts (SI-03.6)

**Auth:** Bearer + owner

**Body:** partNumbers: number[]

**Response 200:** parts: [{ partNumber, url }]

**Errors:** 401, 403 VIDEO_NOT_OWNED, 404 VIDEO_NOT_FOUND, 409 VIDEO_INVALID_STATUS

#### POST /videos/:id/upload/complete (SI-03.7)

**Auth:** Bearer + owner

**Body:** uploadId: string; parts: [{ partNumber, etag }]

**Response 200:** id, slug, status=`processing`

**Errors:** 401, 403, 404, 409 VIDEO_INVALID_STATUS, 400 VIDEO_UPLOAD_FAILED

#### GET /videos/:slug (SI-03.9)

**Auth:** Public

**Response 200:** id, slug, title, status, durationSeconds, thumbnailKey, contentType, channel: { id, nickname, name } — non-ready only if requester is owner (else 404)

**Errors:** 404 VIDEO_NOT_FOUND

#### GET /videos/:slug/stream (SI-03.10)

**Auth:** Public; video must be `ready`

**Headers:** optional `Range: bytes=start-end`

**Response:** 200 or 206 with video bytes

**Errors:** 404, 416 invalid range, 409 if not ready (as 404 to clients)

#### GET /videos/:slug/download (SI-03.10)

**Auth:** Public; video must be `ready`

**Response 200/206:** same as stream with `Content-Disposition: attachment; filename="..."`

**Errors:** 404

---

### Authorization Matrix

| Endpoint | Anonymous | Authenticated owner | Authenticated other |
|----------|-----------|---------------------|---------------------|
| POST /videos/upload/init | deny | allow | allow (own channel) |
| POST /videos/:id/upload/* | deny | allow | deny 403 |
| GET /videos/:slug (ready) | allow | allow | allow |
| GET /videos/:slug (non-ready) | deny 404 | allow | deny 404 |
| GET /videos/:slug/stream\|download | allow if ready | allow if ready | allow if ready |

---

### Error Catalog

| Code | HTTP | When |
|------|------|------|
| VIDEO_NOT_FOUND | 404 | Unknown id/slug or hidden non-ready |
| VIDEO_NOT_OWNED | 403 | Mutating another channel's video |
| VIDEO_INVALID_STATUS | 409 | Operation not allowed for current status |
| VIDEO_FILE_TOO_LARGE | 400 | sizeBytes > 10GB |
| VIDEO_INVALID_CONTENT_TYPE | 400 | Not a video/* type |
| VIDEO_UPLOAD_FAILED | 400 | Multipart complete failed |

Domain exceptions extend existing `DomainException` + filter (`phase-02-auth/TD-07`).

---

### Events / Messages

**Queue:** `video-processing` (BullMQ / Redis)

**Job name:** `process-video`

**Payload:**

```json
{ "videoId": "<uuid>" }
```

**Opts:** `attempts: 3`, `backoff: { type: "exponential", delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: false`

**Status transitions:**

```
draft --(upload complete + enqueue)--> processing --(worker success)--> ready
                                         \--(worker failure after retries)--> failed
```

**Idempotency:** Worker no-ops if status already `ready`; if `failed` and job retried, may re-process until success.

---

### Validation Rules

- `sizeBytes` ∈ [1, 10737418240]
- `contentType` matches `/^video\//`
- `title` length ≤ 200
- `partCount` ≥ 1
- Slug: nanoid URL-safe alphabet, length 12

---

## Dependency Map

```
SI-03.1
  ├── SI-03.2
  ├── SI-03.3
  └── SI-03.4
        └── SI-03.5
              ├── SI-03.6 ──┐
              │             ├── SI-03.7 ── SI-03.8 ── SI-03.10
              └── SI-03.9 ──┘                      └── SI-03.11
                                                        └── SI-03.12
```

---

## Deliverables

- [ ] MinIO + Redis + video-worker in Compose
- [ ] Videos module + migration
- [ ] Presigned multipart upload ≤10GB with draft pre-registration
- [ ] Automatic processing (duration/metadata + thumbnail)
- [ ] Unique slug URLs
- [ ] Range streaming + download
- [ ] Status cycle draft → processing → ready|failed
- [ ] Tests green + tsc + lint (DoD)
- [ ] CLAUDE.md updated
- [ ] Phase artifacts: context, validation (clean), library-refs, plan, progress
