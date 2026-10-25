// Independent copies are asynchronous. A failed provider never changes a receipt.
import { buildSubmissionEmails } from "./email-template.mjs";
const OWNER_EMAIL = "wallyesteban1993@gmail.com";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encode(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}
function required(env, name) {
  if (!env[name]) throw new Error(`${name} is not configured`);
  return env[name];
}
const timestamp = (value) =>
  value == null ? "Not recorded" : new Date(value).toISOString();
const phtTimestamp = (value) =>
  value == null
    ? "Not recorded"
    : `${new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")} PHT (UTC+08:00)`;
function textParts(value, limit) {
  const parts = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + limit, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    parts.push(value.slice(offset, end));
    offset = end;
  }
  return parts.length ? parts : [""];
}
export async function studentTabTitle(attempt) {
  const compact = String(attempt.id).replaceAll("-", "");
  // UUIDs keep all 128 identity bits in 22 readable characters. Unlike a
  // truncated ID, two UUID attempts cannot share this suffix.
  const identity = /^[a-f0-9]{32}$/i.test(compact)
    ? Uint8Array.from(compact.match(/../g), (byte) => parseInt(byte, 16))
    : new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          encoder.encode(String(attempt.id)),
        ),
      ).slice(0, 16);
  const name =
    String(attempt.name || "Student")
      .replace(/[:\\/?*\[\]\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "") || "Student";
  return `${textParts(name, 60)[0]} · ${base64url(identity)}`;
}

export function answerPacket(payload) {
  const { exam, attempt, questions, answers, receipt } = payload;
  const lines = [
    exam.title,
    `Exam: ${exam.id}`,
    `Attempt: ${attempt.id}`,
    `Student: ${attempt.name}`,
    `Email: ${attempt.email}`,
    `Started (PHT): ${phtTimestamp(attempt.startedAt)}`,
    `Deadline (PHT): ${phtTimestamp(attempt.deadlineAt)}`,
    `Submitted (PHT): ${receipt ? phtTimestamp(receipt.serverTime) : "Not submitted"}`,
    `Started (UTC): ${timestamp(attempt.startedAt)}`,
    `Deadline (UTC): ${timestamp(attempt.deadlineAt)}`,
    `Finalized (UTC): ${timestamp(receipt?.serverTime ?? attempt.finalizedAt)}`,
    `Finalization: ${receipt?.finalizationType ?? "In progress"}`,
    `Receipt: ${receipt?.id ?? "Pending"}`,
    `Checksum: ${receipt?.checksum ?? "Pending"}`,
    ...(exam.instructions
      ? ["", "Examination instructions:", exam.instructions]
      : []),
    "",
  ];
  const map = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (const question of questions) {
    const answer = map.get(question.id);
    lines.push(
      `Question ${question.number}`,
      question.text,
      question.instructions || "",
      `Answer revision: ${answer?.revision ?? 0}`,
      `Server saved (UTC): ${timestamp(answer?.savedAt)}`,
      `Answer checksum: ${answer?.hash ?? "Blank"}`,
      answer?.text?.length ? answer.text : "[BLANK ANSWER]",
      "",
      "────────────────────",
      "",
    );
  }
  return lines.join("\n");
}

