import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const html = await readFile(
  new URL("../public/admin-login.html", import.meta.url),
  "utf8",
);
const source = await readFile(
  new URL("../public/admin-login.mjs", import.meta.url),
  "utf8",
);
function loginFixture(reply) {
  const { document } = parseHTML(html),
    form = document.getElementById("professor-login");
  const field = document.getElementById("professor-passphrase"),
    button = document.getElementById("sign-in"),
    message = document.getElementById("login-message");
  const requests = [],
    redirects = [],
    timers = new Map();
  let submit,
    input,
    storageAccess = 0;
  form.reportValidity = () => !!field.value;
  form.addEventListener = (event, handler) => {
    if (event === "submit") submit = handler;
  };
  field.addEventListener = (event, handler) => {
    if (event === "input") input = handler;
  };
  const sandbox = {
    document,
    AbortController,
    location: { assign: (value) => redirects.push(value) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return reply(url, options);
    },
    setTimeout: (callback) => {
      const id = timers.size + 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    TypeError,
  };
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(sandbox, name, {
      get() {
        storageAccess++;
        throw new Error("Secret storage is forbidden.");
      },
    });
  vm.runInNewContext(source, sandbox, { filename: "admin-login.mjs" });
  return {
    document,
    field,
    button,
    message,
    requests,
    redirects,
    timers,
    submit: () => submit({ preventDefault() {} }),
    input: () => input(),
    storageAccess: () => storageAccess,
  };
}
const accepted = () =>
  new Response(
    JSON.stringify({
      identity: {
        email: "owner@example.invalid",
        role: "owner",
        auth_mode: "builtin",
      },
      expires_at: 1792870000000,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
const synthetic = "Synthetic-only-passphrase-with-no-live-authority";

test("professor sign in uses one labelled password-manager field and an exact-origin JSON request", async () => {
  const fixture = loginFixture(accepted);
  assert.equal(fixture.document.querySelectorAll("input").length, 1);
  assert.equal(fixture.field.type, "password");
  assert.equal(fixture.field.getAttribute("autocomplete"), "current-password");
  assert.equal(
    fixture.document.querySelector("label").getAttribute("for"),
    fixture.field.id,
  );
  fixture.field.value = synthetic;
  await fixture.submit();
  assert.equal(fixture.requests.length, 1);
  const { url, options } = fixture.requests[0];
  assert.equal(url, "/api/admin/login");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { secret: synthetic });
  assert.deepEqual(fixture.redirects, ["/admin/exams"]);
  assert.equal(fixture.field.value, "");
  assert.equal(fixture.storageAccess(), 0);
  assert.equal(fixture.timers.size, 0);
});
test("wrong passphrase stays on the page with an accessible error and allows correction", async () => {
  const fixture = loginFixture(() => new Response("{}", { status: 401 }));
  fixture.field.value = synthetic;
  await fixture.submit();
  assert.deepEqual(fixture.redirects, []);
  assert.equal(fixture.field.getAttribute("aria-invalid"), "true");
  assert.equal(fixture.message.hidden, false);
  assert.match(fixture.message.textContent, /not recognized/);
  assert.equal(fixture.message.textContent.includes(synthetic), false);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.field.readOnly, false);
  fixture.input();
  assert.equal(fixture.field.hasAttribute("aria-invalid"), false);
  assert.equal(fixture.message.hidden, true);
});
test("network and timeout failures recover the sign-in controls without claiming success", async () => {
  const offline = loginFixture(() => {
    throw new TypeError("Failed to fetch");
  });
  offline.field.value = synthetic;
  await offline.submit();
  assert.match(offline.message.textContent, /Check your internet connection/);
  assert.equal(offline.button.disabled, false);
  assert.deepEqual(offline.redirects, []);
  const timed = loginFixture(
    (url, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  );
  timed.field.value = synthetic;
  const pending = timed.submit();
  [...timed.timers.values()][0]();
  await pending;
  assert.match(timed.message.textContent, /taking longer/);
  assert.equal(timed.button.disabled, false);
  assert.equal(timed.timers.size, 0);
  assert.deepEqual(timed.redirects, []);
});
test("rate limits and missing setup have plain recovery messages without exposing provider text", async () => {
  for (const [response, pattern] of [
    [
      new Response("server internals", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
      /Wait about 2 minutes/,
    ],
    [
      new Response("server internals", { status: 503 }),
      /Contact the site owner/,
    ],
    [
      new Response("server internals", { status: 500 }),
      /temporarily unavailable/,
    ],
  ]) {
    const fixture = loginFixture(() => response);
    fixture.field.value = synthetic;
    await fixture.submit();
    assert.match(fixture.message.textContent, pattern);
    assert.doesNotMatch(fixture.message.textContent, /server internals/);
    assert.deepEqual(fixture.redirects, []);
  }
});
test("unconfirmed or malformed success responses never open the private desk", async () => {
  for (const response of [
    new Response("<html>Sign in elsewhere</html>"),
    new Response(JSON.stringify({ identity: { role: "examiner" } })),
  ]) {
    const fixture = loginFixture(() => response);
    fixture.field.value = synthetic;
    await fixture.submit();
    assert.deepEqual(fixture.redirects, []);
    assert.match(fixture.message.textContent, /could not be confirmed/);
    assert.doesNotMatch(fixture.message.textContent, /Unexpected token|html/);
  }
});
test("duplicate submit is coalesced while the first request is pending", async () => {
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = loginFixture(() => response);
  fixture.field.value = synthetic;
  const first = fixture.submit();
  await fixture.submit();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.button.disabled, true);
  assert.equal(fixture.field.readOnly, true);
  release(accepted());
  await first;
  assert.equal(fixture.storageAccess(), 0);
});
test("an empty required passphrase never sends a sign-in request", async () => {
  const fixture = loginFixture(accepted);
  fixture.field.value = "";
  await fixture.submit();
  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(fixture.redirects, []);
});
