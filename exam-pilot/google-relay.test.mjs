import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { answerPacket, deliverJob } from "./delivery.mjs";

const source = await readFile(
  new URL("./google-relay/Code.gs", import.meta.url),
  "utf8",
);
const owner = "wallyesteban1993@gmail.com";
const secret = "synthetic-only-high-entropy-secret-not-a-real-credential";
const env = {
  EXAM_RELAY_URL:
    "https://script.google.com/macros/s/synthetic-deployment/exec",
  EXAM_RELAY_SECRET: secret,
  EMAIL_DELIVERY_ENABLED: "true",
};
const payload = {
  schemaVersion: 1,
  exam: {
    id: "synthetic-exam",
    title: "Synthetic examination",
    instructions: "Full exam instructions",
    durationMinutes: 20,
  },
  attempt: {
    id: "d7d16e46-fbce-46a6-9ab7-17614190b1e0",
    name: "Synthetic Student",
    email: "synthetic@example.invalid",
    startedAt: 1000,
    deadlineAt: 2000,
    finalizedAt: 1900,
    status: "finalized",
  },
  questions: [
    {
      id: "q1",
      number: 1,
      text: "Full question one",
      instructions: "Full question instructions",
    },
    { id: "q2", number: 2, text: "Blank answer question" },
  ],
  answers: [
    {
      questionId: "q1",
      revision: 2,
      text: "=SUM(A1:A2)\nExact answer ñ 🤝",
      hash: "synthetic-answer-hash",
      savedAt: 1500,
    },
    {
      questionId: "q2",
      revision: 0,
      text: "",
      hash: "blank-hash",
      savedAt: null,
    },
  ],
  receipt: {
    id: "synthetic-receipt",
    checksum: "synthetic-checksum",
    serverTime: 1900,
    answeredCount: 1,
    questionCount: 2,
    finalizationType: "manual",
  },
};
const job = (target = "sheets", value = payload, id = "synthetic-job") => ({
  id,
  target,
  payload: structuredClone(value),
});
const unsigned = (value) => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const spreadsheet = options.spreadsheetId || "synthetic-sheet";
  const props = new Map([
    ["EXAM_RELAY_SECRET", secret],
    ["GOOGLE_SPREADSHEET_ID", spreadsheet],
  ]);
  const sheets = [],
    mail = [],
    batches = [];
  const state = {
    locked: false,
    calls: 0,
    quota: 100,
    failMailAfterAccept: false,
    corruptReadback: false,
    ...options,
  };
  const textResponse = (value) => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(value),
  });
  function range(value) {
    const match = value.match(
      /^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/,
    );
    assert.ok(match, `Unexpected range ${value}`);
    const column = (value) =>
      [...value].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) -
      1;
    return {
      title: match[1].replace(/''/g, "'"),
      c1: column(match[2]),
      r1: +match[3] - 1,
      c2: column(match[4] || match[2]),
      r2: +(match[5] || match[3]) - 1,
    };
  }
  const ctx = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_, value) => [
        ...createHash("sha256").update(value).digest(),
      ],
      computeHmacSha256Signature: (value, key) => [
        ...createHmac("sha256", key).update(value).digest(),
      ],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
      newBlob: (content, type, name) => ({ content, type, name }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props.get(key) || null,
        deleteProperty: (key) => props.delete(key),
      }),
    },
    Session: {
      getEffectiveUser: () => ({
        getEmail: () => state.executionOwner || owner,
      }),
    },
    DriveApp: {
      Access: { PRIVATE: "PRIVATE" },
      getFileById: (id) => {
        assert.equal(id, spreadsheet);
        return {
          getOwner: () => ({ getEmail: () => state.fileOwner || owner }),
          getSharingAccess: () => state.sharing || "PRIVATE",
          getEditors: () =>
            (state.editors || []).map((email) => ({ getEmail: () => email })),
          getViewers: () => [],
        };
      },
    },
    ScriptApp: { getOAuthToken: () => "synthetic-oauth" },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (state.locked) return false;
          state.locked = true;
          return true;
        },
        releaseLock: () => {
          state.locked = false;
        },
      }),
    },
    MailApp: {
      getRemainingDailyQuota: () => state.quota,
      sendEmail: (message) => {
        mail.push(unsigned(message));
        state.quota--;
        if (state.failMailAfterAccept)
          throw new Error("Synthetic ambiguous mail transport");
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    UrlFetchApp: {
      fetch: (value, options) => {
        state.calls++;
        const url = new URL(value);
        if (
          url.origin === "https://www.googleapis.com" &&
          url.pathname.endsWith("/permissions")
        ) {
          state.permissionCalls = (state.permissionCalls || 0) + 1;
          return textResponse({
            permissions: state.permissions || [
              { type: "user", role: "owner", emailAddress: owner },
            ],
            ...(state.permissionNextPage ? { nextPageToken: "next" } : {}),
          });
        }
        assert.equal(url.origin, "https://sheets.googleapis.com");
        assert.equal(options.headers.Authorization, "Bearer synthetic-oauth");
        if (!url.pathname.includes("/values/") && options.method === "get")
          return textResponse({
            spreadsheetId: spreadsheet,
            sheets: sheets.map((sheet) => ({ properties: sheet.properties })),
          });
        if (url.pathname.includes("/values/")) {
          const requested = range(
            decodeURIComponent(url.pathname.split("/values/")[1]),
          );
          const sheet = sheets.find(
            (sheet) => sheet.properties.title === requested.title,
          );
          assert.ok(sheet);
          const rows = [];
          for (let r = requested.r1; r <= requested.r2; r++) {
            const row = [];
            for (let c = requested.c1; c <= requested.c2; c++)
              row.push(sheet.cells[r]?.[c] ?? "");
            while (row.length && row.at(-1) === "") row.pop();
            rows.push(row);
          }
          while (rows.length && rows.at(-1).length === 0) rows.pop();
          if (
            state.corruptReadback &&
            requested.c1 === 0 &&
            requested.c2 === 5 &&
            rows.length
          )
            rows[0][0] = "corrupt";
          return textResponse({ values: rows });
        }
        const body = JSON.parse(options.payload);
        batches.push(body);
        const replies = body.requests.map((request) => {
          if (request.addSheet) {
            const properties = {
              ...request.addSheet.properties,
              sheetId: sheets.length + 1,
            };
            sheets.push({ properties, cells: [] });
            return { addSheet: { properties } };
          }
          if (request.updateSheetProperties) {
            const properties = request.updateSheetProperties.properties;
            const sheet = sheets.find(
              (sheet) => sheet.properties.sheetId === properties.sheetId,
            );
            sheet.properties = { ...sheet.properties, ...properties };
            return {};
          }
          if (request.updateCells) {
            const update = request.updateCells,
              target = update.range;
            const sheet = sheets.find(
              (sheet) => sheet.properties.sheetId === target.sheetId,
            );
            for (let r = target.startRowIndex; r < target.endRowIndex; r++) {
              sheet.cells[r] ||= [];
              for (
                let c = target.startColumnIndex;
                c < target.endColumnIndex;
                c++
              ) {
                const cell =
                  update.rows[r - target.startRowIndex]?.values[
                    c - target.startColumnIndex
                  ];
                assert.equal(
                  cell?.userEnteredValue?.formulaValue,
                  undefined,
                  "Never execute a student formula",
                );
                sheet.cells[r][c] = cell?.userEnteredValue?.stringValue ?? "";
              }
            }
          }
          return {};
        });
        return textResponse({ replies });
      },
    },
  });
  vm.runInContext(source, ctx);
  const fetcher = async (_, options) => {
    state.lastEnvelope = JSON.parse(options.body);
    const result = ctx.doPost({ postData: { contents: options.body } });
    return Response.json(JSON.parse(result.text));
  };
  return { ctx, state, props, sheets, mail, batches, fetcher };
}

