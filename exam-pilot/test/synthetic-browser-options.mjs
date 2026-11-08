// Test-only TLS trust for the disposable loopback fixture. Never imported by the app.
import { X509Certificate, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const certificateSPKI = (pem) =>
  createHash("sha256")
    .update(
      new X509Certificate(pem).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
export async function syntheticBrowserOptions(
  engine,
  baseURL,
  {
    allowSelfSigned = process.env.DD_ALLOW_SELF_SIGNED === "true",
    certificatePath = process.env.DD_TEST_TLS_CERT ||
      new URL("../.wrangler/tls/local-cert.pem", import.meta.url),
    readCertificate = readFile,
    fingerprint = certificateSPKI,
  } = {},
) {
  const url = new URL(baseURL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Synthetic browser tests require a disposable loopback server.",
    );
  const options = { headless: true };
  if (engine !== "chromium" || url.protocol !== "https:" || !allowSelfSigned)
    return options;
  // ignoreHTTPSErrors on a Playwright context does not cover Chromium's
  // service-worker script TLS check. Trust this fixture key, never all certs.
  let spki;
  try {
    spki = fingerprint(await readCertificate(certificatePath));
  } catch {
    throw new Error(
      "Cannot trust the synthetic TLS certificate. Set DD_TEST_TLS_CERT to the generated localhost certificate.",
    );
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(spki))
    throw new Error("Invalid synthetic certificate SPKI fingerprint.");
  options.args = [`--ignore-certificate-errors-spki-list=${spki}`];
  return options;
}