export function sheetMirrorValues(payload) {
  const answers = new Map(
    payload.answers.map((answer) => [answer.questionId, answer]),
  );
  const values = [
    ["EXAMINATION SUBMISSION", payload.exam.title],
    ["Student name", payload.attempt.name],
    ["Student email", payload.attempt.email],
    ["Examination title", payload.exam.title],
    [
      "Status",
      payload.receipt
        ? "Submitted — final answers"
        : "In progress — autosaved draft",
    ],
    [
      "Submitted (PHT)",
      payload.receipt
        ? phtTimestamp(payload.receipt.serverTime)
        : "Not submitted",
    ],
    ["Started (PHT)", phtTimestamp(payload.attempt.startedAt)],
    ["Deadline (PHT)", phtTimestamp(payload.attempt.deadlineAt)],
    ["Receipt", payload.receipt?.id ?? "In progress"],
    ["Receipt checksum", payload.receipt?.checksum ?? ""],
    ["Attempt ID", payload.attempt.id],
    ["Exam ID", payload.exam.id],
    [
      "Answered questions",
      payload.receipt
        ? `${payload.receipt.answeredCount} of ${payload.receipt.questionCount}`
        : "Not submitted",
    ],
    ["Finalization", payload.receipt?.finalizationType ?? "In progress"],
    [
      "Time allowed",
      payload.exam.durationMinutes
        ? `${payload.exam.durationMinutes} minutes`
        : "See deadline",
    ],
    ["Examination instructions", payload.exam.instructions || ""],
    [],
    [
      "Question",
      "Complete question and instructions",
      "Student answer",
      "Revision",
      "Server saved (PHT)",
      "Answer checksum",
    ],
  ];
  for (const question of payload.questions) {
    const answer = answers.get(question.id);
    // Google Sheets has a 50k character cell limit. Split full long content across
    // explicitly numbered continuation rows; never truncate an examination answer.
    const chunks = textParts(answer?.text || "[BLANK ANSWER]", 40000);
    const questionChunks = textParts(
      `${question.text}${question.instructions ? `\n\nInstructions: ${question.instructions}` : ""}`,
      40000,
    );
    for (
      let index = 0;
      index < Math.max(chunks.length, questionChunks.length);
      index++
    )
      values.push([
        `${question.number}${index ? ` (continued ${index + 1})` : ""}`,
        questionChunks[index] || "",
        chunks[index] || "",
        answer?.revision ?? 0,
        answer?.savedAt == null ? "" : phtTimestamp(answer.savedAt),
        answer?.hash ?? "",
      ]);
  }
  return values;
}

async function providerRequest(fetcher, url, options, label) {
  const response = await fetcher(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`${label} returned HTTP ${response.status}`);
  return response;
}

async function sha256(value) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

function receiptRecipient(payload, target) {
  const email = payload.attempt?.email;
  if (typeof email !== "string" || email.length > 254 || !/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(email))
    throw new Error("The submitted email address is invalid");
  return target === "owner_email" ? OWNER_EMAIL : email;
}

export async function submissionEmailData(payload, target, env = {}) {
  if (!["owner_email", "student_receipt"].includes(target)) throw new Error("Unknown submission email target");
  const recipient = receiptRecipient(payload, target);
  const owner = target === "owner_email";
  const spreadsheet = env.GOOGLE_SPREADSHEET_ID;
  if (owner && spreadsheet && !/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheet))
    throw new Error("The private collection identifier is invalid");
  const rendered = buildSubmissionEmails(payload, {
    audience: owner ? "owner" : "student",
    ...(owner ? {
      spreadsheetUrl: spreadsheet ? `https://docs.google.com/spreadsheets/d/${spreadsheet}/edit` : "",
      ownerPacket: answerPacket(payload),
    } : {}),
  });
  const data = { recipient, attemptEmail: payload.attempt.email, subject: rendered.subject, parts: rendered.parts };
  return { ...data, contentHash: await sha256(JSON.stringify(data)) };
}
async function relaySignature(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}

