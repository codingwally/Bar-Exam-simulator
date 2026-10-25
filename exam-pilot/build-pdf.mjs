import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const target = new URL("./public/pdf-vendor/", import.meta.url);
await mkdir(target, { recursive: true });
await build({
  stdin: {
    contents: "export { PDFDocument, StandardFonts, rgb } from 'pdf-lib'; export { default as fontkit } from '@pdf-lib/fontkit';",
    resolveDir: dirname(fileURLToPath(import.meta.url)),
  },
  outfile: fileURLToPath(new URL("pdf.mjs", target)),
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  legalComments: "eof",
});
for (const [name, file] of [["pdf-lib", "LICENSE.md"], ["@pdf-lib/fontkit", "README.md"]]) {
  await copyFile(resolve(dirname(require.resolve(`${name}/package.json`)), file), new URL(`${name.replaceAll("/", "_").replace("@", "")}-${file}`, target));
}
console.log("Built the self-hosted PDF exporter; no answer data leaves the browser.");
