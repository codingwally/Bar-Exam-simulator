// Independent copies are asynchronous. A failed provider never changes a receipt.
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
const phtTimestamp = (value) => value == null ? "Not recorded" : `${new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")} PHT (UTC+08:00)`;
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
    ? Uint8Array.from(compact.match(/../g), byte => parseInt(byte, 16))
    : new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(attempt.id)))).slice(0, 16);
  const name = String(attempt.name || "Student").replace(/[:\\/?*\[\]\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "") || "Student";
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
    ...(exam.instructions ? ["", "Examination instructions:", exam.instructions] : []),
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
      answer?.text?.trim() ? answer.text : "[BLANK ANSWER]",
      "",
      "────────────────────",
      "",
    );
  }
  return lines.join("\n");
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
    const owner = job.target === "owner_email";
    const recipient = owner ? OWNER_EMAIL : payload.attempt.email;
    const text = owner
      ? answerPacket(payload)
      : [
          payload.exam.title,
          "Your examination was received.",
          `Receipt: ${payload.receipt.id}`,
          `Received (UTC): ${timestamp(payload.receipt.serverTime)}`,
          `Answered: ${payload.receipt.answeredCount} of ${payload.receipt.questionCount}`,
          `Checksum: ${payload.receipt.checksum}`,
        ].join("\n");
    // Resend's 24-hour idempotency window is supplemented by the durable outbox.
    const parts = textParts(text, 300000);
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
            to: [recipient],
            subject: owner
              ? `Examination answer backup — ${payload.receipt.id}${multipart ? ` (${index + 1}/${parts.length})` : ""}`
              : "Your examination receipt",
            text: multipart
              ? `Answer backup part ${index + 1} of ${parts.length}. Preserve every part. Receipt ${payload.receipt.id}.\n\n${parts[index]}`
              : parts[index],
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
    if (!metadata.sheets?.some((sheet) => [tab, legacyTab].includes(sheet.properties?.title))) {
      // Another delivery may create the tab concurrently. Confirm existence after an
      // ambiguous add, rather than treating a provider error as a successful mirror.
      const added = await fetcher(`${origin}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tab, gridProperties: { rowCount: 100, columnCount: 6 } } } }],
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
    const properties = (metadata.sheets?.find(sheet => sheet.properties?.title === tab)
      || metadata.sheets?.find(sheet => sheet.properties?.title === legacyTab))?.properties;
    if (!Number.isInteger(properties?.sheetId))
      throw new Error("Google Sheets did not identify the mirror tab");
    const answers = new Map(
      payload.answers.map((answer) => [answer.questionId, answer]),
    );
    const values = [
      ["EXAMINATION SUBMISSION", payload.exam.title],
      ["Student name", payload.attempt.name],
      ["Student email", payload.attempt.email],
      ["Examination title", payload.exam.title],
      ["Status", payload.receipt ? "Submitted — final answers" : "In progress — autosaved draft"],
      ["Submitted (PHT)", payload.receipt ? phtTimestamp(payload.receipt.serverTime) : "Not submitted"],
      ["Started (PHT)", phtTimestamp(payload.attempt.startedAt)],
      ["Deadline (PHT)", phtTimestamp(payload.attempt.deadlineAt)],
      ["Receipt", payload.receipt?.id ?? "In progress"],
      ["Receipt checksum", payload.receipt?.checksum ?? ""],
      ["Attempt ID", payload.attempt.id],
      ["Exam ID", payload.exam.id],
      ["Answered questions", payload.receipt ? `${payload.receipt.answeredCount} of ${payload.receipt.questionCount}` : "Not submitted"],
      ["Finalization", payload.receipt?.finalizationType ?? "In progress"],
      ["Time allowed", payload.exam.durationMinutes ? `${payload.exam.durationMinutes} minutes` : "See deadline"],
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
    const questionHeader = values.length - 1;
    for (const question of payload.questions) {
      const answer = answers.get(question.id);
      // Google Sheets has a 50k character cell limit. Split full long content across
      // explicitly numbered continuation rows; never truncate an examination answer.
      const chunks = textParts(answer?.text || "[BLANK ANSWER]", 40000);
      const questionChunks = textParts(`${question.text}${question.instructions ? `\n\nInstructions: ${question.instructions}` : ""}`, 40000);
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
    const rowCount = Math.max(
      properties.gridProperties?.rowCount || 1000,
      values.length,
    );
    // One atomic batch replaces all mirror cells, including clearing old trailing
    // continuation rows. Explicit string values never execute spreadsheet formulas.
    const requests = [
      {
        updateSheetProperties: {
          properties: { sheetId: properties.sheetId, title: tab, gridProperties: { rowCount, columnCount: Math.max(properties.gridProperties?.columnCount || 6, 6), frozenRowCount: 1 } },
          fields: "title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
        },
      },
      {
        updateCells: {
          range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 6 },
          rows: values.map((row, rowIndex) => ({
            values: row.map((value, columnIndex) => ({
              userEnteredValue: { stringValue: String(value) },
              userEnteredFormat: {
                wrapStrategy: "WRAP", verticalAlignment: "TOP",
                textFormat: { fontFamily: "Arial", fontSize: 11, bold: rowIndex === 0 || rowIndex === questionHeader || (rowIndex < questionHeader - 1 && columnIndex === 0), ...([0, questionHeader].includes(rowIndex) ? { foregroundColor: { red: 1, green: 1, blue: 1 } } : {}) },
                ...([0, questionHeader].includes(rowIndex) ? { backgroundColor: { red: 0.08, green: 0.13, blue: 0.20 } } : {}),
              },
            })),
          })),
          fields: "userEnteredValue,userEnteredFormat",
        },
      },
      ...[[0, 1, 180], [1, 3, 560], [3, 4, 90], [4, 6, 240]].map(([startIndex, endIndex, pixelSize]) => ({
        updateDimensionProperties: { range: { sheetId: properties.sheetId, dimension: "COLUMNS", startIndex, endIndex }, properties: { pixelSize }, fields: "pixelSize" },
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
