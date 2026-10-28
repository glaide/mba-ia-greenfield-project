import { generateVideoSlug } from './slug.util';
import { VIDEO_SLUG_LENGTH } from './videos.constants';

describe('generateVideoSlug', () => {
  it('returns the configured length with URL-safe alphabet', () => {
    const slug = generateVideoSlug();
    expect(slug).toHaveLength(VIDEO_SLUG_LENGTH);
    expect(slug).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('produces distinct values', () => {
    const a = generateVideoSlug();
    const b = generateVideoSlug();
    expect(a).not.toBe(b);
  });
});
