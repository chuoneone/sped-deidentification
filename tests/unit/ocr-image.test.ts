import { describe, expect, it } from 'vitest';
import { fixConfusables, holdsText, pictureCandidates, removeRules, uncoveredText, type OcrWord, type Raster } from '../../src/formats/ocr';

/** A white RGBA raster with filled rectangles of the given grey level. */
function raster(w: number, h: number, rects: [number, number, number, number, number][]): Raster {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1, v] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}
const grey = (img: Raster, x: number, y: number) => img.data[(y * img.width + x) * 4];
const word = (text: string, confidence: number, x0: number, y0: number, x1: number, y1: number): OcrWord => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe('fixConfusables', () => {
  it('reads look-alike letters as digits when the result is a valid ID, phone or tax number', () => {
    expect(fixConfusables('身分證 DI32062529')).toBe('身分證 D132062529');
    expect(fixConfusables('Ji76514076')).toBe('J176514076');
    expect(fixConfusables('手機 0g78-762-594')).toBe('手機 0978-762-594');
    expect(fixConfusables('O912-345-678')).toBe('0912-345-678');
    expect(fixConfusables('統編 3O419191')).toBe('統編 30419191');
  });

  it('leaves alone what would not validate, and ordinary words and codes', () => {
    expect(fixConfusables('DI32062528')).toBe('DI32062528'); // checksum fails
    for (const s of ['INV-2026-10-0457', 'PO-115-0398', 'SC-2026-0917', 'A123456789', 'Big Solid State', 'lu.cheng.chi37@example.com']) {
      expect(fixConfusables(s)).toBe(s);
    }
  });
});

describe('removeRules', () => {
  it('whitens long straight rules but keeps character strokes', () => {
    const img = raster(300, 120, [
      [0, 60, 300, 62, 0], // table rule
      [10, 0, 12, 120, 0], // cell border
      [150, 10, 170, 40, 0], // a glyph
    ]);
    removeRules(img, 80);
    expect(grey(img, 200, 60)).toBe(255);
    expect(grey(img, 10, 100)).toBe(255);
    expect(grey(img, 160, 20)).toBe(0);
  });
});

describe('pictureCandidates', () => {
  // 600×600 page: a solid photo, a thin stamp-like frame and a short rule.
  const page = () =>
    raster(600, 600, [
      [96, 96, 312, 252, 90],
      [400, 400, 520, 403, 40], [400, 517, 520, 520, 40], [400, 400, 403, 520, 40], [517, 400, 520, 520, 40],
      [50, 560, 550, 563, 0],
    ]);

  it('finds solid pictures and skips frames, stamps and rules', () => {
    const [photo, ...rest] = pictureCandidates(page(), []);
    expect(rest).toEqual([]);
    expect(photo.x0).toBeLessThanOrEqual(96);
    expect(photo.x1).toBeGreaterThanOrEqual(312);
    expect(photo.y0).toBeLessThanOrEqual(96);
    expect(photo.y1).toBeGreaterThanOrEqual(252);
  });

  it('treats faint words inside a picture as noise but rejects a picture holding text', () => {
    expect(pictureCandidates(page(), [word('ra', 58, 150, 150, 170, 165)])).toHaveLength(1);
    expect(pictureCandidates(page(), [word('0912', 92, 150, 150, 220, 170)])).toHaveLength(0);
  });
});

describe('holdsText', () => {
  const region = { x0: 0, y0: 0, x1: 200, y1: 200 };
  it('is true for a confident word, several half-confident words, or a word crossing the edge', () => {
    expect(holdsText(region, [word('王小明', 90, 10, 10, 80, 40)])).toBe(true);
    expect(holdsText(region, [word('ab', 65, 10, 10, 30, 30), word('cd', 62, 40, 10, 60, 30), word('ef', 70, 70, 10, 90, 30)])).toBe(true);
    expect(holdsText(region, [word('Item', 50, 180, 190, 260, 220)])).toBe(true);
  });
  it('is false for a few scattered low-confidence fragments or symbols', () => {
    expect(holdsText(region, [word('ra', 58, 10, 10, 30, 30), word('EF', 58, 40, 40, 60, 60), word('fe', 35, 80, 80, 100, 100), word('—', 90, 120, 120, 140, 130)])).toBe(false);
  });
});

describe('uncoveredText', () => {
  // A line of five glyphs (x 100–284, y 100–124), and a stamp: four large glyphs set far apart in a
  // square (its frame is a rule, already removed by removeRules).
  const glyphs: [number, number, number, number, number][] = [100, 140, 180, 220, 260].map((x) => [x, 100, x + 24, 124, 0]);
  const stamp: [number, number, number, number, number][] = [[400, 400, 440, 440, 0], [490, 400, 530, 440, 0], [400, 490, 440, 530, 0], [490, 490, 530, 530, 0]];
  const page = () => raster(600, 600, [...glyphs, ...stamp]);

  it('finds a line of ink that no word covers, but not a square stamp', () => {
    const [gap, ...rest] = uncoveredText(page(), [], []);
    expect(rest).toEqual([]);
    expect(gap.x0).toBeLessThanOrEqual(100);
    expect(gap.x1).toBeGreaterThanOrEqual(284);
    expect(gap.y0).toBeLessThanOrEqual(100);
  });

  it('skips lines already read and pictures', () => {
    expect(uncoveredText(page(), [{ x0: 95, y0: 95, x1: 290, y1: 130 }], [])).toEqual([]);
    expect(uncoveredText(page(), [], [{ x0: 90, y0: 90, x1: 300, y1: 130 }])).toEqual([]);
  });
});
