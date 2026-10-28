export const STORAGE_CONFIG_KEY = 'storage';

export function buildOriginalKey(videoId: string, extension = 'bin'): string {
  return `videos/${videoId}/original.${extension}`;
}

export function buildThumbnailKey(videoId: string): string {
  return `videos/${videoId}/thumbnail.jpg`;
}

export function extensionFromFilename(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) {
    return 'bin';
  }
  const ext = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}
