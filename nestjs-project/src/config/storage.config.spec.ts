import storageConfig from './storage.config';

describe('storageConfig', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('maps S3 env keys with defaults', () => {
    process.env = {
      ...originalEnv,
      S3_ENDPOINT: 'http://minio:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'streamtube',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_PRESIGN_EXPIRES_SECONDS: '1800',
    };

    const config = storageConfig();

    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.bucket).toBe('streamtube');
    expect(config.presignExpiresSeconds).toBe(1800);
    expect(config.accessKey).toBe('key');
  });
});
