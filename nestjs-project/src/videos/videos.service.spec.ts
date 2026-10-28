import { VideosService } from './videos.service';
import { VideoStatus } from './entities/video-status.enum';
import {
  VideoFileTooLargeException,
  VideoInvalidContentTypeException,
  VideoInvalidStatusException,
  VideoNotFoundException,
  VideoNotOwnedException,
} from './exceptions/video.exceptions';
import { MAX_VIDEO_SIZE_BYTES } from './videos.constants';

describe('VideosService', () => {
  const channel = { id: 'channel-1', user_id: 'user-1' };
  let videosRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let channelsRepository: { findOne: jest.Mock };
  let storageService: {
    originalKey: jest.Mock;
    createMultipartUpload: jest.Mock;
    presignUploadParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
  };
  let videoQueue: { add: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videosRepository = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => Promise.resolve(v)),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    channelsRepository = {
      findOne: jest.fn().mockResolvedValue(channel),
    };
    storageService = {
      originalKey: jest.fn().mockReturnValue('videos/id/original.mp4'),
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      presignUploadParts: jest
        .fn()
        .mockResolvedValue([{ partNumber: 1, url: 'http://signed' }]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    };
    videoQueue = { add: jest.fn().mockResolvedValue({}) };

    service = new VideosService(
      videosRepository as never,
      channelsRepository as never,
      storageService as never,
      videoQueue as never,
    );
  });

  describe('initUpload', () => {
    it('rejects files larger than 10GB', async () => {
      await expect(
        service.initUpload('user-1', {
          filename: 'big.mp4',
          contentType: 'video/mp4',
          sizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
          partCount: 1,
        }),
      ).rejects.toBeInstanceOf(VideoFileTooLargeException);
    });

    it('rejects non-video content types', async () => {
      await expect(
        service.initUpload('user-1', {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          partCount: 1,
        }),
      ).rejects.toBeInstanceOf(VideoInvalidContentTypeException);
    });

    it('creates a draft and returns presigned parts', async () => {
      videosRepository.findOne.mockResolvedValue(null);

      const result = await service.initUpload('user-1', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
        partCount: 1,
        title: 'My Clip',
      });

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.uploadId).toBe('upload-1');
      expect(result.parts).toHaveLength(1);
      expect(storageService.createMultipartUpload).toHaveBeenCalled();
      expect(videosRepository.save).toHaveBeenCalled();
    });
  });

  describe('completeUpload', () => {
    it('enqueues processing when multipart completes', async () => {
      videosRepository.findOne.mockResolvedValue({
        id: 'video-1',
        slug: 'slug1',
        status: VideoStatus.DRAFT,
        multipart_upload_id: 'upload-1',
        storage_key: 'videos/video-1/original.mp4',
        channel: { user_id: 'user-1' },
      });

      const result = await service.completeUpload('user-1', 'video-1', {
        uploadId: 'upload-1',
        parts: [{ partNumber: 1, etag: '"abc"' }],
      });

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(videoQueue.add).toHaveBeenCalled();
    });

    it('rejects non-owners', async () => {
      videosRepository.findOne.mockResolvedValue({
        id: 'video-1',
        status: VideoStatus.DRAFT,
        multipart_upload_id: 'upload-1',
        channel: { user_id: 'other' },
      });

      await expect(
        service.completeUpload('user-1', 'video-1', {
          uploadId: 'upload-1',
          parts: [{ partNumber: 1, etag: '"abc"' }],
        }),
      ).rejects.toBeInstanceOf(VideoNotOwnedException);
    });

    it('rejects non-draft status', async () => {
      videosRepository.findOne.mockResolvedValue({
        id: 'video-1',
        status: VideoStatus.PROCESSING,
        multipart_upload_id: null,
        channel: { user_id: 'user-1' },
      });

      await expect(
        service.completeUpload('user-1', 'video-1', {
          uploadId: 'upload-1',
          parts: [{ partNumber: 1, etag: '"abc"' }],
        }),
      ).rejects.toBeInstanceOf(VideoInvalidStatusException);
    });
  });

  describe('findBySlug', () => {
    it('hides non-ready videos from anonymous users', async () => {
      videosRepository.findOne.mockResolvedValue({
        slug: 'abc',
        status: VideoStatus.DRAFT,
        channel: { user_id: 'user-1' },
      });

      await expect(service.findBySlug('abc')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });
  });
});