function emailHash(email) {
  return createHash("sha256").update(JSON.stringify({recipient: email.recipient, attemptEmail: email.attemptEmail, subject: email.subject, parts: email.parts})).digest("base64url");
}
function invokeSigned(f, data) {
  const envelope = {version: 1, issuedAt: Date.now(), requestId: randomUUID(), body: JSON.stringify(data)};
  envelope.signature = createHmac("sha256", secret).update(`1\n${envelope.issuedAt}\n${envelope.requestId}\n${envelope.body}`).digest("base64url");
  const response = JSON.parse(f.ctx.doPost({postData: {contents: JSON.stringify(envelope)}}).text);
  return response.body ? JSON.parse(response.body) : response;
}

test("student HTML proof is independent of the Sheet mirror, contains only their numbered answers, and retries once", async () => {
  const f = fixture();
  await deliverJob(job("student_receipt"), env, f.fetcher);
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].to, payload.attempt.email);
  assert.equal(f.mail[0].attachments, undefined);
  assert.match(f.mail[0].htmlBody, /You successfully submitted your answers\./);
  assert.match(f.mail[0].htmlBody, /ANSWER 1/);
  assert.match(f.mail[0].htmlBody, /ANSWER 2/);
  assert.ok(f.mail[0].body.includes(payload.answers[0].text));
  assert.ok(f.mail[0].body.includes("[BLANK ANSWER]"));
  for (const privateValue of ["synthetic-sheet", "docs.google.com/spreadsheets", payload.questions[0].text, payload.questions[0].instructions, payload.exam.instructions]) {
    assert.equal(f.mail[0].htmlBody.includes(privateValue), false);
    assert.equal(f.mail[0].body.includes(privateValue), false);
  }
  const request = JSON.parse(f.state.lastEnvelope.body);
  for (const field of ["values", "contentHash", "revisions", "packet", "packetHash"])
    assert.equal(Object.hasOwn(request, field), false);
  assert.equal(f.sheets[0].cells[0]?.[0], undefined, "Mail does not write private Sheet answer cells");
  assert.equal(f.sheets[0].cells[0]?.[7], undefined, "Mail does not fabricate mirror proof");
  assert.equal(JSON.parse(f.sheets[0].cells[2][7]).target, "student_receipt");
  await deliverJob(job("student_receipt", payload, "another-student-job"), env, f.fetcher);
  assert.equal(f.mail.length, 1);
  await deliverJob(job("sheets"), env, f.fetcher);
  assert.equal(JSON.parse(f.sheets[0].cells[2][7]).parts[0].status, "accepted", "Later Sheet copy preserves student mail journal");
  assert.equal(JSON.parse(f.sheets[0].cells[0][7]).receiptId, payload.receipt.id);
});

