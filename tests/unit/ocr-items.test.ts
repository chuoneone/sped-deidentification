import { describe, expect, it } from 'vitest';
import { ocrLinesToItems, type OcrLine, type OcrWord } from '../../src/formats/ocr';

const H = 20; // row height in pixels

/** Words laid left to right: [text, x0, x1, confidence?]; one CJK character per word, as Tesseract returns them. */
function line(words: [string, number, number, number?][], y = 100): OcrLine {
  const ws: OcrWord[] = words.map(([text, x0, x1, confidence = 90]) => ({ text, confidence, bbox: { x0, y0: y - H, x1, y1: y } }));
  return {
    words: ws,
    bbox: { x0: ws[0].bbox.x0, y0: y - H, x1: ws.at(-1)!.bbox.x1, y1: y },
    baseline: { x0: ws[0].bbox.x0, y0: y, x1: ws.at(-1)!.bbox.x1, y1: y },
    rowAttributes: { rowHeight: H },
  };
}

const texts = (lines: OcrLine[]) => ocrLinesToItems(lines, 1, 1000).map((it) => it.text);

describe('ocrLinesToItems', () => {
  it('joins CJK characters without spaces', () => {
    expect(texts([line([['王', 0, 18], ['小', 22, 40], ['明', 44, 62]])])).toEqual(['王小明']);
  });

  it('keeps the spaces between Latin words', () => {
    expect(texts([line([['Invoice', 0, 70], ['No.:', 76, 110], ['INV-0457', 116, 200]])])).toEqual(['Invoice No.: INV-0457']);
  });

  it('rejoins a number the recogniser cut in two', () => {
    expect(texts([line([['0918-1', 0, 60], ['54-331', 62, 120]])])).toEqual(['0918-154-331']);
    expect(texts([line([['0955', 0, 40], ['888', 47, 77], ['777', 84, 114]])])).toEqual(['0955 888 777']); // real spaces stay
  });

  it('puts no space between CJK and digits unless the gap is wide', () => {
    expect(texts([line([['五', 0, 18], ['段', 20, 38], ['37', 44, 60], ['號', 64, 82], ['3', 86, 94], ['樓', 98, 116]])])).toEqual(['五段37號3樓']);
    expect(texts([line([['電', 0, 18], ['話', 20, 38], ['(02)2700-1234', 60, 180]])])).toEqual(['電話 (02)2700-1234']);
  });

  it('starts a new run where words are far apart (table cells, form fields)', () => {
    const items = ocrLinesToItems([line([['姓', 0, 18], ['名', 22, 40], ['王', 120, 138], ['小', 142, 160], ['明', 164, 182]])], 1, 1000);
    expect(items.map((it) => it.text)).toEqual(['姓名', '王小明']);
    expect(items[1].x).toBe(120);
    expect(items[1].width).toBe(62);
  });

  it('starts a new run at a checkbox or a table rule between words, however close', () => {
    const box = { x0: 24, y0: 82, x1: 42, y1: 100 }; // ☑男 ☐女: the box between 男 and 女
    const rule = { x0: 69, y0: 60, x1: 71, y1: 140 };
    const items = ocrLinesToItems([line([['男', 0, 18], ['女', 46, 64], ['電', 74, 92], ['話', 94, 112]])], 1, 1000, { walls: [box, rule] });
    expect(items.map((it) => it.text)).toEqual(['男', '女', '電話']);
  });

  it('drops table borders read as characters', () => {
    const l = line([['姓', 0, 18], ['名', 22, 40], ['|', 60, 64, 87], ['“|「', 70, 90, 54], ['=', 95, 105, 70], ['王', 120, 138], ['小', 142, 160]]);
    expect(texts([l])).toEqual(['姓名', '王小']);
  });

  it('drops low-confidence stray symbols but keeps real punctuation', () => {
    expect(texts([line([['董', 0, 18], ['事', 20, 38], ['”', 42, 50, 48], ['長', 52, 70]])])).toEqual(['董事長']);
    expect(texts([line([['「', 0, 8, 88], ['契', 10, 28], ['約', 30, 48], ['」', 50, 58, 93]])])).toEqual(['「契約」']);
  });

  it('strips border marks stuck to Latin or digit words', () => {
    expect(texts([line([['「T153965939', 0, 130], ['0912049157”', 200, 330]])])).toEqual(['T153965939', '0912049157']);
  });

  it('converts canvas pixels to PDF points with the baseline as y', () => {
    const l = line([['Typography', 200, 400]], 306); // descenders reach below the baseline
    l.baseline = { x0: 0, y0: 300, x1: 1000, y1: 310 }; // slightly skewed scan
    const [it] = ocrLinesToItems([l], 2, 842);
    expect(it).toEqual({ text: 'Typography', x: 100, y: 842 - 302 / 2, fontSize: H / 2, width: 100 });
  });

  it('keeps a small run on its own glyphs when it shares a line with larger writing', () => {
    // Tesseract joined a printed label (bottom 300) with a big handwritten note (baseline 330).
    const l: OcrLine = {
      words: [
        { text: '正', confidence: 95, bbox: { x0: 0, y0: 280, x1: 20, y1: 300 } },
        { text: '本', confidence: 95, bbox: { x0: 22, y0: 280, x1: 42, y1: 300 } },
        { text: '改', confidence: 90, bbox: { x0: 400, y0: 280, x1: 450, y1: 330 } },
      ],
      bbox: { x0: 0, y0: 280, x1: 450, y1: 330 },
      baseline: { x0: 0, y0: 330, x1: 450, y1: 330 },
      rowAttributes: { rowHeight: 50 },
    };
    const [label, note] = ocrLinesToItems([l], 1, 1000);
    expect(label).toMatchObject({ text: '正本', y: 1000 - 300, fontSize: 24 });
    expect(note).toMatchObject({ text: '改', y: 1000 - 330, fontSize: 50 });
  });
});
