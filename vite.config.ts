/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Stamps today's date into the `__BUILD_DATE__` placeholder of public/sitemap.xml after it is copied to the output dir. */
function sitemapLastmod(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sitemap-lastmod',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = resolve(outDir, 'sitemap.xml');
      const today = new Date().toISOString().slice(0, 10);
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_DATE__', today));
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
  plugins: [sitemapLastmod(), ocrAssets()],
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
