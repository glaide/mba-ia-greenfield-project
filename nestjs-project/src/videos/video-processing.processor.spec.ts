import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoStatus } from './entities/video-status.enum';
import * as ffmpegUtil from './ffmpeg.util';

jest.mock('./ffmpeg.util');

describe('VideoProcessingProcessor', () => {
  const videosRepository = { findOne: jest.fn() };
  const storageService = {
    downloadToBuffer: jest.fn(),
    thumbnailKey: jest.fn().mockReturnValue('videos/v1/thumbnail.jpg'),
    putObject: jest.fn(),
  };
  const videosService = {
    markReady: jest.fn(),
    markFailed: jest.fn(),
  };

  let processor: VideoProcessingProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new VideoProcessingProcessor(
      videosRepository as never,
      storageService as never,
      videosService as never,
    );
  });

  it('marks video ready after successful processing', async () => {
    videosRepository.findOne.mockResolvedValue({
      id: 'v1',
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/v1/original.mp4',
    });
    storageService.downloadToBuffer.mockResolvedValue(Buffer.from('video'));
    (ffmpegUtil.writeTempFile as jest.Mock).mockResolvedValue('/tmp/in.mp4');
    (ffmpegUtil.probeVideo as jest.Mock).mockResolvedValue({
      durationSeconds: 12.5,
      metadata: { format: {} },
    });
    (ffmpegUtil.extractThumbnail as jest.Mock).mockResolvedValue(
      Buffer.from('jpg'),
    );
    (ffmpegUtil.cleanupTempFile as jest.Mock).mockResolvedValue(undefined);

    await processor.process({
      name: 'process-video',
      data: { videoId: 'v1' },
    } as never);

    expect(videosService.markReady).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        durationSeconds: 12.5,
        thumbnailKey: 'videos/v1/thumbnail.jpg',
      }),
    );
  });

  it('marks failed and rethrows on processing error', async () => {
    videosRepository.findOne.mockResolvedValue({
      id: 'v1',
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/v1/original.mp4',
    });
    storageService.downloadToBuffer.mockRejectedValue(new Error('boom'));

    await expect(
      processor.process({
        name: 'process-video',
        data: { videoId: 'v1' },
      } as never),
    ).rejects.toThrow('boom');

    expect(videosService.markFailed).toHaveBeenCalledWith('v1', 'boom');
  });
});
