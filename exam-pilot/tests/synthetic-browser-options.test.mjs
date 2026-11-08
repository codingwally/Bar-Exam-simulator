import test from "node:test";
import assert from "node:assert/strict";
import { syntheticBrowserOptions } from "../test/synthetic-browser-options.mjs";
const spki = Buffer.alloc(32, 7).toString("base64");
test("Chromium TLS fixture trust is restricted to its exact certificate key", async () => {
  let reads = 0;
  const options = await syntheticBrowserOptions(
    "chromium",
    "https://localhost:8802",
    {
      allowSelfSigned: true,
      certificatePath: "fixture-cert.pem",
      readCertificate: async (path) => {
        assert.equal(path, "fixture-cert.pem");
        reads++;
        return "synthetic-public-certificate";
      },
      fingerprint: (pem) => {
        assert.equal(pem, "synthetic-public-certificate");
        return spki;
      },
    },
  );
  assert.deepEqual(options.args, [
    `--ignore-certificate-errors-spki-list=${spki}`,
  ]);
  assert.equal(reads, 1);
  assert.ok(!options.args.includes("--ignore-certificate-errors"));
});
test("remote hosts cannot acquire the synthetic TLS exception", async () => {
  await assert.rejects(
    syntheticBrowserOptions("chromium", "https://example.com", {
      allowSelfSigned: true,
    }),
    /loopback/,
  );
});
test("normal HTTP and other engines do not acquire a Chromium certificate exception", async () => {
  const readCertificate = () => {
    throw new Error("Must not read a certificate");
  };
  for (const [engine, url, allowSelfSigned] of [
    ["chromium", "http://localhost:8802", true],
    ["chromium", "https://localhost:8802", false],
    ["firefox", "https://localhost:8802", true],
    ["webkit", "https://localhost:8802", true],
  ])
    assert.deepEqual(
      await syntheticBrowserOptions(engine, url, {
        allowSelfSigned,
        readCertificate,
      }),
      { headless: true },
    );
});
test("missing or malformed fixture certificate fails rather than granting broad TLS bypass", async () => {
  await assert.rejects(
    syntheticBrowserOptions("chromium", "https://localhost:8802", {
      allowSelfSigned: true,
      readCertificate: () => {
        throw new Error("missing");
      },
    }),
    /Cannot trust/,
  );
  await assert.rejects(
    syntheticBrowserOptions("chromium", "https://localhost:8802", {
      allowSelfSigned: true,
      readCertificate: () => "x",
      fingerprint: () => "invalid",
    }),
    /Invalid synthetic/,
  );
});
