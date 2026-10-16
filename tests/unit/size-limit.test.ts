import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../../src/core/types';
import { rejectOversized } from '../../src/ui/components';

/** A tiny File that reports the given size, so the test does not allocate 100 MB. */
function fileOfSize(name: string, size: number): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

beforeAll(() => {
  // jsdom has <dialog> but not its modal API.
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('rejectOversized', () => {
  it('allows files up to 100 MB without asking', async () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
    const files = [fileOfSize('a.pdf', MAX_FILE_BYTES), fileOfSize('b.txt', 10)];
    expect(await rejectOversized(files)).toEqual(files);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('blocks with a dialog listing the oversized files until acknowledged, then keeps the rest', async () => {
    const small = fileOfSize('ok.docx', 1024);
    const done = rejectOversized([fileOfSize('掃描檔.pdf', MAX_FILE_BYTES + 1), small]);

    const dialog = document.querySelector<HTMLDialogElement>('dialog.alert-dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('超過 100 MB 上限');
    expect(dialog.textContent).toContain('掃描檔.pdf（100.0 MB）');

    let settled = false;
    void done.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // nothing loads until the warning is dismissed

    dialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(await done).toEqual([small]);
    expect(document.querySelector('dialog')).toBeNull();
  });
});
