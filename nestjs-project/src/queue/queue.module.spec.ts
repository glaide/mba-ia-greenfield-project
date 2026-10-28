import { VIDEO_PROCESSING_QUEUE, PROCESS_VIDEO_JOB } from './queue.constants';

describe('queue.constants', () => {
  it('exposes stable queue and job names', () => {
    expect(VIDEO_PROCESSING_QUEUE).toBe('video-processing');
    expect(PROCESS_VIDEO_JOB).toBe('process-video');
  });
});
