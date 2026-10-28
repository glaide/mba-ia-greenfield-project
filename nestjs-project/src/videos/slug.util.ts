import { randomBytes } from 'crypto';
import { VIDEO_SLUG_LENGTH } from './videos.constants';

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Opaque URL-safe slug (nanoid-compatible alphabet, crypto-backed). */
export function generateVideoSlug(length = VIDEO_SLUG_LENGTH): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return slug;
}
