/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Stamps today's date into the `__BUILD_DATE__` placeholders: index.html (the page's last update and
 * dateModified) and public/sitemap.xml, the latter after it is copied to the output dir.
 */
function buildDate(): Plugin {
  let outDir = 'dist';
  return {
    name: 'build-date',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: (html) => html.replaceAll('__BUILD_DATE__', today()),
    closeBundle() {
      const file = resolve(outDir, 'sitemap.xml');
      try {
        writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_DATE__', today()));
      } catch {
        // not a site build (e.g. the test runner)
      }
    },
  };
}

const REPO = 'https://github.com/chuoneone/sped-deidentification';

/**
 * llms-full.txt: the README as plain Markdown for AI crawlers and agents (llmstxt.org), without the
 * screenshots and badges, and with its relative links made absolute.
 */
function llmsFull(): Plugin {
  let root = '.';
  return {
    name: 'llms-full',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
        .replace(/^\[?!\[[^\]]*\]\([^)]*\)(\]\([^)]*\))?\s*$/gm, '') // images and image badges on their own line
        .replace(/<p align="center">[\s\S]*?<\/p>\n?/g, '') // the centred screenshot
        .replace(/\]\(#([^)]+)\)/g, `](${REPO}#$1)`)
        .replace(/\]\((?!https?:|mailto:)([^)]+)\)/g, `](${REPO}/blob/main/$1)`)
        .replace(/\n{3,}/g, '\n\n');
      const header = `> 本檔為 ${REPO} 的 README（完整操作說明），提供給 AI 搜尋與代理程式閱讀；網站摘要見 llms.txt。更新：${today()}\n\n`;
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: readme.replace(/^(# .*\n)/, `$1\n${header}`) });
    },
  };
}

/**
 * The OCR worker, engine and language models, served from this site under fixed names (tesseract.js
 * picks the core variant by file name and otherwise downloads everything from a CDN).
 * See specs/004-scanned-pdf-ocr/contracts/ocr-assets.md.
 */
const OCR_ASSETS: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  ...Object.fromEntries(
    ['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [`ocr/core/tesseract-core-${v}.wasm.js`, `node_modules/tesseract.js-core/tesseract-core-${v}.wasm.js`]),
  ),
  ...Object.fromEntries(
    ['chi_tra', 'eng'].map((l) => [`ocr/lang/${l}.traineddata.gz`, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`]),
  ),
};

function ocrAssets(): Plugin {
  let root = '.';
  return {
    name: 'ocr-assets',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const src = OCR_ASSETS[(req.url ?? '').split('?')[0].replace(/^\//, '')];
        if (!src) return next();
        res.setHeader('Content-Type', src.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(resolve(root, src)));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(OCR_ASSETS)) this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, src)) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [buildDate(), llmsFull(), ocrAssets()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // PDF/docx round-trips embed fonts and zip files; give them headroom on slow CI runners.
    testTimeout: 30000,
  },
});
