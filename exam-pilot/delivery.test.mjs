import { test } from "node:test";
import assert from "node:assert/strict";
import { answerPacket, deliverJob, studentTabTitle } from "./delivery.mjs";

const payload = {
  schemaVersion: 1,
  exam: { id: "exam-test", title: "Synthetic examination", instructions: "Read every question carefully.", durationMinutes: 20 },
  attempt: {
    id: "attempt-test",
    name: "Synthetic Student",
    email: "synthetic@example.invalid",
    startedAt: 1000,
    deadlineAt: 2000,
    status: "submitted",
    finalizedAt: 1900,
  },
  questions: [
    { id: "q1", number: 1, text: "Synthetic question one" },
    { id: "q2", number: 2, text: "Synthetic question two" },
  ],
  answers: [
    {
      questionId: "q1",
      revision: 2,
      text: "Complete multiline\nanswer",
      hash: "answer-checksum",
      savedAt: 1800,
    },
  ],
  receipt: {
    id: "receipt-test",
    serverTime: 1900,
    finalizationType: "manual",
    answeredCount: 1,
    questionCount: 2,
    checksum: "receipt-checksum",
  },
};
test("owner packet contains every question including explicit blanks and receipt checksums", () => {
  const packet = answerPacket(payload);
  for (const text of [
    "Question 1",
    "Question 2",
    "[BLANK ANSWER]",
    "Complete multiline\nanswer",
    "answer-checksum",
    "receipt-checksum",
    "attempt-test",
    "synthetic@example.invalid",
    "Submitted (PHT): 1970-01-01 08:00:01 PHT (UTC+08:00)",
    "Read every question carefully.",
  ])
    assert.ok(packet.includes(text), text);
});
test("R2 snapshot is independent full content and verified after put", async () => {
  let body, metadata;
  const result = await deliverJob(
    { id: "job-1", target: "r2", payload },
    {
      EXAM_BACKUPS: {
        put: async (key, value, options) => {
          body = JSON.parse(value);
          metadata = options.customMetadata;
        },
        head: async () => ({ customMetadata: metadata }),
      },
    },
  );
  assert.deepEqual(body, payload);
  assert.match(
    result.reference,
    /snapshots\/exam-test\/attempt-test\/job-1.json/,
  );
  await assert.rejects(
    deliverJob(
      { id: "job-1", target: "r2", payload },
      {
        EXAM_BACKUPS: {
          put: async () => {},
          head: async () => null,
        },
      },
    ),
    /verification/,
  );
});
test("unconfigured deliveries fail honestly without external requests", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("must not run");
  };
  for (const target of ["r2", "sheets", "owner_email", "student_receipt"]) {
    await assert.rejects(
      deliverJob({ id: "job-2", target, payload }, {}, fetcher),
    );
  }
  assert.equal(calls, 0);
});
test("email copy goes only to owner and concise student receipt has no full answers", async () => {
  const env = {
    EMAIL_DELIVERY_ENABLED: "true",
    RESEND_API_KEY: "synthetic-key",
    EXAM_EMAIL_FROM: "synthetic@example.invalid",
  };
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ id: "synthetic-message" });
  };
  await deliverJob(
    { id: "owner-job", target: "owner_email", payload },
    env,
    fetcher,
  );
  const owner = JSON.parse(requests[0].body);
  assert.deepEqual(owner.to, ["wallyesteban1993@gmail.com"]);
  assert.ok(owner.text.includes("[BLANK ANSWER]"));
  assert.ok(owner.text.includes("Complete multiline\nanswer"));
  assert.equal(requests[0].headers["Idempotency-Key"], "exam-owner-job");
  await deliverJob(
    { id: "student-job", target: "student_receipt", payload },
    env,
    fetcher,
  );
  const student = JSON.parse(requests[1].body);
  assert.deepEqual(student.to, ["synthetic@example.invalid"]);
  assert.ok(!student.text.includes("Complete multiline"));
});
test("provider failures do not disclose private response contents or mark success", async () => {
  await assert.rejects(
    deliverJob(
      { id: "job", target: "owner_email", payload },
      {
        EMAIL_DELIVERY_ENABLED: "true",
        RESEND_API_KEY: "fake",
        EXAM_EMAIL_FROM: "test@example.invalid",
      },
      async () => new Response("private provider detail", { status: 429 }),
    ),
    (error) => {
      assert.equal(error.message, "Email provider returned HTTP 429");
      return true;
    },
  );
});
test("large complete owner copies are divided without truncation and each part has a retry key", async () => {
  const large = structuredClone(payload);
  large.answers[0].text = "Unicode ñ 🤝 ".repeat(60000);
  const sent = [];
  await deliverJob(
    { id: "large-job", target: "owner_email", payload: large },
    {
      EMAIL_DELIVERY_ENABLED: "true",
      RESEND_API_KEY: "fake",
      EXAM_EMAIL_FROM: "test@example.invalid",
    },
    async (url, options) => {
      sent.push(options);
      return Response.json({ id: `part-${sent.length}` });
    },
  );
  assert.ok(sent.length > 1);
  const reconstructed = sent
    .map((options) =>
      JSON.parse(options.body).text.split("\n\n").slice(1).join("\n\n"),
    )
    .join("");
  assert.equal(reconstructed, answerPacket(large));
  assert.equal(
    new Set(sent.map((options) => options.headers["Idempotency-Key"])).size,
    sent.length,
  );
});
test("Google mirror preserves long Unicode answers, uses literal cells and atomic replacement, retries the same readable tab", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`;
  const env = {
    GOOGLE_SPREADSHEET_ID: "synthetic-sheet",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "fake@example.invalid",
      private_key: pem,
    }),
  };
  const long = structuredClone(payload);
  long.answers[0].text = "=" + "x".repeat(39998) + "🤝" + "x".repeat(50000);
  long.questions[0].text = "Q".repeat(80000);
  const writes = [];
  const sheets = [{ properties: { title: "attempt_attempttest", sheetId: 12, gridProperties: { rowCount: 1000 } } }];
  const fetcher = async (url, options) => {
    if (url.includes("oauth2.googleapis.com"))
      return Response.json({ access_token: "synthetic" });
    if (url.includes("?fields="))
      return Response.json({ sheets });
    writes.push({ url, options });
    const added = JSON.parse(options.body).requests[0].addSheet;
    if (added) sheets.push({ properties: { ...added.properties, sheetId: 13 } });
    return Response.json({ replies: JSON.parse(options.body).requests.map(() => ({})) });
  };
  await deliverJob(
    { id: "sheets-job", target: "sheets", payload: long },
    env,
    fetcher,
  );
  await deliverJob(
    { id: "sheets-job", target: "sheets", payload: long },
    env,
    fetcher,
  );
  assert.equal(writes[0].url, writes[1].url);
  assert.ok(writes[0].url.endsWith(":batchUpdate"));
  const update = JSON.parse(writes[0].options.body).requests[1].updateCells;
  const properties = JSON.parse(writes[0].options.body).requests[0].updateSheetProperties.properties;
  assert.equal(properties.title, await studentTabTitle(long.attempt));
  assert.ok(properties.title.startsWith("Synthetic Student · "));
  const rows = update.rows.map((row) =>
    row.values.map((cell) => cell.userEnteredValue.stringValue),
  );
  const header = rows.findIndex(row => row[0] === "Question");
  const chunks = rows.slice(header + 1, header + 4).map((row) => row[2]);
  assert.equal(chunks.join(""), long.answers[0].text);
  assert.equal(
    rows
      .slice(header + 1, header + 4)
      .map((row) => row[1])
      .join(""),
    long.questions[0].text,
  );
  assert.equal(update.range.endRowIndex, 1000);
  assert.ok(rows.at(-1).includes("[BLANK ANSWER]"));
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 40000);
    assert.equal(/[\uD800-\uDBFF]$/.test(chunk), false);
    assert.equal(/^[\uDC00-\uDFFF]/.test(chunk), false);
  }
  assert.ok(rows.some(row => row[0] === "Examination title" && row[1] === "Synthetic examination"));
  assert.ok(rows.some(row => row[0] === "Student email" && row[1] === "synthetic@example.invalid"));
  assert.ok(rows.some(row => row[0] === "Submitted (PHT)" && row[1].includes("PHT (UTC+08:00)")));
  assert.ok(rows.some(row => row[0] === "Examination instructions" && row[1] === payload.exam.instructions));
  assert.equal(chunks[0][0], "=");
  assert.ok(update.rows.flatMap(row => row.values).every(cell => !cell.userEnteredValue.formulaValue));
  assert.ok(update.rows.flatMap(row => row.values).every(cell => cell.userEnteredFormat.wrapStrategy === "WRAP"));
  assert.ok(JSON.parse(writes[0].options.body).requests.some(request => request.updateDimensionProperties?.properties.pixelSize === 560));
  const next = structuredClone(payload);
  next.attempt.id = "a-different-student-attempt";
  await deliverJob({ id: "another-student-job", target: "sheets", payload: next }, env, fetcher);
  const created = writes.map(write => JSON.parse(write.options.body).requests[0].addSheet).find(Boolean);
  assert.deepEqual(created.properties.gridProperties, { rowCount: 100, columnCount: 6 });
  const nextGrid = JSON.parse(writes.at(-1).options.body).requests[0].updateSheetProperties.properties.gridProperties;
  assert.equal(nextGrid.rowCount, 100);
  assert.equal(nextGrid.columnCount, 6);
});

test("readable tab suffix preserves all UUID bits and safely handles forbidden title characters", async () => {
  const first = { id: "7db5bd4c-8467-4412-b543-4542d82ca683", name: "=Student [Private]: / ? * \\ ' ".repeat(5) };
  const second = { ...first, id: "7db5bd4c-8467-4412-b543-4542d82ca684" };
  const title = await studentTabTitle(first), other = await studentTabTitle(second);
  assert.notEqual(title, other);
  assert.ok(title.length <= 100);
  assert.equal(/[:\\/?*\[\]\u0000-\u001f]/.test(title), false);
  const suffix = title.split(" · ").at(-1);
  assert.equal(suffix.length, 22);
  assert.equal(Buffer.from(suffix, "base64url").toString("hex"), first.id.replaceAll("-", ""));
  assert.equal(await studentTabTitle(first), title);
});