test("owner and student HTML copies have separate journals even when their address is identical", async () => {
  const spreadsheet = "synthetic_private_spreadsheet_12345";
  const f = fixture({spreadsheetId: spreadsheet}), same = structuredClone(payload);
  same.attempt.email = owner;
  const configured = {...env, GOOGLE_SPREADSHEET_ID: spreadsheet};
  await deliverJob(job("student_receipt", same, "same-student"), configured, f.fetcher);
  await deliverJob(job("owner_email", same, "same-owner"), configured, f.fetcher);
  assert.equal(f.mail.length, 2);
  assert.ok(f.mail.every(message => message.to === owner));
  assert.equal(f.mail[0].htmlBody.includes(spreadsheet), false);
  assert.ok(f.mail[1].htmlBody.includes(`https://docs.google.com/spreadsheets/d/${spreadsheet}/edit`));
  assert.equal(f.mail[0].attachments, undefined);
  assert.equal(f.mail[1].attachments[0].content, answerPacket(same));
  assert.equal(JSON.parse(f.sheets[0].cells[1][7]).target, "owner_email");
  assert.equal(JSON.parse(f.sheets[0].cells[2][7]).target, "student_receipt");
  await deliverJob(job("owner_email", same, "repeat-owner"), configured, f.fetcher);
  await deliverJob(job("student_receipt", same, "repeat-student"), configured, f.fetcher);
  assert.equal(f.mail.length, 2, "Each target sends exactly once");
});

test("relay rejects recipient substitution, student private data, private links and altered HTML integrity before sending", async () => {
  const seed = fixture();
  await deliverJob(job("student_receipt"), env, seed.fetcher);
  const baseline = JSON.parse(seed.state.lastEnvelope.body);
  const cases = [
    [data => {data.email.recipient = "other@example.invalid";}, "relay_email_invalid"],
    [data => {data.values = [];}, "student_email_private_payload"],
    [data => {data.packet = "private paper";}, "student_email_private_payload"],
    [data => {data.email.parts[0].html += "<!-- synthetic-sheet -->";}, "student_email_private_destination"],
    [data => {data.email.parts[0].html += "<script>bad()</script>";}, "relay_email_invalid"],
  ];
  for (const [mutate, code] of cases) {
    const f = fixture(), data = structuredClone(baseline);
    mutate(data); data.email.contentHash = emailHash(data.email);
    const result = invokeSigned(f, data);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(f.mail.length, 0);
    assert.equal(f.state.calls, 0);
  }
  const f = fixture(), data = structuredClone(baseline);
  data.email.parts[0].html += "changed without the matching content hash";
  assert.equal(invokeSigned(f, data).code, "relay_email_invalid");
  assert.equal(f.mail.length, 0);
});

