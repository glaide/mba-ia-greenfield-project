import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosModule providers', () => {
  it('VideosService compiles with mocked dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: {} },
        { provide: getRepositoryToken(Channel), useValue: {} },
        {
          provide: StorageService,
          useValue: { onModuleInit: jest.fn() },
        },
        {
          provide: `BullQueue_${VIDEO_PROCESSING_QUEUE}`,
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    expect(moduleRef.get(VideosService)).toBeDefined();
    await moduleRef.close();
  });
});