export async function deliverRelay(job, env, fetcher) {
  const url = new URL(required(env, "EXAM_RELAY_URL"));
  if (
    url.origin !== "https://script.google.com" ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "The backup relay must be a deployed Google Apps Script web app",
    );
  const secret = required(env, "EXAM_RELAY_SECRET");
  if (secret.length < 32)
    throw new Error("The backup relay secret is too short");
  if (
    ["owner_email", "student_receipt"].includes(job.target) &&
    (env.EMAIL_DELIVERY_ENABLED !== "true" || !job.payload.receipt)
  )
    throw new Error("Final email delivery is not enabled");
  if (!["sheets", "owner_email", "student_receipt"].includes(job.target))
    throw new Error("Unsupported relay target");
  const student = job.target === "student_receipt";
  const values = student ? undefined : sheetMirrorValues(job.payload).map((row) =>
    Array.from({ length: 6 }, (_, i) => String(row[i] ?? "")),
  );
  const packet =
    job.target === "owner_email" ? answerPacket(job.payload) : undefined;
  const email = ["owner_email", "student_receipt"].includes(job.target)
    ? await submissionEmailData(job.payload, job.target, env)
    : undefined;
  // An official exam's routing alias changes when archived. That is not a
  // change to its frozen questions, answers or receipt and must not block retry.
  const { slug: _routingAlias, ...stableExam } = job.payload.exam;
  const data = {
    jobId: job.id,
    target: job.target,
    attemptId: job.payload.attempt.id,
    tabTitle: await studentTabTitle(job.payload.attempt),
    payloadHash: await sha256(JSON.stringify(student
      ? { attemptId: job.payload.attempt.id, receiptId: job.payload.receipt.id, email }
      : { ...job.payload, exam: stableExam })),
    receiptId: job.payload.receipt?.id || null,
    receiptChecksum: job.payload.receipt?.checksum || null,
    ...(!student ? { revisions: job.payload.questions.map((question) => {
      const answer = job.payload.answers.find(
        (item) => item.questionId === question.id,
      );
      return [question.id, answer?.revision ?? 0, answer?.hash || ""];
    }), values, contentHash: await sha256(JSON.stringify(values)) } : {}),
    ...(packet !== undefined
      ? { packet, packetHash: await sha256(packet) }
      : {}),
    ...(email ? { email } : {}),
  };
  const body = JSON.stringify(data),
    issuedAt = Date.now(),
    requestId = crypto.randomUUID();
  // Quota failures remain pending in the durable outbox. Never truncate answers.
  if (encoder.encode(body).byteLength > 40 * 1024 * 1024)
    throw new Error(
      "Backup relay request exceeds its safe Google transfer limit",
    );
  const bodyHash = await sha256(body);
  const envelope = {
    version: 1,
    issuedAt,
    requestId,
    body,
    signature: await relaySignature(
      secret,
      `1\n${issuedAt}\n${requestId}\n${body}`,
    ),
  };
  const response = await providerRequest(
    fetcher,
    url.href,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      redirect: "follow",
    },
    "Google backup relay",
  );
  // ContentService follows a Google-owned one-time download redirect. The HMAC
  // also authenticates this acknowledgement, including the exact request digest.
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Google backup relay returned no verified acknowledgement");
  }
  if (typeof result?.body !== "string" || typeof result.signature !== "string")
    throw new Error("Google backup relay returned no verified acknowledgement");
  const expected = await relaySignature(
    secret,
    `response\n${requestId}\n${bodyHash}\n${result.body}`,
  );
  let mismatch = expected.length ^ result.signature.length;
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ (result.signature.charCodeAt(i) || 0);
  if (mismatch)
    throw new Error("Google backup relay acknowledgement signature is invalid");
  let acknowledgement;
  try {
    acknowledgement = JSON.parse(result.body);
  } catch {
    throw new Error("Google backup relay acknowledgement is invalid");
  }
  if (
    acknowledgement.jobId !== job.id ||
    acknowledgement.target !== job.target ||
    acknowledgement.bodyHash !== bodyHash
  )
    throw new Error("Google backup relay acknowledged a different request");
  if (!acknowledgement.ok) {
    const error = new Error("Google backup relay has not confirmed the copy");
    error.code = /^[a-z_]{1,60}$/.test(acknowledgement.code)
      ? acknowledgement.code
      : "relay_unconfirmed";
    throw error;
  }
  if (
    typeof acknowledgement.reference !== "string" ||
    !acknowledgement.reference ||
    !["verified", "superseded", "accepted", "already_accepted"].includes(
      acknowledgement.disposition,
    )
  )
    throw new Error(
      "Google backup relay returned an incomplete acknowledgement",
    );
  return { reference: acknowledgement.reference };
}