test("ambiguous student HTML sends need student-target resolution and never disturb owner mail", async () => {
  const f = fixture({failMailAfterAccept: true});
  await assert.rejects(deliverJob(job("student_receipt"), env, f.fetcher));
  f.state.failMailAfterAccept = false;
  await assert.rejects(deliverJob(job("student_receipt"), env, f.fetcher), error => error.code === "email_confirmation_required");
  assert.equal(f.mail.length, 1);
  await deliverJob(job("owner_email"), env, f.fetcher);
  assert.equal(f.mail.length, 2);
  f.props.set("EXAM_MAIL_RESOLVE_TAB", f.sheets[0].properties.title);
  f.props.set("EXAM_MAIL_RESOLVE_PART", "1");
  f.props.set("EXAM_MAIL_RESOLVE_ACTION", "confirm");
  f.props.set("EXAM_MAIL_RESOLVE_TARGET", "student_receipt");
  assert.equal(f.ctx.resolvePendingOwnerEmail().target, "student_receipt");
  await deliverJob(job("student_receipt"), env, f.fetcher);
  assert.equal(f.mail.length, 2);
  assert.equal(JSON.parse(f.sheets[0].cells[1][7]).parts[0].status, "accepted");
  assert.equal(f.props.has("EXAM_MAIL_RESOLVE_TARGET"), false);
});

