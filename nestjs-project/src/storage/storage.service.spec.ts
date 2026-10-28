import {
  buildOriginalKey,
  buildThumbnailKey,
  extensionFromFilename,
} from './storage.constants';

describe('storage.constants', () => {
  it('builds original and thumbnail keys', () => {
    expect(buildOriginalKey('abc', 'mp4')).toBe('videos/abc/original.mp4');
    expect(buildThumbnailKey('abc')).toBe('videos/abc/thumbnail.jpg');
  });

  it('extracts extension from filename', () => {
    expect(extensionFromFilename('clip.MP4')).toBe('mp4');
    expect(extensionFromFilename('noext')).toBe('bin');
  });
});
