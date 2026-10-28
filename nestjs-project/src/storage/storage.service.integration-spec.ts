import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let storage: StorageService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    storage = moduleRef.get(StorageService);
    await storage.ensureBucket();
  });

  it('puts an object and reads a byte range back', async () => {
    const key = `tests/${Date.now()}-object.bin`;
    const payload = Buffer.from('hello-streamtube-storage');
    await storage.putObject(key, payload, 'application/octet-stream');

    const ranged = await storage.getObjectStream(key, 'bytes=0-4');
    const chunks: Buffer[] = [];
    for await (const chunk of ranged.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    expect(ranged.contentRange).toBeDefined();
  });

  it('creates multipart upload ids', async () => {
    const key = `tests/${Date.now()}-mpu.bin`;
    const uploadId = await storage.createMultipartUpload(
      key,
      'application/octet-stream',
    );
    expect(uploadId).toBeTruthy();
    await storage.abortMultipartUpload(key, uploadId);
  });
});
