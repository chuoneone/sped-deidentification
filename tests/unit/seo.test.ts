import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// index.html carries the page's search and AI-answer metadata; the app replaces only #app's fallback.
const html = readFileSync('index.html', 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');
const graph: Record<string, unknown>[] = JSON.parse(page.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'];
const node = (type: string) => graph.find((g) => g['@type'] === type) as Record<string, any>;

describe('index.html search metadata', () => {
  it('has a title, description, canonical URL and the structured data types', () => {
    expect(page.title).toContain('去識別化');
    expect(page.querySelector('meta[name=description]')!.getAttribute('content')!.length).toBeGreaterThan(80);
    expect(page.querySelector('link[rel=canonical]')!.getAttribute('href')).toBe('https://deanlin.net/data-deidentification/');
    expect(graph.map((g) => g['@type'])).toEqual(expect.arrayContaining(['WebSite', 'WebPage', 'WebApplication', 'HowTo', 'FAQPage']));
    expect(node('WebPage').dateModified).toBe('__BUILD_DATE__'); // stamped at build time
  });

  it('answers every FAQ in the structured data word for word as the visible page does', () => {
    const visible = [...page.querySelectorAll('#faq details')].map((d) => [d.querySelector('summary')!.textContent!.trim(), d.querySelector('p')!.textContent!.trim()]);
    const structured = node('FAQPage').mainEntity.map((q: any) => [q.name, q.acceptedAnswer.text]);
    expect(structured).toEqual(visible);
  });

  it('lists the how-to steps in order', () => {
    const steps = node('HowTo').step;
    expect(steps.map((s: any) => s.position)).toEqual(steps.map((_: unknown, i: number) => i + 1));
    expect(steps.length).toBeGreaterThanOrEqual(5);
  });
});