async function googleToken(env, fetcher) {
  let account;
  try {
    account = JSON.parse(required(env, "GOOGLE_SERVICE_ACCOUNT_JSON"));
  } catch {
    throw new Error("Google service account is not configured correctly");
  }
  if (!account.client_email || !account.private_key)
    throw new Error("Google service account is incomplete");
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: GOOGLE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  let key;
  try {
    const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
    key = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("Google signing key is invalid");
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(data),
  );
  const response = await providerRequest(
    fetcher,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${data}.${base64url(new Uint8Array(signature))}`,
      }),
    },
    "Google authorization",
  );
  const body = await response.json();
  if (!body.access_token)
    throw new Error("Google authorization returned no access token");
  return body.access_token;
}

export async function deliverJob(job, env, fetcher = fetch) {
  const originalFetch = fetcher,
    deliveryDeadline = Date.now() + 120000;
  fetcher = (url, options = {}) => {
    const remaining = deliveryDeadline - Date.now();
    if (remaining <= 0)
      throw new Error("Backup provider time budget exhausted");
    return originalFetch(url, {
      ...options,
      signal: AbortSignal.timeout(Math.min(15000, remaining)),
    });
  };
  const payload = job.payload;
  if (env.EXAM_RELAY_URL && ["sheets", "owner_email", "student_receipt"].includes(job.target))
    return deliverRelay(job, env, fetcher);
  if (job.target === "r2") {
    const bucket = required(env, "EXAM_BACKUPS");
    const key = `snapshots/${payload.exam.id}/${payload.attempt.id}/${job.id}.json`;
    const bytes = JSON.stringify(payload);
    const checksum = base64url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(bytes)),
      ),
    );
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { checksum, schemaVersion: "1" },
    });
    const object = await bucket.head(key);
    if (!object || object.customMetadata?.checksum !== checksum)
      throw new Error("R2 verification did not confirm the snapshot");
    return { reference: key };
  }
  if (job.target === "owner_email" || job.target === "student_receipt") {
    // Enabling the provider is a separate deliberate infrastructure action.
    if (env.EMAIL_DELIVERY_ENABLED !== "true")
      throw new Error("Email delivery is not enabled");
    const key = required(env, "RESEND_API_KEY");
    const sender = required(env, "EXAM_EMAIL_FROM");
    if (!payload.receipt)
      throw new Error("A final receipt is required before email delivery");
    const email = await submissionEmailData(payload, job.target, env);
    // Resend's 24-hour idempotency window is supplemented by the durable outbox.
    const parts = email.parts;
    const references = [];
    for (let index = 0; index < parts.length; index++) {
      const multipart = parts.length > 1;
      const response = await providerRequest(
        fetcher,
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `exam-${job.id}${multipart ? `-part-${index + 1}` : ""}`,
          },
          body: JSON.stringify({
            from: sender,
            to: [email.recipient],
            subject: email.subject + (multipart ? ` (Part ${index + 1} of ${parts.length})` : ""),
            text: parts[index].text,
            html: parts[index].html,
          }),
        },
        "Email provider",
      );
      const result = await response.json();
      if (!result.id)
        throw new Error("Email provider returned no message identifier");
      references.push(result.id);
    }
    return { reference: references.join(",") };
  }
  if (job.target === "sheets") {
    const spreadsheet = required(env, "GOOGLE_SPREADSHEET_ID");
    if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheet))
      throw new Error("Google spreadsheet identifier is invalid");
    const token = await googleToken(env, fetcher);
    // A dedicated tab per attempt is replaced atomically with RAW text, making retries
    // idempotent and avoiding append duplicates or formula execution in answers.
    const tab = await studentTabTitle(payload.attempt);
    const legacyTab = `attempt_${payload.attempt.id.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 70)}`;
    const origin = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const metadataURL = `${origin}?fields=sheets.properties(sheetId,title,gridProperties)`;
    let metadata = await (
      await providerRequest(fetcher, metadataURL, { headers }, "Google Sheets")
    ).json();
    if (
      !metadata.sheets?.some((sheet) =>
        [tab, legacyTab].includes(sheet.properties?.title),
      )
    ) {
      // Another delivery may create the tab concurrently. Confirm existence after an
      // ambiguous add, rather than treating a provider error as a successful mirror.
      const added = await fetcher(`${origin}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: tab,
                  gridProperties: { rowCount: 100, columnCount: 6 },
                },
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!added.ok) {
        const check = await (
          await providerRequest(
            fetcher,
            metadataURL,
            { headers },
            "Google Sheets",
          )
        ).json();
        if (!check.sheets?.some((sheet) => sheet.properties?.title === tab))
          throw new Error(`Google Sheets returned HTTP ${added.status}`);
      }
      metadata = await (
        await providerRequest(
          fetcher,
          metadataURL,
          { headers },
          "Google Sheets",
        )
      ).json();
    }
    const properties = (
      metadata.sheets?.find((sheet) => sheet.properties?.title === tab) ||
      metadata.sheets?.find((sheet) => sheet.properties?.title === legacyTab)
    )?.properties;
    if (!Number.isInteger(properties?.sheetId))
      throw new Error("Google Sheets did not identify the mirror tab");
    const values = sheetMirrorValues(payload);
    const questionHeader = values.findIndex((row) => row[0] === "Question");
    const rowCount = Math.max(
      properties.gridProperties?.rowCount || 1000,
      values.length,
    );
    // One atomic batch replaces all mirror cells, including clearing old trailing
    // continuation rows. Explicit string values never execute spreadsheet formulas.
    const requests = [
      {
        updateSheetProperties: {
          properties: {
            sheetId: properties.sheetId,
            title: tab,
            gridProperties: {
              rowCount,
              columnCount: Math.max(
                properties.gridProperties?.columnCount || 6,
                6,
              ),
              frozenRowCount: 1,
            },
          },
          fields:
            "title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
        },
      },
      {
        updateCells: {
          range: {
            sheetId: properties.sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: 6,
          },
          rows: values.map((row, rowIndex) => ({
            values: row.map((value, columnIndex) => ({
              userEnteredValue: { stringValue: String(value) },
              userEnteredFormat: {
                wrapStrategy: "WRAP",
                verticalAlignment: "TOP",
                textFormat: {
                  fontFamily: "Arial",
                  fontSize: 11,
                  bold:
                    rowIndex === 0 ||
                    rowIndex === questionHeader ||
                    (rowIndex < questionHeader - 1 && columnIndex === 0),
                  ...([0, questionHeader].includes(rowIndex)
                    ? { foregroundColor: { red: 1, green: 1, blue: 1 } }
                    : {}),
                },
                ...([0, questionHeader].includes(rowIndex)
                  ? { backgroundColor: { red: 0.08, green: 0.13, blue: 0.2 } }
                  : {}),
              },
            })),
          })),
          fields: "userEnteredValue,userEnteredFormat",
        },
      },
      ...[
        [0, 1, 180],
        [1, 3, 560],
        [3, 4, 90],
        [4, 6, 240],
      ].map(([startIndex, endIndex, pixelSize]) => ({
        updateDimensionProperties: {
          range: {
            sheetId: properties.sheetId,
            dimension: "COLUMNS",
            startIndex,
            endIndex,
          },
          properties: { pixelSize },
          fields: "pixelSize",
        },
      })),
    ];
    const response = await providerRequest(
      fetcher,
      `${origin}:batchUpdate`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ requests }),
      },
      "Google Sheets",
    );
    const result = await response.json();
    if (result.replies?.length !== requests.length)
      throw new Error(
        "Google Sheets did not confirm the complete atomic mirror",
      );
    return {
      reference: `https://docs.google.com/spreadsheets/d/${spreadsheet}/edit#gid=${properties.sheetId}`,
    };
  }
  throw new Error("Unknown backup delivery target");
}
