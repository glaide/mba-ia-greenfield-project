---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-26
scope_description: "Backend video upload and processing: object storage, queue/worker, 10GB upload without blocking the API, draft pre-registration, metadata/thumbnail extraction, unique URLs, streaming and download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers video upload (presigned), processing queue/worker, streaming/download APIs, MinIO storage client, and Compose infra (MinIO, Redis, video-worker).
- `next-frontend/` — Frontend deferred: video upload UI and player are out of scope for Fase 03 (addressed in later phases). No open decision in this document.

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram leaves Message Queue as TBD. Video processing (ffprobe/ffmpeg) must run asynchronously so the API stays responsive after upload completes. The choice constrains Compose services, NestJS modules, and retry semantics.

**Options:**

### Option A: BullMQ + Redis
- Redis-backed job queue via `bullmq` and `@nestjs/bullmq`. Nest processors/workers consume named queues with built-in retries, backoff, and job IDs.
- **Pros:** First-class NestJS integration; simple Compose service (`redis`); strong retry/idempotency patterns for long FFmpeg jobs; same Redis usable later for rate-limit storage.
- **Cons:** Adds Redis as a new infrastructure dependency; jobs are Redis-centric (not portable to AMQP without rewrite).

### Option B: RabbitMQ (AMQP)
- Classic message broker with exchanges/queues. NestJS can use `@nestjs/microservices` or `amqplib` wrappers.
- **Pros:** Battle-tested routing; language-agnostic consumers; durable queues.
- **Cons:** Heavier Compose footprint; less ergonomic Nest job API than BullMQ; overkill for a single process-video queue in this phase.

### Option C: In-process async (no broker)
- Fire-and-forget `setImmediate` / EventEmitter inside the API process after upload complete.
- **Pros:** Zero new infra.
- **Cons:** Ties processing to the API process (restarts lose work); cannot scale workers independently; violates the architecture’s separate Video Worker container. Rejected for Fase 03.

**Recommendation:** **BullMQ + Redis** — NestJS-native, matches the separate-worker architecture, and keeps Compose simple for a single job type.

**Decision:** A (BullMQ + Redis)

**Libraries:** `@nestjs/bullmq`, `bullmq`, `ioredis` (peer)

---

## TD-02: Upload Strategy for Files up to 10GB

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Passing a 10GB body through Nest/Express would exhaust memory and block the API. Upload must keep bytes off the Nest process while still creating a draft video record and owning authorization.

**Options:**

### Option A: S3/MinIO presigned multipart (direct-to-storage)
- API creates draft video + `CreateMultipartUpload`, returns part presigned URLs (or a helper to mint them). Client PUTs parts to MinIO; API `CompleteMultipartUpload` then enqueues processing.
- **Pros:** API never buffers video bytes; scales to 10GB; native S3 API on MinIO; clear auth boundary (only owners get URLs).
- **Cons:** Client must implement multipart; need careful part-size/expiry config; CORS on MinIO for browser clients (later FE).

### Option B: tus resumable protocol
- Dedicated tus endpoint (e.g. `tus-node-server`) storing chunks then assembling into MinIO.
- **Pros:** Excellent resume UX; standardized protocol.
- **Cons:** Extra server/protocol surface; still risks API/proxy involvement unless carefully offloaded; more moving parts than needed for backend-only Fase 03.

### Option C: Multipart form through the API (streaming proxy)
- Client POSTs file to Nest; Nest streams to MinIO.
- **Pros:** Simple client (single POST).
- **Cons:** Ties Nest to the full transfer duration; connection/timeout/memory risk at 10GB — **automatic fail** per acceptance criteria.

**Recommendation:** **Presigned multipart to MinIO** — only strategy that meets the “do not freeze the API” criterion without adding a second upload protocol stack.

