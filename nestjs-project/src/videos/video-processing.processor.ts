import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJobPayload,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { extensionFromFilename } from '../storage/storage.constants';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import {
  cleanupTempFile,
  extractThumbnail,
  probeVideo,
  writeTempFile,
} from './ffmpeg.util';
import { VideosService } from './videos.service';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videosRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly videosService: VideosService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobPayload>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB) {
      return;
    }

    const { videoId } = job.data;
    const video = await this.videosRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      this.logger.warn(`Video ${videoId} not found — skipping`);
      return;
    }
    if (video.status === VideoStatus.READY) {
      return;
    }

    let tempPath: string | null = null;
    try {
      const buffer = await this.storageService.downloadToBuffer(
        video.storage_key,
      );
      const ext = extensionFromFilename(video.storage_key);
      tempPath = await writeTempFile(buffer, ext);

      const probe = await probeVideo(tempPath);
      const thumbBuffer = await extractThumbnail(
        tempPath,
        probe.durationSeconds,
      );
      const thumbnailKey = this.storageService.thumbnailKey(video.id);
      await this.storageService.putObject(
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      await this.videosService.markReady(video.id, {
        durationSeconds: probe.durationSeconds,
        metadata: probe.metadata,
        thumbnailKey,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Processing failed';
      this.logger.error(`Processing failed for ${videoId}: ${message}`);
      await this.videosService.markFailed(videoId, message);
      throw error;
    } finally {
      if (tempPath) {
        await cleanupTempFile(tempPath);
      }
    }
  }
}
