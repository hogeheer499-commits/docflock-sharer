import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = resolve(root, "public");
const assetsDir = resolve(publicDir, "assets");

const sources = {
  style: await readFile(resolve(publicDir, "style.css")),
  app: await readFile(resolve(publicDir, "app.js")),
};

const hash = (contents) => createHash("sha256").update(contents).digest("hex").slice(0, 12);
const filenames = {
  style: `style.${hash(sources.style)}.css`,
  app: `app.${hash(sources.app)}.js`,
};

await mkdir(assetsDir, { recursive: true });
for (const filename of await readdir(assetsDir)) {
  if (/^(style|app)\.[a-f0-9]{12}\.(css|js)$/.test(filename)) {
    await rm(resolve(assetsDir, filename));
  }
}

await writeFile(resolve(assetsDir, filenames.style), sources.style);
await writeFile(resolve(assetsDir, filenames.app), sources.app);

const indexPath = resolve(publicDir, "index.html");
let index = await readFile(indexPath, "utf8");
index = index
  .replace(/\/(?:assets\/)?style(?:\.[a-f0-9]{12})?\.css/g, `/assets/${filenames.style}`)
  .replace(/\/(?:assets\/)?app(?:\.[a-f0-9]{12})?\.js/g, `/assets/${filenames.app}`);
await writeFile(indexPath, index);

process.stdout.write(`${filenames.style}\n${filenames.app}\n`);
