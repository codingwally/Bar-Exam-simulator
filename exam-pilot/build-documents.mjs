import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const target = new URL("./public/document-vendor/", import.meta.url);
await mkdir(target, { recursive: true });
const bundled = await build({
  stdin: {
    contents: "import mammoth from 'mammoth'; export default mammoth;",
    resolveDir: dirname(fileURLToPath(import.meta.url)),
  },
  outfile: fileURLToPath(new URL("mammoth.mjs", target)),
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  legalComments: "eof",
  metafile: true,
});
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
await copyFile(
  resolve(pdfRoot, "build/pdf.min.mjs"),
  new URL("pdf.mjs", target),
);
await copyFile(
  resolve(pdfRoot, "build/pdf.worker.min.mjs"),
  new URL("pdf.worker.mjs", target),
);
await copyFile(
  resolve(pdfRoot, "LICENSE"),
  new URL("PDFJS-LICENSE.txt", target),
);
await copyFile(
  resolve(dirname(require.resolve("mammoth/package.json")), "LICENSE"),
  new URL("MAMMOTH-LICENSE.txt", target),
);
const licenseDir = new URL("licenses/", target);
await mkdir(licenseDir, { recursive: true });
const packageRoots = new Set(
  Object.keys(bundled.metafile.inputs)
    .filter((input) => input.includes("node_modules/"))
    .map((input) => input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1])
    .filter(Boolean)
    .map((root) => resolve(root)),
);
// Some dependency browser distributions are prebundled. Include complete
// production dependency notices as well as esbuild's explicit module inputs.
const visited = new Set();
async function includeDependencies(root) {
  root = resolve(root);
  if (visited.has(root)) return;
  visited.add(root);
  packageRoots.add(root);
  const info = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  for (const name of Object.keys(info.dependencies || {})) {
    const dependency = dirname(
      require.resolve(`${name}/package.json`, { paths: [root] }),
    );
    await includeDependencies(dependency);
  }
}
await includeDependencies(dirname(require.resolve("mammoth/package.json")));
packageRoots.add(pdfRoot);
const licenses = [];
for (const root of [...packageRoots].sort()) {
  const info = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const contents = await readdir(root);
  const files = contents.filter((name) =>
    /^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(name),
  );
  if (!files.length) {
    const readme = contents.find((name) => /^readme(?:\..*)?$/i.test(name));
    if (
      readme &&
      /permission is hereby granted|redistribution and use|license/i.test(
        await readFile(resolve(root, readme), "utf8"),
      )
    )
      files.push(readme);
    else
      throw new Error(
        `Missing license notice for bundled package ${info.name}`,
      );
  }
  const notices = [];
  for (const name of files) {
    const destination = `${info.name.replaceAll("/", "_").replace("@", "")}-${name}`;
    await copyFile(resolve(root, name), new URL(destination, licenseDir));
    notices.push(`licenses/${destination}`);
  }
  licenses.push({
    name: info.name,
    version: info.version,
    license: info.license,
    notices,
  });
}
await writeFile(
  new URL("LICENSES.json", target),
  JSON.stringify(licenses, null, 2),
);
await writeFile(
  new URL("VERSIONS.json", target),
  JSON.stringify(
    {
      mammoth: "1.13.0",
      "pdfjs-dist": "6.4.299",
      sources: [
        "https://github.com/mwilliamson/mammoth.js",
        "https://github.com/mozilla/pdf.js",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Built local DOCX and PDF readers. Question content never leaves the browser during extraction.",
);
