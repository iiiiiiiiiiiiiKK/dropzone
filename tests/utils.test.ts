import { describe, expect, it } from 'vitest';
import { clamp, fileKind, formatBytes, formatDuration, fromBase64Url, safeFileName, toBase64Url } from '../src/lib/utils';

describe('formatBytes', () => {
  it('keeps human units stable', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('renders compact spans', () => {
    expect(formatDuration(0.4)).toBe('<1s');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3700)).toBe('1h 1m');
  });
});

describe('fileKind', () => {
  it('detects the formats the product advertises', () => {
    expect(fileKind('shot.png')).toBe('image');
    expect(fileKind('clip.webp', 'image/webp')).toBe('image');
    expect(fileKind('report.pdf')).toBe('pdf');
    expect(fileKind('bundle.zip')).toBe('archive');
    expect(fileKind('sheet.xlsx')).toBe('sheet');
    expect(fileKind('deck.pptx')).toBe('slide');
    expect(fileKind('main.ts')).toBe('code');
    expect(fileKind('notes.md')).toBe('text');
    expect(fileKind('mystery')).toBe('file');
    expect(fileKind('movie.mp4')).toBe('video');
  });
});

describe('safeFileName', () => {
  it('strips control characters and traversal segments', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('a\u0000b.txt')).toBe('ab.txt');
    expect(safeFileName('   ')).toBe('untitled');
    expect(safeFileName('normal name.txt')).toBe('normal name.txt');
  });
});

describe('base64url', () => {
  it('round trips binary payloads', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = toBase64Url(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
  });
});

describe('clamp', () => {
  it('bounds values', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
