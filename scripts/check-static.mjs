import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = resolve(root, "public");
const index = await readFile(resolve(publicDir, "index.html"), "utf8");
const worker = await readFile(resolve(publicDir, "_worker.js"), "utf8");

for (const [name, extension] of [["style", "css"], ["app", "js"]]) {
  const source = await readFile(resolve(publicDir, `${name}.${extension}`));
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const assetPath = `/assets/${name}.${digest}.${extension}`;
  if (!index.includes(assetPath)) throw new Error(`index.html does not reference ${assetPath}`);
  await access(resolve(publicDir, assetPath.slice(1)));
}

if (index.includes('href="/style.css"') || index.includes('src="/app.js"')) {
  throw new Error("index.html still references unhashed application assets");
}
if (!worker.includes('no-cache, max-age=0, must-revalidate')) {
  throw new Error("HTML no-cache policy is missing");
}
if (!worker.includes('public, max-age=31536000, immutable')) {
  throw new Error("immutable asset cache policy is missing");
}

process.stdout.write("Static asset hashes and cache policies verified.\n");
