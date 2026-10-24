/* Due Diligence private backup relay. No student/browser calls and no secrets in source.
 * Deploy as owner. Script Properties: EXAM_RELAY_SECRET, GOOGLE_SPREADSHEET_ID.
 * H1/H2 in each attempt tab are private integrity/mail journals. Do not edit them.
 */
var EXAM_OWNER = "wallyesteban1993@gmail.com";
var EXAM_RELAY_VERSION = 1;

function relayError(code) {
  var error = new Error(code);
  error.relayCode = code;
  throw error;
}
function relayHash(value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8,
    ),
  ).replace(/=+$/, "");
}
function relayHmac(secret, value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(
      value,
      secret,
      Utilities.Charset.UTF_8,
    ),
  ).replace(/=+$/, "");
}
function relayEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  var difference = a.length ^ b.length;
  for (var i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function relayProperties() {
  var props = PropertiesService.getScriptProperties(),
    secret = props.getProperty("EXAM_RELAY_SECRET"),
    spreadsheet = props.getProperty("GOOGLE_SPREADSHEET_ID");
  if (
    !secret ||
    secret.length < 32 ||
    !spreadsheet ||
    !/^[A-Za-z0-9_-]+$/.test(spreadsheet)
  )
    relayError("relay_not_configured");
  return { secret: secret, spreadsheet: spreadsheet };
}
function relayPrivateFile(spreadsheet) {
  var file = DriveApp.getFileById(spreadsheet),
    owner = file.getOwner();
  if (
    !owner ||
    owner.getEmail().toLowerCase() !== EXAM_OWNER ||
    file.getSharingAccess() !== DriveApp.Access.PRIVATE
  )
    relayError("spreadsheet_not_owner_private");
  var users = file.getEditors().concat(file.getViewers());
  if (
    users.some(function (user) {
      return user.getEmail().toLowerCase() !== EXAM_OWNER;
    })
  )
    relayError("spreadsheet_not_owner_private");
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== EXAM_OWNER)
    relayError("wrong_execution_owner");
  // DriveApp's user lists alone are not a complete proof for group/domain grants.
  // Verify the complete Drive permission list, including published-view access.
  var response = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files/" +
      spreadsheet +
      "/permissions?pageSize=100&includePermissionsForView=published&fields=permissions(type,role,emailAddress),nextPageToken",
    {
      method: "get",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: false,
    },
  );
  if (response.getResponseCode() !== 200)
    relayError("sharing_verification_unavailable");
  var permissionList;
  try {
    permissionList = JSON.parse(response.getContentText());
  } catch (_) {
    relayError("sharing_verification_unavailable");
  }
  if (
    permissionList.nextPageToken ||
    !Array.isArray(permissionList.permissions) ||
    permissionList.permissions.length !== 1 ||
    permissionList.permissions[0].type !== "user" ||
    permissionList.permissions[0].role !== "owner" ||
    String(permissionList.permissions[0].emailAddress).toLowerCase() !==
      EXAM_OWNER
  )
    relayError("spreadsheet_not_owner_private");
}
function relayGoogle(path, method, data, spreadsheet) {
  var response = UrlFetchApp.fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheet + path,
    {
      method: method || "get",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: false,
      ...(data ? { payload: JSON.stringify(data) } : {}),
    },
  );
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300)
    relayError("google_sheet_request_failed");
  try {
    return JSON.parse(response.getContentText());
  } catch (_) {
    relayError("google_sheet_response_invalid");
  }
}
function relayRange(tab, cells) {
  return "'" + tab.replace(/'/g, "''") + "'!" + cells;
}
function relayRead(spreadsheet, tab, cells) {
  return (
    relayGoogle(
      "/values/" +
        encodeURIComponent(relayRange(tab, cells)) +
        "?valueRenderOption=UNFORMATTED_VALUE",
      "get",
      null,
      spreadsheet,
    ).values || []
  );
}
function relayParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    relayError("mirror_journal_invalid");
  }
}
function relayValidate(data) {
  if (
    !data ||
    !["sheets", "owner_email"].includes(data.target) ||
    typeof data.jobId !== "string" ||
    !data.jobId ||
    data.jobId.length > 120 ||
    typeof data.attemptId !== "string" ||
    !data.attemptId ||
    data.attemptId.length > 120 ||
    typeof data.tabTitle !== "string" ||
    !data.tabTitle ||
    data.tabTitle.length > 100 ||
    /[:\\/?*\[\]\u0000-\u001f]/.test(data.tabTitle) ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.payloadHash) ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.contentHash) ||
    !Array.isArray(data.values) ||
    data.values.length < 18 ||
    data.values.length > 10000 ||
    data.values.some(function (row) {
      return (
        !Array.isArray(row) ||
        row.length !== 6 ||
        row.some(function (cell) {
          return typeof cell !== "string" || cell.length > 40000;
        })
      );
    }) ||
    relayHash(JSON.stringify(data.values)) !== data.contentHash ||
    !Array.isArray(data.revisions) ||
    !data.revisions.length ||
    data.revisions.length > 300
  )
    relayError("relay_payload_invalid");
  var ids = {};
  data.revisions.forEach(function (row) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== "string" ||
      !row[0] ||
      ids[row[0]] ||
      !Number.isSafeInteger(row[1]) ||
      row[1] < 0 ||
      typeof row[2] !== "string"
    )
      relayError("relay_payload_invalid");
    ids[row[0]] = true;
  });
  if (Boolean(data.receiptId) !== Boolean(data.receiptChecksum))
    relayError("relay_payload_invalid");
  if (
    data.target === "owner_email" &&
    (!data.receiptId ||
      typeof data.packet !== "string" ||
      relayHash(data.packet) !== data.packetHash)
  )
    relayError("final_email_required");
}
function relayFindSheet(spreadsheet, data) {
  var metadata = relayGoogle(
    "?fields=sheets.properties",
    "get",
    null,
    spreadsheet,
  );
  var sheet = (metadata.sheets || []).find(function (item) {
    return item.properties.title === data.tabTitle;
  });
  if (sheet) return sheet.properties;
  var response = relayGoogle(
    ":batchUpdate",
    "post",
    {
      requests: [
        {
          addSheet: {
            properties: {
              title: data.tabTitle,
              gridProperties: {
                rowCount: Math.max(100, data.values.length),
                columnCount: 8,
              },
            },
          },
        },
      ],
    },
    spreadsheet,
  );
  var properties =
    response.replies &&
    response.replies[0] &&
    response.replies[0].addSheet &&
    response.replies[0].addSheet.properties;
  if (!properties || !Number.isInteger(properties.sheetId))
    relayError("mirror_tab_unconfirmed");
  return properties;
}
function relayOrder(old, data) {
  if (!old) return "write";
  if (
    old.v !== EXAM_RELAY_VERSION ||
    old.attemptId !== data.attemptId ||
    !Array.isArray(old.revisions)
  )
    relayError("mirror_identity_conflict");
  if (old.receiptId) {
    if (!data.receiptId) return "superseded";
    if (
      old.receiptId !== data.receiptId ||
      old.receiptChecksum !== data.receiptChecksum ||
      old.payloadHash !== data.payloadHash
    )
      relayError("immutable_final_conflict");
    return "write";
  }
  var next = {};
  data.revisions.forEach(function (item) {
    next[item[0]] = item;
  });
  if (old.revisions.length !== data.revisions.length)
    relayError("mirror_question_conflict");
  var lower = false,
    higher = false;
  old.revisions.forEach(function (item) {
    var incoming = next[item[0]];
    if (!incoming) relayError("mirror_question_conflict");
    if (incoming[1] === item[1] && incoming[2] !== item[2])
      relayError("mirror_revision_conflict");
    lower = lower || incoming[1] < item[1];
    higher = higher || incoming[1] > item[1];
  });
  if (lower && (higher || data.receiptId))
    relayError("mirror_revision_conflict");
  return lower ? "superseded" : "write";
}
function relayVerifyMirror(spreadsheet, tab, state) {
  if (
    !Number.isSafeInteger(state.rows) ||
    state.rows < 18 ||
    state.rows > 10000
  )
    relayError("mirror_journal_invalid");
  var rows = relayRead(spreadsheet, tab, "A1:F" + state.rows);
  var normalized = Array.from({ length: state.rows }, function (_, r) {
    return Array.from({ length: 6 }, function (_, c) {
      return String((rows[r] || [])[c] == null ? "" : rows[r][c]);
    });
  });
  if (relayHash(JSON.stringify(normalized)) !== state.contentHash)
    relayError("mirror_readback_failed");
}
function relayCell(value) {
  return { userEnteredValue: { stringValue: String(value) } };
}
function relaySetJournal(spreadsheet, properties, row, value) {
  relayGoogle(
    ":batchUpdate",
    "post",
    {
      requests: [
        {
          updateCells: {
            range: {
              sheetId: properties.sheetId,
              startRowIndex: row,
              endRowIndex: row + 1,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            rows: [{ values: [relayCell(JSON.stringify(value))] }],
            fields: "userEnteredValue",
          },
        },
      ],
    },
    spreadsheet,
  );
  var saved = relayRead(spreadsheet, properties.title, "H" + (row + 1));
  if (!saved[0] || saved[0][0] !== JSON.stringify(value))
    relayError("mirror_journal_unconfirmed");
}
function relayMirror(spreadsheet, data) {
  var properties = relayFindSheet(spreadsheet, data),
    journals = relayRead(spreadsheet, data.tabTitle, "H1:H2");
  var old = relayParse(journals[0] && journals[0][0]);
  if (!old) {
    // A pre-existing, unrecognized tab is never erased automatically.
    var existing = relayRead(spreadsheet, data.tabTitle, "A1");
    if (existing[0] && existing[0][0])
      relayError("mirror_unrecognized_existing_tab");
  }
  var order = relayOrder(old, data),
    reference =
      "https://docs.google.com/spreadsheets/d/" +
      spreadsheet +
      "/edit#gid=" +
      properties.sheetId;
  if (order === "superseded") {
    relayVerifyMirror(spreadsheet, data.tabTitle, old);
    return {
      properties: properties,
      disposition: "superseded",
      reference: reference,
      state: old,
    };
  }
  var state = {
    v: EXAM_RELAY_VERSION,
    attemptId: data.attemptId,
    payloadHash: data.payloadHash,
    receiptId: data.receiptId,
    receiptChecksum: data.receiptChecksum,
    revisions: data.revisions,
    rows: data.values.length,
    contentHash: data.contentHash,
  };
  if (JSON.stringify(state).length > 40000)
    relayError("mirror_journal_too_large");
  var rowCount = Math.max(
      properties.gridProperties.rowCount,
      data.values.length,
    ),
    columnCount = Math.max(properties.gridProperties.columnCount, 8);
  var questionHeader = data.values.findIndex(function (row) {
    return row[0] === "Question";
  });
  var requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: properties.sheetId,
          gridProperties: {
            rowCount: rowCount,
            columnCount: columnCount,
            frozenRowCount: 1,
          },
        },
        fields:
          "gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
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
        rows: data.values.map(function (row, r) {
          return {
            values: row.map(function (value, c) {
              return {
                userEnteredValue: { stringValue: value },
                userEnteredFormat: {
                  wrapStrategy: "WRAP",
                  verticalAlignment: "TOP",
                  textFormat: {
                    fontFamily: "Arial",
                    fontSize: 11,
                    bold:
                      r === 0 ||
                      r === questionHeader ||
                      (r < questionHeader - 1 && c === 0),
                  },
                  ...([0, questionHeader].includes(r)
                    ? {
                        backgroundColor: { red: 0.91, green: 0.88, blue: 0.79 },
                      }
                    : {}),
                },
              };
            }),
          };
        }),
        fields: "userEnteredValue,userEnteredFormat",
      },
    },
    {
      updateCells: {
        range: {
          sheetId: properties.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        rows: [{ values: [relayCell(JSON.stringify(state))] }],
        fields: "userEnteredValue",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: properties.sheetId,
          dimension: "COLUMNS",
          startIndex: 6,
          endIndex: 8,
        },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
  ];
  [
    [0, 1, 180],
    [1, 3, 560],
    [3, 4, 90],
    [4, 6, 240],
  ].forEach(function (item) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: properties.sheetId,
          dimension: "COLUMNS",
          startIndex: item[0],
          endIndex: item[1],
        },
        properties: { pixelSize: item[2] },
        fields: "pixelSize",
      },
    });
  });
  var result = relayGoogle(
    ":batchUpdate",
    "post",
    { requests: requests },
    spreadsheet,
  );
  if (!result.replies || result.replies.length !== requests.length)
    relayError("mirror_write_unconfirmed");
  var confirmed = relayRead(spreadsheet, data.tabTitle, "H1");
  if (!confirmed[0] || confirmed[0][0] !== JSON.stringify(state))
    relayError("mirror_journal_unconfirmed");
  relayVerifyMirror(spreadsheet, data.tabTitle, state);
  return {
    properties: properties,
    disposition: "verified",
    reference: reference,
    state: state,
  };
}
function relayUtf8Parts(value, limit) {
  var parts = [],
    start = 0,
    bytes = 0;
  for (var i = 0; i < value.length;) {
    var code = value.codePointAt(i),
      count = code > 65535 ? 2 : 1,
      size = code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
    if (bytes && bytes + size > limit) {
      parts.push(value.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += count;
  }
  parts.push(value.slice(start));
  return parts;
}
function relayMail(spreadsheet, data, mirror) {
  if (mirror.disposition === "superseded") relayError("final_email_conflict");
  // Complete numbered raw answers are visible in ordinary message bodies. Keep
  // each UTF-8 part well below the consumer MailApp 200 KB body limit.
  var parts = relayUtf8Parts(data.packet, 140000),
    saved = relayRead(spreadsheet, data.tabTitle, "H2"),
    journal = relayParse(saved[0] && saved[0][0]);
  if (
    journal &&
    (journal.attemptId !== data.attemptId ||
      journal.receiptId !== data.receiptId ||
      journal.packetHash !== data.packetHash ||
      journal.parts.length !== parts.length)
  )
    relayError("immutable_email_conflict");
  if (!journal)
    journal = {
      v: 1,
      attemptId: data.attemptId,
      receiptId: data.receiptId,
      packetHash: data.packetHash,
      jobId: data.jobId,
      parts: parts.map(function (part) {
        return { hash: relayHash(part), status: "ready" };
      }),
    };
  if (
    journal.parts.some(function (part) {
      return part.status === "pending";
    })
  )
    relayError("email_confirmation_required");
  var remaining = journal.parts.filter(function (part) {
    return part.status !== "accepted";
  }).length;
  var quota = MailApp.getRemainingDailyQuota();
  if (remaining && quota < 1) relayError("email_daily_quota_exhausted");
  for (var i = 0; i < parts.length; i++) {
    if (journal.parts[i].hash !== relayHash(parts[i]))
      relayError("immutable_email_conflict");
    if (journal.parts[i].status === "accepted") continue;
    // A packet larger than one day's free quota resumes over later days. The
    // outbox remains unconfirmed until every part is accepted; accepted parts
    // are never resent. Check quota before each new pending/send operation.
    if (quota < 1) relayError("email_daily_quota_exhausted");
    // Google MailApp has no idempotency key/message ID. Persist pending BEFORE
    // sending. An interrupted send requires owner confirmation, never blind resend.
    journal.parts[i].status = "pending";
    journal.parts[i].pendingAt = Date.now();
    relaySetJournal(spreadsheet, mirror.properties, 1, journal);
    MailApp.sendEmail({
      to: EXAM_OWNER,
      subject:
        "Examination answer backup — " +
        data.receiptId +
        (parts.length > 1 ? " (" + (i + 1) + "/" + parts.length + ")" : ""),
      body:
        "Private examination answer backup. Preserve every part.\nReceipt: " +
        data.receiptId +
        "\nComplete packet SHA-256 (base64url): " +
        data.packetHash +
        "\nPart: " +
        (i + 1) +
        " of " +
        parts.length +
        "\nPart SHA-256: " +
        journal.parts[i].hash +
        "\nVerified Sheet: " +
        mirror.reference +
        "\nGoogle accepted this message for sending; inbox arrival is not independently confirmed.\n\n--- COMPLETE RAW PACKET PART ---\n" +
        parts[i],
      attachments: [
        Utilities.newBlob(
          parts[i],
          "text/plain",
          "answers-" + (i + 1) + "-of-" + parts.length + ".txt",
        ),
      ],
      name: "Due Diligence examination backups",
    });
    journal.parts[i].status = "accepted";
    journal.parts[i].acceptedAt = Date.now();
    relaySetJournal(spreadsheet, mirror.properties, 1, journal);
    quota--;
  }
  return {
    disposition: remaining ? "accepted" : "already_accepted",
    reference: "mailapp:" + data.receiptId + ":" + data.packetHash,
  };
}
function doPost(e) {
  var config, envelope, bodyHash, data, requestId, result;
  try {
    config = relayProperties();
    if (
      !e ||
      !e.postData ||
      typeof e.postData.contents !== "string" ||
      e.postData.contents.length > 45 * 1024 * 1024
    )
      relayError("relay_request_invalid");
    envelope = JSON.parse(e.postData.contents);
    requestId = envelope.requestId;
    if (
      envelope.version !== 1 ||
      typeof requestId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(requestId) ||
      !Number.isSafeInteger(envelope.issuedAt) ||
      Math.abs(Date.now() - envelope.issuedAt) > 300000 ||
      typeof envelope.body !== "string"
    )
      relayError("relay_authentication_failed");
    if (
      !relayEqual(
        relayHmac(
          config.secret,
          "1\n" + envelope.issuedAt + "\n" + requestId + "\n" + envelope.body,
        ),
        envelope.signature,
      )
    )
      relayError("relay_authentication_failed");
    bodyHash = relayHash(envelope.body);
    data = JSON.parse(envelope.body);
    relayValidate(data);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) relayError("relay_busy");
    try {
      relayPrivateFile(config.spreadsheet);
      var mirror = relayMirror(config.spreadsheet, data);
      result =
        data.target === "owner_email"
          ? relayMail(config.spreadsheet, data, mirror)
          : mirror;
      result = {
        ok: true,
        jobId: data.jobId,
        target: data.target,
        bodyHash: bodyHash,
        reference: result.reference,
        disposition: result.disposition,
      };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    // Never return provider response text, answer content or credential details.
    result = {
      ok: false,
      jobId: data && data.jobId,
      target: data && data.target,
      bodyHash: bodyHash,
      code: error.relayCode || "relay_execution_failed",
    };
  }
  var body = JSON.stringify(result);
  var output =
    config && bodyHash && requestId
      ? {
          body: body,
          signature: relayHmac(
            config.secret,
            "response\n" + requestId + "\n" + bodyHash + "\n" + body,
          ),
        }
      : { ok: false, code: "relay_authentication_failed" };
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, code: "signed_post_required" }),
  ).setMimeType(ContentService.MimeType.JSON);
}
// Run from the owner editor once to authorize/read-only-check scopes. No mail sent.
function verifyRelaySetup() {
  var config = relayProperties();
  relayPrivateFile(config.spreadsheet);
  var metadata = relayGoogle(
    "?fields=spreadsheetId",
    "get",
    null,
    config.spreadsheet,
  );
  if (metadata.spreadsheetId !== config.spreadsheet)
    relayError("spreadsheet_identity_mismatch");
  return {
    ready: true,
    owner: EXAM_OWNER,
    remainingEmailRecipients: MailApp.getRemainingDailyQuota(),
  };
}
// Owner-only recovery after checking Sent mail/attachment hash. Set three Script
// Properties and run this function in the editor, then remove the properties:
// EXAM_MAIL_RESOLVE_TAB=<exact attempt tab title>, EXAM_MAIL_RESOLVE_PART=<1-based>,
// EXAM_MAIL_RESOLVE_ACTION=confirm (observed sent) OR retry (explicit duplicate risk).
function resolvePendingOwnerEmail() {
  var config = relayProperties(),
    props = PropertiesService.getScriptProperties();
  var tab = props.getProperty("EXAM_MAIL_RESOLVE_TAB"),
    part = Number(props.getProperty("EXAM_MAIL_RESOLVE_PART")),
    action = props.getProperty("EXAM_MAIL_RESOLVE_ACTION");
  if (
    !tab ||
    !Number.isSafeInteger(part) ||
    part < 1 ||
    !["confirm", "retry"].includes(action)
  )
    relayError("email_resolution_invalid");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) relayError("relay_busy");
  try {
    relayPrivateFile(config.spreadsheet);
    var metadata = relayGoogle(
        "?fields=sheets.properties",
        "get",
        null,
        config.spreadsheet,
      ),
      sheet = (metadata.sheets || []).find(function (item) {
        return item.properties.title === tab;
      });
    if (!sheet) relayError("email_resolution_invalid");
    var rows = relayRead(config.spreadsheet, tab, "H2"),
      journal = relayParse(rows[0] && rows[0][0]);
    if (
      !journal ||
      !journal.parts[part - 1] ||
      journal.parts[part - 1].status !== "pending"
    )
      relayError("email_resolution_invalid");
    journal.parts[part - 1].status =
      action === "confirm" ? "accepted" : "ready";
    journal.parts[part - 1].ownerResolvedAt = Date.now();
    journal.parts[part - 1].ownerResolution = action;
    relaySetJournal(config.spreadsheet, sheet.properties, 1, journal);
    [
      "EXAM_MAIL_RESOLVE_TAB",
      "EXAM_MAIL_RESOLVE_PART",
      "EXAM_MAIL_RESOLVE_ACTION",
    ].forEach(function (key) {
      props.deleteProperty(key);
    });
    return { resolved: true, action: action, part: part };
  } finally {
    lock.releaseLock();
  }
}
