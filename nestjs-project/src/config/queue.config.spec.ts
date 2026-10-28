import queueConfig from './queue.config';

describe('queueConfig', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('maps Redis env keys with defaults', () => {
    process.env = {
      ...originalEnv,
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
    };

    const config = queueConfig();

    expect(config.redisHost).toBe('redis');
    expect(config.redisPort).toBe(6379);
  });
});
