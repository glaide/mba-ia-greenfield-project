import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/entities/video-status.enum';
import { VideosService } from '../src/videos/videos.service';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videosService: VideosService;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    videosService = moduleFixture.get(VideosService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as {
        mailService: {
          sendConfirmationEmail: (
            e: string,
            n: string,
            t: string,
          ) => Promise<void>;
        };
      }
    ).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return login.body.access_token as string;
  }

  it('requires auth for upload init', async () => {
    await request(app.getHttpServer())
      .post('/videos/upload/init')
      .send({
        filename: 'a.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10,
        partCount: 1,
      })
      .expect(401);
  });

  it('inits draft upload, completes multipart, and streams when ready', async () => {
    const accessToken = await registerConfirmAndLogin('uploader@example.com');

    const init = await request(app.getHttpServer())
      .post('/videos/upload/init')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Demo',
        filename: 'demo.mp4',
        contentType: 'video/mp4',
        sizeBytes: 11,
        partCount: 1,
      })
      .expect(201);

    expect(init.body.status).toBe(VideoStatus.DRAFT);
    expect(init.body.uploadId).toBeDefined();
    expect(init.body.parts[0].url).toContain('http');

    const payload = Buffer.from('hello-video');
    const putRes = await fetch(init.body.parts[0].url as string, {
      method: 'PUT',
      body: payload,
    });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    const complete = await request(app.getHttpServer())
      .post(`/videos/${init.body.id}/upload/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        uploadId: init.body.uploadId,
        parts: [{ partNumber: 1, etag }],
      })
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    expect(complete.body.status).toBe(VideoStatus.PROCESSING);

    // Simulate worker success (worker may not finish within e2e window)
    await videosService.markReady(init.body.id as string, {
      durationSeconds: 1.5,
      metadata: { format: { format_name: 'mp4' } },
      thumbnailKey: `videos/${init.body.id}/thumbnail.jpg`,
    });

    const meta = await request(app.getHttpServer())
      .get(`/videos/${init.body.slug}`)
      .expect(200);
    expect(meta.body.status).toBe(VideoStatus.READY);
    expect(meta.body.durationSeconds).toBe(1.5);

    const stream = await request(app.getHttpServer())
      .get(`/videos/${init.body.slug}/stream`)
      .set('Range', 'bytes=0-4')
      .buffer()
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk: Buffer) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(206);
    expect(stream.headers['content-range']).toMatch(/bytes 0-4\//);
    expect(Buffer.isBuffer(stream.body) ? stream.body.toString() : '').toBe(
      'hello',
    );

    const download = await request(app.getHttpServer())
      .get(`/videos/${init.body.slug}/download`)
      .expect(200);
    expect(download.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 404 for unknown slug', async () => {
    await request(app.getHttpServer()).get('/videos/unknownslug1').expect(404);
  });

  it('marks failure reason when processing fails', async () => {
    const accessToken = await registerConfirmAndLogin('fail@example.com');
    const init = await request(app.getHttpServer())
      .post('/videos/upload/init')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        filename: 'x.mp4',
        contentType: 'video/mp4',
        sizeBytes: 5,
        partCount: 1,
      })
      .expect(201);

    await videosService.markFailed(init.body.id as string, 'ffprobe failed');
    const video = await videoRepository.findOneByOrFail({
      id: init.body.id as string,
    });
    expect(video.status).toBe(VideoStatus.FAILED);
    expect(video.failure_reason).toContain('ffprobe');
  });
});
