import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJobPayload,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import {
  VideoFileTooLargeException,
  VideoInvalidContentTypeException,
  VideoInvalidStatusException,
  VideoNotFoundException,
  VideoNotOwnedException,
  VideoUploadFailedException,
} from './exceptions/video.exceptions';
import { generateVideoSlug } from './slug.util';
import {
  DEFAULT_PART_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  VIDEO_SLUG_LENGTH,
} from './videos.constants';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videosRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelsRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<ProcessVideoJobPayload>,
  ) {}

  async initUpload(userId: string, dto: InitUploadDto) {
    if (dto.sizeBytes > MAX_VIDEO_SIZE_BYTES) {
      throw new VideoFileTooLargeException();
    }
    if (!dto.contentType.startsWith('video/')) {
      throw new VideoInvalidContentTypeException();
    }

    const channel = await this.channelsRepository.findOne({
      where: { user_id: userId },
    });
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const id = crypto.randomUUID();
    const slug = await this.generateUniqueSlug();
    const storageKey = this.storageService.originalKey(id, dto.filename);
    const title =
      dto.title?.trim() ||
      dto.filename.replace(/\.[^.]+$/, '').slice(0, 200) ||
      'Untitled';

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.contentType,
    );

    const video = this.videosRepository.create({
      id,
      channel_id: channel.id,
      title,
      slug,
      status: VideoStatus.DRAFT,
      storage_key: storageKey,
      thumbnail_key: null,
      content_type: dto.contentType,
      size_bytes: String(dto.sizeBytes),
      duration_seconds: null,
      metadata: null,
      multipart_upload_id: uploadId,
      failure_reason: null,
    });
    await this.videosRepository.save(video);

    const partNumbers = Array.from({ length: dto.partCount }, (_, i) => i + 1);
    const parts = await this.storageService.presignUploadParts(
      storageKey,
      uploadId,
      partNumbers,
    );

    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
      uploadId,
      key: storageKey,
      partSize: DEFAULT_PART_SIZE_BYTES,
      parts,
    };
  }

  async presignParts(userId: string, videoId: string, partNumbers: number[]) {
    const video = await this.requireOwnedDraft(userId, videoId);
    if (!video.multipart_upload_id) {
      throw new VideoInvalidStatusException('Multipart upload is not active');
    }
    const parts = await this.storageService.presignUploadParts(
      video.storage_key,
      video.multipart_upload_id,
      partNumbers,
    );
    return { parts };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ) {
    const video = await this.requireOwnedDraft(userId, videoId);
    if (
      !video.multipart_upload_id ||
      video.multipart_upload_id !== dto.uploadId
    ) {
      throw new VideoInvalidStatusException('Upload id mismatch');
    }

    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        dto.uploadId,
        dto.parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Multipart complete failed';
      throw new VideoUploadFailedException(message);
    }

    video.status = VideoStatus.PROCESSING;
    video.multipart_upload_id = null;
    video.failure_reason = null;
    await this.videosRepository.save(video);

    await this.videoQueue.add(PROCESS_VIDEO_JOB, { videoId: video.id });

    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
    };
  }

  async findBySlug(slug: string, requesterUserId?: string) {
    const video = await this.videosRepository.findOne({
      where: { slug },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      const isOwner =
        !!requesterUserId && video.channel?.user_id === requesterUserId;
      if (!isOwner) {
        throw new VideoNotFoundException();
      }
    }

    return this.toPublicVideo(video);
  }

  async getStreamSource(slug: string, rangeHeader?: string) {
    const video = await this.videosRepository.findOne({ where: { slug } });
    if (!video || video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }
    const object = await this.storageService.getObjectStream(
      video.storage_key,
      rangeHeader,
    );
    return {
      video,
      ...object,
      contentType: object.contentType ?? video.content_type,
    };
  }

  async markReady(
    videoId: string,
    data: {
      durationSeconds: number;
      metadata: Record<string, unknown>;
      thumbnailKey: string;
    },
  ): Promise<void> {
    const video = await this.videosRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      return;
    }
    video.status = VideoStatus.READY;
    video.duration_seconds = data.durationSeconds;
    video.metadata = data.metadata;
    video.thumbnail_key = data.thumbnailKey;
    video.failure_reason = null;
    await this.videosRepository.save(video);
  }

  async markFailed(videoId: string, reason: string): Promise<void> {
    const video = await this.videosRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      return;
    }
    video.status = VideoStatus.FAILED;
    video.failure_reason = reason.slice(0, 2000);
    await this.videosRepository.save(video);
  }

  async findById(videoId: string): Promise<Video | null> {
    return this.videosRepository.findOne({ where: { id: videoId } });
  }

  private async requireOwnedDraft(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videosRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel.user_id !== userId) {
      throw new VideoNotOwnedException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoInvalidStatusException();
    }
    return video;
  }

  private async generateUniqueSlug(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = generateVideoSlug(VIDEO_SLUG_LENGTH);
      const existing = await this.videosRepository.findOne({ where: { slug } });
      if (!existing) {
        return slug;
      }
    }
    return generateVideoSlug(VIDEO_SLUG_LENGTH + 4);
  }

  private toPublicVideo(video: Video) {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      durationSeconds: video.duration_seconds,
      thumbnailKey: video.thumbnail_key,
      contentType: video.content_type,
      sizeBytes: Number(video.size_bytes),
      failureReason: video.failure_reason,
      channel: video.channel
        ? {
            id: video.channel.id,
            nickname: video.channel.nickname,
            name: video.channel.name,
          }
        : null,
    };
  }
}
