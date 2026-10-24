// Builds "1 click/bedwars.html": the game, Three.js, PeerJS and the styles
// all inside one HTML file, so it runs straight from file:// (double-click).
// Run from this folder: npm install && npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// The game imports 'three/addons/...' (the import map name); point it at the package.
const threeAddons = {
  name: 'three-addons',
  setup(b) {
    b.onResolve({ filter: /^three\/addons\// }, (args) => ({
      path: join(here, 'node_modules', 'three', 'examples', 'jsm', args.path.slice('three/addons/'.length)),
    }));
  },
};

const result = await build({
  entryPoints: [join(root, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  target: 'es2020',
  nodePaths: [join(here, 'node_modules')],
  plugins: [threeAddons],
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);

const out = join(root, '1 click', 'bedwars.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
