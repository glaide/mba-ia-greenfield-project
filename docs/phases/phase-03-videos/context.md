---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-01T21:21:28-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-26T21:48:38-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T12:23:19-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-05-12T12:21:12-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-01T21:21:28-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Frontend video UI/player; publish/unpublish; categories; custom thumbnail upload; comments; likes; subscriptions (Fases 04+).

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — video upload UI and player deferred to later phases.

**Sequencing notes:** Depends on Fase 01 and Fase 02 (auth, users, channels 1:1).

**Neighbors (for boundary detection only):** Fase 02 — Auth (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

**UI in scope:** false (backend-only)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Queue technology | decided | A (BullMQ + Redis) | @nestjs/bullmq, bullmq, ioredis |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Upload strategy (10GB) | decided | A (S3/MinIO presigned multipart) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Storage layout | decided | A (single bucket, prefixed keys) | @aws-sdk/client-s3 |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Worker runtime | decided | A (separate NestJS worker container) | — |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Processing/thumbnail | decided | A (system FFmpeg/ffprobe via child_process) | — (system ffmpeg) |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Unique public URL | decided | A (opaque nanoid-compatible slug) | crypto (slug.util) |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Streaming & download | decided | A (API Range/206 proxy + download) | @aws-sdk/client-s3 |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Status lifecycle | decided | A (draft → processing → ready \| failed) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-08 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-05, phase-03-videos/TD-04, phase-03-videos/TD-08 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-05 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis — NestJS-native, matches the separate-worker architecture, and keeps Compose simple for a single job type.

**Libraries:** `@nestjs/bullmq`, `bullmq`, `ioredis`

### phase-03-videos/TD-02

**Recommendation:** Presigned multipart to MinIO — only strategy that meets the “do not freeze the API” criterion without adding a second upload protocol stack.

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### phase-03-videos/TD-03

**Recommendation:** Single bucket with prefixed keys — minimal Compose config; keys stored on the Video entity for streaming/download/thumbnail.

**Libraries:** `@aws-sdk/client-s3`

### phase-03-videos/TD-04

**Recommendation:** Separate NestJS worker Compose service with FFmpeg in the image.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** System FFmpeg/ffprobe via `child_process` — minimal deps, Docker-installable, sufficient for duration + one-frame thumbnail.

**Libraries:** — (system `ffmpeg` / `ffprobe`)

### phase-03-videos/TD-06

**Recommendation:** Opaque nanoid slug with UNIQUE constraint — independent of title edits in later phases.

**Libraries:** `nanoid`

### phase-03-videos/TD-07

**Recommendation:** API Range proxy + dedicated download endpoint — satisfies streaming without full download with Compose-local control and clear Nest tests.

**Libraries:** `@aws-sdk/client-s3`

### phase-03-videos/TD-08

**Recommendation:** draft → processing → ready | failed with BullMQ retries and `failureReason` on failed.

**Libraries:** —

## Inherited Decisions Detail

### phase-02-auth/TD-02

**Recommendation:** Custom JWT guards with `@nestjs/jwt` — global `JwtAuthGuard` + `@Public()` for anonymous access.

**Libraries:** `@nestjs/jwt`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — `{ statusCode, error, message }` with machine-readable error codes.

**Libraries:** —

## Inherited Conventions

- Portuguese prose + English identifiers in plans
- SI numbering `SI-NN.N`; Technical Specs include Data Model, API Contracts, Authorization Matrix, Error Catalog
- Module shape mirrors `auth/` (controller, service, entities, dto, module)
- Domain exceptions extend `DomainException`; repository via TypeORM `Repository<T>` / services
- Tests: `*.spec.ts`, `*.integration-spec.ts`, `*.e2e-spec.ts`; integration/e2e `--runInBand`
- Docker Compose service names as hosts (`db`, never `localhost` inside containers)
- Migrations: `{timestamp}-{PascalName}.ts` under `src/database/migrations/`

## Inherited Deferred Capabilities

_None relevant from prior phases for video upload._

## Non-UI / Deferred Capabilities

| Capability | Status | Notes |
|------------|--------|-------|
| Frontend upload UI / player | deferred | next-frontend out of scope |
| Publish / categories / custom thumbnail | deferred | Fase 04 |

## Testing Requirements

Follow `.claude/skills/testing-guide-nestjs-project/SKILL.md`. Prefer real MinIO/Redis/Postgres via Compose for integration tests; do not mock storage/queue when infra is available. Track results in `progress.md`.
