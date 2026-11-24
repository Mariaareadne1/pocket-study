import { describe, expect, it } from 'vitest';
import { demoFileName, formatDuration, pickMime } from '@/ui/recording';

describe('demo recording helpers', () => {
  it('prefers mp4 when the browser can record it', () => {
    const picked = pickMime((m) => m.startsWith('video/mp4') || m.startsWith('video/webm'));
    expect(picked).toEqual({ mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' });
  });

  it('falls back to webm when mp4 is unsupported', () => {
    const picked = pickMime((m) => m === 'video/webm;codecs=vp8,opus');
    expect(picked).toEqual({ mime: 'video/webm;codecs=vp8,opus', ext: 'webm' });
  });

  it('returns null when nothing can be recorded, even if the probe throws', () => {
    expect(pickMime(() => false)).toBeNull();
    expect(
      pickMime(() => {
        throw new Error('no MediaRecorder');
      }),
    ).toBeNull();
  });

  it('names files with a sortable local timestamp and the right extension', () => {
    expect(demoFileName(new Date(2026, 10, 24, 9, 5, 7), 'mp4')).toBe('handheld-demo-2026-11-24-090507.mp4');
    expect(demoFileName(new Date(2026, 0, 2, 23, 59, 0), 'webm')).toBe('handheld-demo-2026-01-02-235900.webm');
  });

  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(24.4)).toBe('0:24');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
