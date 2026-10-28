---
libs:
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-26T21:49:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-26T21:49:00-03:00"
  "@nestjs/bullmq":
    version: "^11.x"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-26T21:49:00-03:00"
  bullmq:
    version: "^5.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-26T21:49:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-26T21:48:38-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this phase. Context7 MCP was unavailable in the Cursor session; APIs below follow official AWS SDK v3, NestJS BullMQ, BullMQ, and nanoid documentation for the versions to be installed.

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

**Maps to:** `phase-03-videos/TD-02`, `TD-03`, `TD-07`

### Client construction (MinIO)

```typescript
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT, // http://minio:9000
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true, // required for MinIO
});
```

### Presigned upload part

```typescript
const url = await getSignedUrl(
  client,
  new UploadPartCommand({
    Bucket,
    Key,
    UploadId,
    PartNumber,
  }),
  { expiresIn: 3600 },
);
```

### Range get for streaming

```typescript
const out = await client.send(
  new GetObjectCommand({
    Bucket,
    Key,
    Range: `bytes=${start}-${end}`,
  }),
);
// out.Body is a Readable stream; out.ContentRange / ContentLength for 206 headers
```

## @nestjs/bullmq + bullmq

**Maps to:** `phase-03-videos/TD-01`, `TD-04`, `TD-08`

### Root registration

```typescript
BullModule.forRootAsync({
  useFactory: () => ({
    connection: {
      host: process.env.REDIS_HOST, // redis
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  }),
});

BullModule.registerQueue({ name: 'video-processing' });
```

### Producer

```typescript
await this.videoQueue.add(
  'process-video',
  { videoId },
  { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true },
);
```

### Worker processor

```typescript
@Processor('video-processing')
export class VideoProcessingProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> { /* ... */ }
}
```

## Opaque slug (TD-06)

Implemented via `src/videos/slug.util.ts` (`crypto.randomBytes` + nanoid-compatible alphabet). No `nanoid` package — avoids ESM/Jest friction while preserving opaque unique slugs.

## FFmpeg / ffprobe (system binaries)

**Maps to:** `phase-03-videos/TD-05`

```bash
ffprobe -v quiet -print_format json -show_format -show_streams <input>
ffmpeg -y -ss 00:00:01 -i <input> -vframes 1 -q:v 2 <output.jpg>
```

Install in worker image: `apt-get install -y ffmpeg`.