test("signed relay preserves complete giant Unicode/formula text with RAW cells and verifies readback", async () => {
  const f = fixture(),
    large = structuredClone(payload);
  large.answers[0].text =
    '=IMPORTXML("not-executed")\n' + "ñ 🤝 ".repeat(25000);
  large.questions[0].text = "Q".repeat(80000);
  const result = await deliverJob(job("sheets", large), env, f.fetcher);
  assert.match(result.reference, /synthetic-sheet\/edit#gid=1$/);
  assert.equal(f.sheets.length, 1);
  const cells = f.sheets[0].cells,
    header = cells.findIndex((row) => row[0] === "Question");
  const rows = cells.slice(header + 1).filter((row) => row[0]?.startsWith("1"));
  assert.equal(rows.map((row) => row[2]).join(""), large.answers[0].text);
  assert.equal(
    rows.map((row) => row[1]).join(""),
    large.questions[0].text +
      "\n\nInstructions: " +
      large.questions[0].instructions,
  );
  assert.ok(cells.some((row) => row[2] === "[BLANK ANSWER]"));
  await deliverJob(job("sheets", large), env, f.fetcher);
  assert.equal(f.sheets.length, 1, "Repeated job reuses its exact attempt tab");
  assert.equal(f.state.locked, false);
});

test("stale snapshots cannot replace newer revisions or immutable submitted answers", async () => {
  const f = fixture(),
    draft = structuredClone(payload);
  draft.receipt = null;
  draft.attempt.status = "active";
  await deliverJob(job("sheets", draft, "draft2"), env, f.fetcher);
  const stale = structuredClone(draft);
  stale.answers[0].revision = 1;
  stale.answers[0].text = "old";
  stale.answers[0].hash = "older";
  await deliverJob(job("sheets", stale, "draft1"), env, f.fetcher);
  assert.ok(
    f.sheets[0].cells.some((row) => row[2] === payload.answers[0].text),
  );
  await deliverJob(job(), env, f.fetcher);
  await deliverJob(job("sheets", stale, "late-old"), env, f.fetcher);
  assert.equal(
    JSON.parse(f.sheets[0].cells[0][7]).receiptId,
    payload.receipt.id,
  );
  const changedFinal = structuredClone(payload);
  changedFinal.answers[0].text = "changed after final";
  await assert.rejects(
    deliverJob(job("sheets", changedFinal), env, f.fetcher),
    (error) => error.code === "immutable_final_conflict",
  );
  const changedSameRevision = structuredClone(draft);
  changedSameRevision.answers[0].hash = "different-hash";
  const other = fixture();
  await deliverJob(job("sheets", draft), env, other.fetcher);
  await assert.rejects(
    deliverJob(job("sheets", changedSameRevision), env, other.fetcher),
    (error) => error.code === "mirror_revision_conflict",
  );
});

test("relay rejects wrong signature, expired replay, unsafe URL, and altered acknowledgements", async () => {
  const f = fixture();
  await assert.rejects(
    deliverJob(
      job(),
      {
        ...env,
        EXAM_RELAY_SECRET: "other-synthetic-long-secret-with-no-authority",
      },
      f.fetcher,
    ),
  );
  assert.equal(f.state.calls, 0);
  await deliverJob(job(), env, f.fetcher);
  const expired = { ...f.state.lastEnvelope, issuedAt: Date.now() - 301000 };
  expired.signature = createHmac("sha256", secret)
    .update(`1\n${expired.issuedAt}\n${expired.requestId}\n${expired.body}`)
    .digest("base64url");
  const before = f.state.calls;
  assert.equal(
    JSON.parse(
      f.ctx.doPost({ postData: { contents: JSON.stringify(expired) } }).text,
    ).ok,
    false,
  );
  assert.equal(f.state.calls, before);
  await assert.rejects(
    deliverJob(
      job(),
      { ...env, EXAM_RELAY_URL: "https://example.invalid/exec" },
      f.fetcher,
    ),
    /deployed Google/,
  );
  await assert.rejects(
    deliverJob(job(), env, async (...args) => {
      const response = await f.fetcher(...args),
        result = await response.json();
      result.body = result.body.replace("synthetic-job", "different-job");
      return Response.json(result);
    }),
    /signature/,
  );
});

test("sharing or execution outside owner fails before copying private answers", async () => {
  for (const options of [
    { sharing: "ANYONE" },
    { editors: ["other@example.invalid"] },
    { fileOwner: "other@example.invalid" },
    { executionOwner: "other@example.invalid" },
  ]) {
    const f = fixture(options);
    await assert.rejects(deliverJob(job(), env, f.fetcher));
    assert.equal(f.sheets.length, 0);
    assert.equal(f.mail.length, 0);
    assert.equal(f.state.calls, 0);
  }
});

test("owner-only permission verification rejects groups, domains, published links and incomplete lists", async () => {
  for (const grant of [
    { type: "group", role: "reader", emailAddress: "group@example.invalid" },
    { type: "domain", role: "reader" },
    { type: "anyone", role: "reader" },
    {
      type: "user",
      role: "writer",
      emailAddress: "service-account@example.invalid",
    },
  ]) {
    const f = fixture({
      permissions: [
        { type: "user", role: "owner", emailAddress: owner },
        grant,
      ],
    });
    await assert.rejects(
      deliverJob(job(), env, f.fetcher),
      (error) => error.code === "spreadsheet_not_owner_private",
    );
    assert.equal(f.sheets.length, 0);
    assert.equal(f.mail.length, 0);
  }
  const incomplete = fixture({ permissionNextPage: true });
  await assert.rejects(
    deliverJob(job(), env, incomplete.fetcher),
    (error) => error.code === "spreadsheet_not_owner_private",
  );
});

test("unverified readback, busy lock and exhausted quota never claim delivery", async () => {
  const corrupt = fixture({ corruptReadback: true });
  await assert.rejects(
    deliverJob(job(), env, corrupt.fetcher),
    (error) => error.code === "mirror_readback_failed",
  );
  const busy = fixture({ locked: true });
  await assert.rejects(
    deliverJob(job(), env, busy.fetcher),
    (error) => error.code === "relay_busy",
  );
  assert.equal(busy.state.calls, 0);
  const quota = fixture({ quota: 0 });
  await assert.rejects(
    deliverJob(job("owner_email"), env, quota.fetcher),
    (error) => error.code === "email_daily_quota_exhausted",
  );
  assert.equal(quota.mail.length, 0);
});

test("owner email contains complete packet, sends only to owner, and duplicate jobs reuse accepted parts", async () => {
  const f = fixture();
  await deliverJob(job("owner_email"), env, f.fetcher);
  await deliverJob(
    job("owner_email", payload, "another-job-id"),
    env,
    f.fetcher,
  );
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].to, owner);
  assert.equal(f.mail[0].attachments[0].content, answerPacket(payload));
  const rendered = JSON.parse(f.state.lastEnvelope.body).email.parts[0];
  assert.equal(f.mail[0].body, rendered.text);
  assert.equal(f.mail[0].htmlBody, rendered.html);
  assert.match(f.mail[0].htmlBody, /<table/i);
  assert.equal(JSON.parse(f.sheets[0].cells[1][7]).parts[0].status, "accepted");
  const parts = f.ctx.relayUtf8Parts("ñ🤝abc".repeat(101), 19);
  assert.equal(parts.join(""), "ñ🤝abc".repeat(101));
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part, "utf8") <= 19);
    assert.equal(/[\uD800-\uDBFF]$/.test(part), false);
  }
});

