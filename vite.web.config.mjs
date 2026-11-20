import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { parse as parseYaml } from 'yaml';
import { nimiWebViteConfig } from '@nimiplatform/app-tools/web';
import { readMobileAccess } from './scripts/mobile-config.mjs';

const repoRoot = import.meta.dirname;
const webRoot = path.join(repoRoot, 'web');
const spaRoot = path.join(repoRoot, 'web-spa');
const webRequire = createRequire(path.join(webRoot, 'package.json'));

const PUBLIC_STATIC_DIRS = ['brand', 'icons', 'provider-icons', 'images'];
const EXECUTABLE_EXT = /\.(?:[cm]?js|css|wasm)$/iu;

function copyFilteredDir(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(srcPath, destPath);
    } else if (entry.isFile() && !EXECUTABLE_EXT.test(entry.name)) {
      cpSync(srcPath, destPath);
    }
  }
}

function compactEnglishLocalePlugin() {
  const enLocalePath = path.normalize(path.join(webRoot, 'locales', 'en', 'app.json'));
  return {
    name: 'deeptutor-compact-en-locale',
    enforce: 'pre',
    load(id) {
      const cleanId = path.normalize(id.split('?')[0]);
      if (cleanId !== enLocalePath) return null;
      const parsed = JSON.parse(readFileSync(cleanId, 'utf8'));
      const identities = [];
      const translations = [];
      for (const [key, value] of Object.entries(parsed)) {
        if (key === value) identities.push(key);
        else translations.push([key, value]);
      }
      return {
        moduleType: 'js',
        code: `export default Object.fromEntries([
          ...${JSON.stringify(identities)}.map((key) => [key, key]),
          ...${JSON.stringify(translations)}
        ]);`,
      };
    },
  };
}

function staticPublicAssetsPlugin({ release, version }) {
  const pdfjsPrefix = release ? `_releases/${version}/pdfjs` : 'pdfjs';
  const publicRoot = path.join(webRoot, 'public');

  const mimeFor = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.ico') return 'image/x-icon';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.wasm') return 'application/wasm';
    if (ext === '.js' || ext === '.mjs') return 'application/javascript';
    return 'application/octet-stream';
  };

  return {
    name: 'deeptutor-web-public-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (!urlPath.startsWith('/')) return next();
        const topSeg = urlPath.slice(1).split('/')[0];
        if (![...PUBLIC_STATIC_DIRS, 'pdfjs'].includes(topSeg)) return next();
        const candidate = path.resolve(publicRoot, '.' + urlPath);
        if (!candidate.startsWith(publicRoot + path.sep) || !existsSync(candidate) || !statSync(candidate).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', mimeFor(candidate));
        res.end(readFileSync(candidate));
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const dirName of PUBLIC_STATIC_DIRS) {
        copyFilteredDir(path.join(publicRoot, dirName), path.join(options.dir, dirName));
      }
      for (const pdfDir of ['wasm', 'cmaps']) {
        const srcPdf = path.join(publicRoot, 'pdfjs', pdfDir);
        if (existsSync(srcPdf)) {
          const destPdf = path.join(options.dir, pdfjsPrefix, pdfDir);
          mkdirSync(destPdf, { recursive: true });
          cpSync(srcPdf, destPdf, { recursive: true });
        }
      }
    },
  };
}

function tailwindScopedPostcssPlugin() {
  const tailwindcss = webRequire('tailwindcss');
  const autoprefixer = webRequire('autoprefixer');
  const rawTailwindConfig = webRequire('./tailwind.config.js');
  const resolvedTailwind = tailwindcss({
    ...rawTailwindConfig,
    content: [
      path.join(webRoot, 'components/**/*.{js,ts,jsx,tsx,mdx}'),
      path.join(webRoot, 'features/**/*.{js,ts,jsx,tsx,mdx}'),
      path.join(webRoot, 'shared/**/*.{js,ts,jsx,tsx,mdx}'),
      path.join(webRoot, 'app/**/*.{js,ts,jsx,tsx,mdx}'),
      path.join(webRoot, 'lib/reading-age-presentation.ts'),
      path.join(spaRoot, 'index.html'),
      path.join(spaRoot, 'src/**/*.{ts,tsx}'),
    ],
  });
  return {
    postcssPlugin: 'deeptutor-scoped-tailwind',
    plugins: [
      {
        postcssPlugin: 'deeptutor-skip-non-tailwind',
        Once(rootNode, helpers) {
          let hasTailwindDirective = false;
          rootNode.walkAtRules('tailwind', () => {
            hasTailwindDirective = true;
          });
          if (!hasTailwindDirective) return;
          const processor = helpers.postcss([resolvedTailwind, autoprefixer()]);
          return processor.process(rootNode, { from: helpers.result.opts.from }).then((res) => {
            helpers.result.root = res.root;
          });
        },
      },
    ],
  };
}
tailwindScopedPostcssPlugin.postcss = true;

