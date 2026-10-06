const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');

fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(publicDir, 'index.html'));
fs.copyFileSync(path.join(root, 'robots.txt'), path.join(publicDir, 'robots.txt'));
fs.copyFileSync(path.join(root, 'sitemap.xml'), path.join(publicDir, 'sitemap.xml'));
fs.cpSync(path.join(root, 'images'), path.join(publicDir, 'images'), { recursive: true });

console.log('Prepared Vercel public assets from index.html, robots.txt, sitemap.xml, and images/.');
