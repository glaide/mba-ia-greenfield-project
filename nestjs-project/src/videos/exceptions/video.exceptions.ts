import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoNotOwnedException extends DomainException {
  constructor() {
    super('VIDEO_NOT_OWNED', 403, 'You do not own this video');
  }
}

export class VideoInvalidStatusException extends DomainException {
  constructor(message = 'Video status does not allow this operation') {
    super('VIDEO_INVALID_STATUS', 409, message);
  }
}

export class VideoFileTooLargeException extends DomainException {
  constructor() {
    super(
      'VIDEO_FILE_TOO_LARGE',
      400,
      'Video file exceeds the maximum size of 10GB',
    );
  }
}

export class VideoInvalidContentTypeException extends DomainException {
  constructor() {
    super(
      'VIDEO_INVALID_CONTENT_TYPE',
      400,
      'Content type must be a video/* MIME type',
    );
  }
}

export class VideoUploadFailedException extends DomainException {
  constructor(message = 'Video upload failed') {
    super('VIDEO_UPLOAD_FAILED', 400, message);
  }
}