test("long email body parts reconstruct every numbered raw answer and resume over daily quotas", async () => {
  const large = structuredClone(payload);
  large.answers[0].text = "ñ 🤝 中文 ".repeat(30000);
  const f = fixture();
  await deliverJob(job("owner_email", large), env, f.fetcher);
  assert.ok(f.mail.length > 1);
  const rendered = JSON.parse(f.state.lastEnvelope.body).email.parts;
  assert.deepEqual(f.mail.map(message => message.body), rendered.map(part => part.text));
  assert.deepEqual(f.mail.map(message => message.htmlBody), rendered.map(part => part.html));
  assert.equal(
    f.mail.map((message) => message.attachments[0].content).join(""),
    answerPacket(large),
  );
  assert.ok(
    f.mail.every(
      (message) =>
        message.to === owner &&
        Buffer.byteLength(message.body, "utf8") + Buffer.byteLength(message.htmlBody, "utf8") <= 150000,
    ),
  );
  const quota = fixture({ quota: 1 });
  await assert.rejects(
    deliverJob(job("owner_email", large), env, quota.fetcher),
    (error) => error.code === "email_daily_quota_exhausted",
  );
  assert.equal(
    quota.mail.length,
    1,
    "Send only the affordable part and leave the full job pending",
  );
  quota.state.quota = 100;
  await deliverJob(job("owner_email", large), env, quota.fetcher);
  assert.equal(
    quota.mail.length,
    f.mail.length,
    "Do not resend the previously accepted part",
  );
  assert.equal(
    quota.mail.map(message => message.attachments[0].content).join(""),
    answerPacket(large),
  );
});

test("ambiguous MailApp acceptance requires explicit owner resolution and never silently duplicates", async () => {
  const f = fixture({ failMailAfterAccept: true });
  await assert.rejects(deliverJob(job("owner_email"), env, f.fetcher));
  assert.equal(f.mail.length, 1);
  f.state.failMailAfterAccept = false;
  await assert.rejects(
    deliverJob(job("owner_email"), env, f.fetcher),
    (error) => error.code === "email_confirmation_required",
  );
  assert.equal(f.mail.length, 1, "Ambiguous send is never blindly repeated");
  f.props.set("EXAM_MAIL_RESOLVE_TAB", f.sheets[0].properties.title);
  f.props.set("EXAM_MAIL_RESOLVE_PART", "1");
  f.props.set("EXAM_MAIL_RESOLVE_ACTION", "confirm");
  f.ctx.resolvePendingOwnerEmail();
  await deliverJob(job("owner_email"), env, f.fetcher);
  assert.equal(f.mail.length, 1);
  assert.equal(f.props.has("EXAM_MAIL_RESOLVE_ACTION"), false);
});

test("GET exposes no examination and final-email gating remains explicit", async () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(f.ctx.doGet().text), {
    ok: false,
    code: "signed_post_required",
  });
  assert.deepEqual(unsigned(f.ctx.verifyRelaySetup()), {
    ready: true,
    owner,
    remainingEmailRecipients: 100,
  });
  await assert.rejects(
    deliverJob(
      job("owner_email"),
      { ...env, EMAIL_DELIVERY_ENABLED: "false" },
      f.fetcher,
    ),
    /not enabled/,
  );
  assert.equal(f.mail.length, 0);
});

test("raw owner packets preserve whitespace-only answers and explicit empty slots", () => {
  const raw = structuredClone(payload);
  raw.answers[0].text = "  \t\n \r\n";
  const packet = answerPacket(raw);
  assert.ok(
    packet.includes("synthetic-answer-hash\n" + raw.answers[0].text + "\n"),
  );
  assert.ok(packet.includes("[BLANK ANSWER]"));
});

test("archiving an official routing alias never changes the frozen final-copy identity", async () => {
  const f = fixture(),
    official = structuredClone(payload);
  official.exam.slug = "official";
  official.exam.kind = "official";
  await deliverJob(job("sheets", official), env, f.fetcher);
  const archived = structuredClone(official);
  archived.exam.slug = "archived-" + archived.exam.id;
  await deliverJob(
    job("owner_email", archived, "delayed-final-email"),
    env,
    f.fetcher,
  );
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].attachments[0].content, answerPacket(official));
  assert.equal(f.sheets.length, 1);
});
