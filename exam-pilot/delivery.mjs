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

export function answerPacket(payload) {
  const { exam, attempt, questions, answers, receipt } = payload;
  const lines = [
    exam.title,
    `Exam: ${exam.id}`,
    `Attempt: ${attempt.id}`,
    `Student: ${attempt.name}`,
    `Email: ${attempt.email}`,
    `Started (UTC): ${timestamp(attempt.startedAt)}`,
    `Deadline (UTC): ${timestamp(attempt.deadlineAt)}`,
    `Finalized (UTC): ${timestamp(receipt?.serverTime ?? attempt.finalizedAt)}`,
    `Finalization: ${receipt?.finalizationType ?? "In progress"}`,
    `Receipt: ${receipt?.id ?? "Pending"}`,
    `Checksum: ${receipt?.checksum ?? "Pending"}`,
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
    const parts = [];
    for (let offset = 0; offset < text.length; ) {
      let end = Math.min(offset + 300000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      parts.push(text.slice(offset, end));
      offset = end;
    }
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
    const tab = `attempt_${payload.attempt.id.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 70)}`;
    const origin = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const metadataURL = `${origin}?fields=sheets.properties(sheetId,title,gridProperties)`;
    let metadata = await (
      await providerRequest(fetcher, metadataURL, { headers }, "Google Sheets")
    ).json();
    if (!metadata.sheets?.some((sheet) => sheet.properties?.title === tab)) {
      // Another delivery may create the tab concurrently. Confirm existence after an
      // ambiguous add, rather than treating a provider error as a successful mirror.
      const added = await fetcher(`${origin}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tab } } }],
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
    const properties = metadata.sheets?.find(
      (sheet) => sheet.properties?.title === tab,
    )?.properties;
    if (!Number.isInteger(properties?.sheetId))
      throw new Error("Google Sheets did not identify the mirror tab");
    const answers = new Map(
      payload.answers.map((answer) => [answer.questionId, answer]),
    );
    const values = [
      ["Exam", payload.exam.id],
      ["Attempt", payload.attempt.id],
      ["Student", payload.attempt.name],
      ["Email", payload.attempt.email],
      ["Receipt", payload.receipt?.id ?? "In progress"],
      ["Checksum", payload.receipt?.checksum ?? ""],
      [
        "Question",
        "Question text",
        "Answer",
        "Revision",
        "Server saved UTC",
        "Checksum",
      ],
    ];
    for (const question of payload.questions) {
      const answer = answers.get(question.id);
      // Google Sheets has a 50k character cell limit. Split full long content across
      // explicitly numbered continuation rows; never truncate an examination answer.
      const chunks = (answer?.text || "[BLANK ANSWER]").match(
        /[\s\S]{1,40000}/g,
      ) || [""];
      const questionChunks =
        `${question.text}${question.instructions ? `\n\nInstructions: ${question.instructions}` : ""}`.match(
          /[\s\S]{1,40000}/g,
        ) || [""];
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
          answer?.savedAt == null ? "" : timestamp(answer.savedAt),
          answer?.hash ?? "",
        ]);
    }
    const rowCount = Math.max(
      properties.gridProperties?.rowCount || 1000,
      values.length,
    );
    // One atomic batch replaces all mirror cells, including clearing old trailing
    // continuation rows. Explicit string values never execute spreadsheet formulas.
    const response = await providerRequest(
      fetcher,
      `${origin}:batchUpdate`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: properties.sheetId,
                  gridProperties: { rowCount },
                },
                fields: "gridProperties.rowCount",
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
                rows: values.map((row) => ({
                  values: row.map((value) => ({
                    userEnteredValue: { stringValue: String(value) },
                  })),
                })),
                fields: "userEnteredValue",
              },
            },
          ],
        }),
      },
      "Google Sheets",
    );
    const result = await response.json();
    if (result.replies?.length !== 2)
      throw new Error(
        "Google Sheets did not confirm the complete atomic mirror",
      );
    return {
      reference: `https://docs.google.com/spreadsheets/d/${spreadsheet}/edit`,
    };
  }
  throw new Error("Unknown backup delivery target");
}