**Decision:** A (S3/MinIO presigned multipart)

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` (as needed)

---

## TD-03: Object Storage Layout (MinIO / S3)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Storage product is fixed (S3-compatible MinIO locally). Open choice is bucket/key organization, credentials, and how originals vs thumbnails are addressed.

**Options:**

### Option A: Single bucket, prefixed keys
- One bucket (e.g. `streamtube`). Keys: `videos/{videoId}/original.{ext}`, `videos/{videoId}/thumbnail.jpg`.
- **Pros:** Simple IAM/policy; easy local MinIO bootstrap; clear ownership by videoId.
- **Cons:** Coarse-grained bucket policy (all objects share one bucket).

### Option B: Separate buckets for originals and thumbnails
- `streamtube-videos` + `streamtube-thumbnails`.
- **Pros:** Independent lifecycle/CDN policies later.
- **Cons:** More Compose/env surface for little gain in Fase 03.

### Option C: Per-channel buckets
- One bucket per channel nickname/id.
- **Pros:** Isolation.
- **Cons:** Bucket limits/ops complexity; unnecessary for MVP.

**Recommendation:** **Single bucket with prefixed keys** — minimal Compose config; keys stored on the Video entity for streaming/download/thumbnail.

**Decision:** A (single bucket, prefixed keys)

**Libraries:** `@aws-sdk/client-s3` (same as TD-02)

---

## TD-04: Worker Runtime

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** FFmpeg work must not run inside the HTTP API process. Architecture already shows a Video Worker container.

**Options:**

### Option A: Separate NestJS worker Compose service
- Second Node process sharing codebase; boots a Nest context that registers BullMQ processors only (no HTTP listen, or dedicated `worker.ts` entry). Image includes FFmpeg/ffprobe.
- **Pros:** Reuses entities, TypeORM, storage module, domain exceptions; scales independently; matches C4 diagram.
- **Cons:** Second container to operate; shared code must keep worker entry lean.

### Option B: Sidecar / same container as API
- Worker process started alongside API in one service.
- **Pros:** One image.
- **Cons:** Coupled lifecycle; harder horizontal scale; contradicts “worker” as its own container.

### Option C: Cron polling unfinished uploads
- Periodic job scans DB for videos needing processing.
- **Pros:** No queue.
- **Cons:** Latency, duplicate work, no backpressure — rejected given TD-01 queue choice.

**Recommendation:** **Separate NestJS worker Compose service** with FFmpeg in the image.

**Decision:** A (separate NestJS worker container)

---

## TD-05: Processing and Thumbnail Generation

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** After upload completes, the worker must extract duration/metadata and produce a thumbnail frame into object storage.

**Options:**

### Option A: System FFmpeg/ffprobe via `child_process`
- Call `ffprobe -print_format json` and `ffmpeg -ss … -vframes 1` from the worker; parse JSON; upload thumbnail to MinIO.
- **Pros:** No native npm binding; full control; matches “FFmpeg” in architecture; easy to install in Debian-based Docker image.
- **Cons:** Manual argv/escaping; must handle stderr/exit codes carefully.

### Option B: `fluent-ffmpeg` wrapper
- Node wrapper around system FFmpeg.
- **Pros:** Slightly nicer API.
- **Cons:** Extra dependency; still requires system FFmpeg; maintenance overhead for little gain.

### Option C: Cloud media service (MediaConvert, etc.)
- Offload to managed transcoder.
- **Pros:** No local FFmpeg.
- **Cons:** Not runnable fully in local Compose; out of stack for the course project.

**Recommendation:** **System FFmpeg/ffprobe via `child_process`** — minimal deps, Docker-installable, sufficient for duration + one-frame thumbnail.

**Decision:** A (system FFmpeg/ffprobe via child_process)

---

## TD-06: Unique Public URL (Slug)

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a stable public identifier for stream/download/metadata without colliding across channels.

**Options:**

### Option A: Opaque nanoid slug (unique DB column)
- Generate URL-safe nanoid on draft creation; unique index; public routes use `/videos/:slug/...`.
- **Pros:** Short, non-enumerable-ish, no title dependency; trivial uniqueness retry.
- **Cons:** Not human-readable.

### Option B: Title-based slug + suffix
- Derive from title; append counter on collision.
- **Pros:** Readable URLs.
- **Cons:** Title may be placeholder at upload init; renames in Fase 04 complicate stability.

### Option C: Use UUID primary key as public id
- Expose `id` in URLs.
- **Pros:** No extra column.
- **Cons:** Couples public URL to PK; longer URLs; harder to rotate identifiers later.

**Recommendation:** **Opaque nanoid slug** with UNIQUE constraint — independent of title edits in later phases.

**Decision:** A (opaque nanoid slug)

**Libraries:** — (implemented with `crypto.randomBytes` + nanoid-compatible alphabet in `slug.util.ts`; no `nanoid` package to keep Jest/CJS compatible)

---

## TD-07: Streaming and Download Strategy

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Clients must play video without downloading the entire file, and also download when requested. Auth rules differ (stream may be public for ready videos; download policy defined in Authorization Matrix).

**Options:**

### Option A: API Range proxy (206 Partial Content)
- `GET /videos/:slug/stream` reads `Range` header, fetches corresponding byte range from MinIO (`GetObject` with Range), responds 206. Separate `GET /videos/:slug/download` forces attachment disposition (full or ranged).
- **Pros:** Single origin for FE; hides bucket; works with HTML5 video Range requests; testable via e2e.
- **Cons:** API bandwidth for media; must stream carefully (no full buffer).

### Option B: Presigned GET redirect to MinIO
- API returns 302 to time-limited signed URL; browser hits MinIO directly.
- **Pros:** Offloads bandwidth.
- **Cons:** CORS/public MinIO exposure; harder auth revocation mid-play; Range behavior depends on MinIO; less control for e2e in Nest.

### Option C: HLS/DASH packaging in worker
- Transcode to adaptive streaming playlists.
- **Pros:** Production-grade playback.
- **Cons:** Far beyond Fase 03 scope (heavy processing, extra storage).

**Recommendation:** **API Range proxy + dedicated download endpoint** — satisfies “streaming without full download” with Compose-local control and clear Nest tests.

**Decision:** A (API Range/206 proxy + download endpoint)

---

## TD-08: Video Status Lifecycle

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Upload init creates a draft; processing is async; failures must be visible. Fase 04 will add publish/unpublish — this phase stops at processing readiness.

**Options:**

### Option A: draft → processing → ready | failed
- `draft` on init; `processing` when multipart completes and job is enqueued; worker sets `ready` (metadata+thumbnail) or `failed` (with error message). BullMQ retries with backoff; after max attempts remain `failed`.
- **Pros:** Clear, minimal states; maps to acceptance criteria; leaves room for Fase 04 publication states.
- **Cons:** No explicit `uploading` mid-multipart state (draft covers it).

### Option B: Fine-grained states (uploading, uploaded, probing, thumbnailing, …)
- Many intermediate statuses.
- **Pros:** Rich observability.
- **Cons:** Over-specified for this phase; more failure-edge matrix.

### Option C: Boolean flags only (`isProcessed`, `hasError`)
- No explicit status enum.
- **Pros:** Simple columns.
- **Cons:** Ambiguous combinations; poor API contract.

**Recommendation:** **draft → processing → ready | failed** with BullMQ retries (e.g. 3 attempts, exponential backoff) and `failureReason` on failed.

**Decision:** A (draft → processing → ready | failed)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Queue technology | BullMQ + Redis | A |
| TD-02 | Backend | Upload strategy (10GB) | S3/MinIO presigned multipart | A |
| TD-03 | Backend | Storage layout | Single bucket, prefixed keys | A |
| TD-04 | Backend | Worker runtime | Separate NestJS worker container | A |
| TD-05 | Backend | Processing/thumbnail | System FFmpeg/ffprobe via child_process | A |
| TD-06 | Backend | Unique public URL | Opaque nanoid slug | A |
| TD-07 | Backend | Streaming & download | API Range/206 proxy + download | A |
| TD-08 | Backend | Status lifecycle | draft → processing → ready \| failed | A |