export default defineConfig(({ command, mode }) => {
  const release = mode === 'web-release';
  if (!release) {
    const localWebEnv = path.join(repoRoot, '.env.web.local');
    if (existsSync(localWebEnv)) process.loadEnvFile(localWebEnv);
  }

  const manifest = parseYaml(readFileSync(path.join(repoRoot, 'nimi.app.yaml'), 'utf8'));
  const env = { ...process.env };
  if (env.NIMI_WEB_ARCHIVE) {
    env.NIMI_WEB_ARCHIVE = path.resolve(repoRoot, env.NIMI_WEB_ARCHIVE);
  }
  const version = env.NIMI_WEB_VERSION ?? manifest.version;
  const serve = command === 'serve';
  const nimiConfig = nimiWebViteConfig({ root: repoRoot, env, serve, release });

  const mobileConfig =
    !release && env.NIMI_DEV_REALM === 'local' ? JSON.stringify(readMobileAccess('local')) : '';
  const pdfjsWasmPath = release ? `/_releases/${version}/pdfjs/wasm/` : '/pdfjs/wasm/';
  const pdfjsCmapPath = release ? `/_releases/${version}/pdfjs/cmaps/` : '/pdfjs/cmaps/';
  const nodeEnv = serve ? 'development' : 'production';

  return {
    root: spaRoot,
    publicDir: false,
    base: nimiConfig.base ?? '/',
    server: nimiConfig.server,
    css: {
      postcss: {
        plugins: [tailwindScopedPostcssPlugin()],
      },
    },
    resolve: {
      alias: [
        { find: /^next\/navigation$/, replacement: path.join(spaRoot, 'src/shims/next-navigation.tsx') },
        { find: /^next\/link$/, replacement: path.join(spaRoot, 'src/shims/next-link.tsx') },
        { find: /^next\/dynamic$/, replacement: path.join(spaRoot, 'src/shims/next-dynamic.tsx') },
        { find: /^next\/image$/, replacement: path.join(spaRoot, 'src/shims/next-image.tsx') },
        { find: /^cytoscape$/, replacement: webRequire.resolve('cytoscape') },
        { find: /^@\//, replacement: `${webRoot}/` },
      ],
    },
    define: {
      ...nimiConfig.define,
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'process.env.NIMI_DEEPTUTOR_CARRIER': JSON.stringify('web'),
      'process.env.NEXT_PUBLIC_NIMI_CARRIER': JSON.stringify('web'),
      'process.env.NEXT_PUBLIC_APP_VERSION': JSON.stringify(String(version)),
      'process.env.NEXT_PUBLIC_NIMI_WEB_CONFIG': JSON.stringify(''),
      'process.env.NEXT_PUBLIC_NIMI_MOBILE_CONFIG': JSON.stringify(mobileConfig),
      'process.env.NEXT_PUBLIC_PDFJS_WASM_PATH': JSON.stringify(pdfjsWasmPath),
      'process.env.NEXT_PUBLIC_PDFJS_CMAP_PATH': JSON.stringify(pdfjsCmapPath),
    },
    build: {
      ...nimiConfig.build,
      outDir: path.join(repoRoot, 'dist-web'),
      emptyOutDir: true,
    },
    plugins: [
      compactEnglishLocalePlugin(),
      react(),
      staticPublicAssetsPlugin({ release, version }),
      ...(nimiConfig.plugins ?? []),
    ],
  };
});
