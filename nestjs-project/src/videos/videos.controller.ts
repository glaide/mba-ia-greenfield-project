import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload/init')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start multipart upload and create draft video' })
  initUpload(@CurrentUser() user: JwtPayload, @Body() dto: InitUploadDto) {
    return this.videosService.initUpload(user.sub, dto);
  }

  @Post(':id/upload/parts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Presign additional multipart upload parts' })
  presignParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignPartsDto,
  ) {
    return this.videosService.presignParts(user.sub, id, dto.partNumbers);
  }

  @Post(':id/upload/complete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete multipart upload and enqueue processing' })
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get video metadata by slug' })
  findBySlug(@Param('slug') slug: string, @CurrentUser() user?: JwtPayload) {
    return this.videosService.findBySlug(slug, user?.sub);
  }

  @Public()
  @Get(':slug/stream')
  @ApiOperation({ summary: 'Stream video with optional Range support' })
  async stream(
    @Param('slug') slug: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.pipeMedia(slug, range, res, false);
  }

  @Public()
  @Get(':slug/download')
  @ApiOperation({ summary: 'Download video file' })
  async download(
    @Param('slug') slug: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.pipeMedia(slug, range, res, true);
  }

  private async pipeMedia(
    slug: string,
    range: string | undefined,
    res: Response,
    asAttachment: boolean,
  ) {
    const source = await this.videosService.getStreamSource(slug, range);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', source.contentType);
    if (source.contentLength !== undefined) {
      res.setHeader('Content-Length', String(source.contentLength));
    }
    if (source.contentRange) {
      res.setHeader('Content-Range', source.contentRange);
      res.status(206);
    } else {
      res.status(200);
    }
    if (asAttachment) {
      const filename = `${source.video.slug}.mp4`;
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
    }
    return new StreamableFile(source.body);
  }
}
