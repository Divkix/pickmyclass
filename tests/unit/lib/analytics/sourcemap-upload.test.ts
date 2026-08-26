import { describe, expect, it } from 'vite-plus/test';
import { shouldUploadPosthogSourcemaps } from '@/lib/analytics/sourcemap-upload';

describe('shouldUploadPosthogSourcemaps', () => {
  it('never uploads on ordinary builds', () => {
    expect(shouldUploadPosthogSourcemaps(false, 'phx_key', '12345')).toBe(false);
  });

  it('skips upload when the deploy flag is set but credentials are missing', () => {
    expect(shouldUploadPosthogSourcemaps(true, undefined, undefined)).toBe(false);
    expect(shouldUploadPosthogSourcemaps(true, '', '12345')).toBe(false);
    expect(shouldUploadPosthogSourcemaps(true, 'phx_key', '')).toBe(false);
  });

  it('uploads when the deploy flag and both credentials are present', () => {
    expect(shouldUploadPosthogSourcemaps(true, 'phx_key', '12345')).toBe(true);
  });
});
