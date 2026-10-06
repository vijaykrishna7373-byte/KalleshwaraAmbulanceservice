const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const imageDir = path.join(publicDir, 'images');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const refs = new Set();

for (const match of html.matchAll(/(?:src|poster|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
  const value = (match[1] || match[2] || '').trim();
  if (value.startsWith('/images/')) refs.add(value.split(/[?#]/, 1)[0]);
}
for (const match of html.matchAll(/(?:og:image|twitter:image)["']?\s+content=["']([^"']+)/gi)) {
  const value = match[1].split(/[?#]/, 1)[0];
  if (value.startsWith('/images/')) refs.add(value);
  else {
    try {
      const url = new URL(value);
      if (url.pathname.startsWith('/images/')) refs.add(url.pathname);
    } catch {}
  }
}

let failed = false;
for (const ref of [...refs].sort()) {
  let filename;
  try {
    filename = decodeURIComponent(ref.slice('/images/'.length));
  } catch {
    console.error(`FAIL invalid URL encoding: ${ref}`);
    failed = true;
    continue;
  }
  const target = path.resolve(imageDir, filename);
  if (!target.startsWith(`${path.resolve(imageDir)}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    console.error(`FAIL ${ref}`);
    failed = true;
  } else {
    console.log(`PASS ${ref}`);
  }
}

if (refs.size === 0) {
  console.error('FAIL no local image URLs were found');
  failed = true;
}
process.exitCode = failed ? 1 : 0;
