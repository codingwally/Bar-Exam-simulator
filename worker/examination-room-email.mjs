const DEFAULT_PUBLIC_ORIGIN = 'https://duediligence.ph';
const OFFICIAL_LOGO_PATH = '/assets/brand/logo1-master.png';
const EXAMINATION_ROOM_PATH = '/examination-room/';
const EXAMINATION_ROOM_ADMIN_PATH = '/admin/#examination_room_v1';

function cleanSingleLine(value, maximum, fallback = '') {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

export function escapeExaminationRoomEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

export function examinationRoomEmailBrand(env = {}) {
  const candidates = [
    env.EXAMINATION_ROOM_PUBLIC_ORIGIN,
    env.ALLOWED_ORIGIN,
    DEFAULT_PUBLIC_ORIGIN,
  ];
  let origin = DEFAULT_PUBLIC_ORIGIN;
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate || '').trim());
      if (parsed.protocol !== 'https:') continue;
      origin = parsed.origin;
      break;
    } catch {
      // Continue to the verified production origin.
    }
  }
  const workspace = new URL(EXAMINATION_ROOM_PATH, origin);
  workspace.hash = 'monitor';
  return Object.freeze({
    origin,
    logoUrl: new URL(OFFICIAL_LOGO_PATH, origin).href,
    workspaceUrl: workspace.href,
    adminUrl: new URL(EXAMINATION_ROOM_ADMIN_PATH, origin).href,
  });
}

function displayExpiry(value) {
  const source = cleanSingleLine(value, 120, 'until the administrator closes or revokes the room');
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return source;
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(timestamp));
}

export function buildExaminationRoomKeyEmail(env, message = {}) {
  const brand = examinationRoomEmailBrand(env);
  const creatorName = cleanSingleLine(
    message.creatorName ?? message.professorName,
    200,
    'Exam creator',
  );
  const examTitle = cleanSingleLine(message.examTitle, 300, 'Published examination');
  const roomKey = cleanSingleLine(message.roomKey, 80, 'Key unavailable');
  const expiresAt = displayExpiry(message.expiresAt);
  const subjectTitle = examTitle.slice(0, 140);
  const subject = `Your Examination Room key is ready — ${subjectTitle}`.slice(0, 200);

  const safe = {
    creatorName: escapeExaminationRoomEmailHtml(creatorName),
    examTitle: escapeExaminationRoomEmailHtml(examTitle),
    roomKey: escapeExaminationRoomEmailHtml(roomKey),
    expiresAt: escapeExaminationRoomEmailHtml(expiresAt),
    logoUrl: escapeExaminationRoomEmailHtml(brand.logoUrl),
    workspaceUrl: escapeExaminationRoomEmailHtml(brand.workspaceUrl),
  };

  const text = [
    `Hello ${creatorName},`,
    '',
    'Admin approved your published examination and issued the student room key.',
    '',
    `Examination: ${examTitle}`,
    `Student room key: ${roomKey}`,
    `Valid until: ${expiresAt}`,
    '',
    'Monitoring and Grading are now unlocked automatically for your signed-in creator account. You do not need to enter this key.',
    'Open Examination Room: ' + brand.workspaceUrl,
    '',
    'Share the student room key with the intended examinees. Anyone with the key may enter unless you selected the email-list entry option.',
    'If the key may have been exposed, ask Admin to rotate it. Your examination and saved student work remain preserved.',
    '',
    'Due Diligence · Examination Room',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safe.examTitle} — room key ready</title>
  <style>
    @media only screen and (max-width: 620px) {
      .dd-shell { width: 100% !important; }
      .dd-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .dd-key { font-size: 22px !important; letter-spacing: 2px !important; }
      .dd-button { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1f4;color:#172033;font-family:Inter,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Admin approved your examination. Monitoring and Grading are unlocked, and the student room key is ready.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef1f4;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="dd-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d8dfe7;border-top:5px solid #b8934f;">
        <tr>
          <td class="dd-pad" style="padding:25px 34px 22px;background:#07182f;">
            <img src="${safe.logoUrl}" width="80" alt="Due Diligence" style="display:block;width:80px;max-width:80px;height:auto;border:0;">
            <p style="margin:16px 0 0;color:#dfc681;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Examination Room</p>
          </td>
        </tr>
        <tr>
          <td class="dd-pad" style="padding:34px 34px 16px;">
            <p style="margin:0 0 12px;color:#596579;font-size:15px;line-height:1.6;">Hello ${safe.creatorName},</p>
            <h1 style="margin:0;color:#07182f;font-family:'Playfair Display',Cambria,serif;font-size:29px;line-height:1.2;font-weight:700;">Your examination is approved.</h1>
            <p style="margin:16px 0 0;color:#364152;font-size:16px;line-height:1.65;">Admin issued the student room key. Your signed-in creator account now has automatic access to Monitoring and Grading; you do not need to enter this key.</p>
          </td>
        </tr>
        <tr>
          <td class="dd-pad" style="padding:10px 34px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fffaf0;border:1px solid #dfd3ae;border-left:4px solid #b8934f;">
              <tr><td style="padding:22px;">
                <p style="margin:0 0 6px;color:#6d531d;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;">Examination</p>
                <p style="margin:0 0 20px;color:#172033;font-size:18px;line-height:1.4;font-weight:700;">${safe.examTitle}</p>
                <p style="margin:0 0 8px;color:#6d531d;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;">Student room key</p>
                <p class="dd-key" style="margin:0;padding:15px 12px;background:#ffffff;border:1px solid #b89b52;color:#07182f;font-family:'IBM Plex Mono',Consolas,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;text-align:center;overflow-wrap:anywhere;">${safe.roomKey}</p>
                <p style="margin:13px 0 0;color:#596579;font-size:13px;line-height:1.5;"><strong style="color:#364152;">Valid until:</strong> ${safe.expiresAt}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="dd-pad" style="padding:6px 34px 34px;">
            <a class="dd-button" href="${safe.workspaceUrl}" style="display:inline-block;padding:13px 21px;background:#c7a24f;border:1px solid #a98237;color:#07182f;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Open Monitoring and Grading</a>
            <h2 style="margin:27px 0 9px;color:#07182f;font-family:'Playfair Display',Cambria,serif;font-size:19px;line-height:1.3;">Next step</h2>
            <p style="margin:0;color:#364152;font-size:15px;line-height:1.65;">Share the student room key with the intended examinees. Anyone with the key may enter unless you selected the email-list entry option.</p>
            <p style="margin:15px 0 0;color:#596579;font-size:13px;line-height:1.6;">If the key may have been exposed, ask Admin to rotate it. Your examination and saved student work remain preserved.</p>
          </td>
        </tr>
        <tr>
          <td class="dd-pad" style="padding:20px 34px;background:#f8f7f3;border-top:1px solid #e4e0d6;color:#6a7280;font-size:12px;line-height:1.55;">
            <strong style="color:#07182f;">Due Diligence · Examination Room</strong><br>
            This operational message was generated after an Admin key approval or resend.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return Object.freeze({
    subject,
    text,
    html,
    logoUrl: brand.logoUrl,
    workspaceUrl: brand.workspaceUrl,
  });
}

export function buildExaminationRoomPublicationRequestEmail(env, message = {}) {
  const brand = examinationRoomEmailBrand(env);
  const examTitle = cleanSingleLine(message.examTitle, 300, 'Published examination');
  const subjectName = cleanSingleLine(message.subject, 200, 'Subject not specified');
  const examId = cleanSingleLine(message.examId, 120, 'Identifier unavailable');
  const version = cleanSingleLine(message.version, 40, '1');
  const publishedAt = displayExpiry(message.publishedAt || 'Published just now');
  const questionCount = Number.isSafeInteger(Number(message.questionCount))
    ? String(Number(message.questionCount))
    : 'Not returned';
  const subject = `Key approval requested — ${examTitle.slice(0, 150)}`.slice(0, 200);
  const safe = {
    examTitle: escapeExaminationRoomEmailHtml(examTitle),
    subjectName: escapeExaminationRoomEmailHtml(subjectName),
    examId: escapeExaminationRoomEmailHtml(examId),
    version: escapeExaminationRoomEmailHtml(version),
    publishedAt: escapeExaminationRoomEmailHtml(publishedAt),
    questionCount: escapeExaminationRoomEmailHtml(questionCount),
    logoUrl: escapeExaminationRoomEmailHtml(brand.logoUrl),
    adminUrl: escapeExaminationRoomEmailHtml(brand.adminUrl),
  };
  const text = [
    'A signed-in creator published an examination and requested a student room key.',
    '',
    `Examination: ${examTitle}`,
    `Subject: ${subjectName}`,
    `Questions: ${questionCount}`,
    `Version: ${version}`,
    `Published: ${publishedAt}`,
    `Examination ID: ${examId}`,
    '',
    `Review in the owner command center: ${brand.adminUrl}`,
    'Choose Approve & generate key once. The exact student key will remain visible to Admin, the creator will receive it by email, and Monitoring and Grading will unlock automatically for the creator.',
    '',
    'The request remains visible in the owner command center even if email delivery is delayed.',
    '',
    'Due Diligence · Examination Room',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safe.examTitle} — key approval requested</title>
  <style>@media only screen and (max-width:620px){.dd-shell{width:100%!important}.dd-pad{padding-left:22px!important;padding-right:22px!important}.dd-button{display:block!important;text-align:center!important}}</style>
</head>
<body style="margin:0;padding:0;background:#eef1f4;color:#172033;font-family:Inter,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A published Examination Room key request is waiting for one-click owner approval.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef1f4;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="dd-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#fff;border:1px solid #d8dfe7;border-top:5px solid #b8934f;">
        <tr><td class="dd-pad" style="padding:24px 34px;background:#07182f;"><img src="${safe.logoUrl}" width="80" alt="Due Diligence" style="display:block;width:80px;max-width:80px;height:auto;border:0;"><p style="margin:14px 0 0;color:#dfc681;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Owner command center</p></td></tr>
        <tr><td class="dd-pad" style="padding:34px 34px 18px;"><h1 style="margin:0;color:#07182f;font-family:'Playfair Display',Cambria,serif;font-size:29px;line-height:1.2;">A key request is ready for review.</h1><p style="margin:16px 0 0;color:#364152;font-size:16px;line-height:1.65;">A signed-in creator published an examination. Review it, then approve once to generate and send the student key.</p></td></tr>
        <tr><td class="dd-pad" style="padding:8px 34px 22px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fffaf0;border:1px solid #dfd3ae;border-left:4px solid #b8934f;"><tr><td style="padding:21px;color:#364152;font-size:14px;line-height:1.65;"><strong style="display:block;color:#07182f;font-size:18px;">${safe.examTitle}</strong><span>${safe.subjectName} · ${safe.questionCount} questions · Version ${safe.version}</span><br><span>Published ${safe.publishedAt}</span><br><span style="overflow-wrap:anywhere;">ID: ${safe.examId}</span></td></tr></table></td></tr>
        <tr><td class="dd-pad" style="padding:4px 34px 34px;"><a class="dd-button" href="${safe.adminUrl}" style="display:inline-block;padding:13px 21px;background:#c7a24f;border:1px solid #a98237;color:#07182f;font-size:15px;font-weight:700;text-decoration:none;">Review &amp; approve key request</a><h2 style="margin:27px 0 9px;color:#07182f;font-family:'Playfair Display',Cambria,serif;font-size:19px;">One-click result</h2><p style="margin:0;color:#364152;font-size:15px;line-height:1.65;">Approve &amp; generate key keeps the exact key visible to Admin, emails the creator and owner copies, and automatically unlocks Monitoring and Grading for the creator—no creator key entry.</p><p style="margin:15px 0 0;color:#596579;font-size:13px;line-height:1.6;">This request remains in the owner command center even if email delivery is delayed.</p></td></tr>
        <tr><td class="dd-pad" style="padding:20px 34px;background:#f8f7f3;border-top:1px solid #e4e0d6;color:#6a7280;font-size:12px;line-height:1.55;"><strong style="color:#07182f;">Due Diligence · Examination Room</strong><br>Operational notification for configured platform-owner addresses.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return Object.freeze({ subject, text, html, logoUrl: brand.logoUrl, adminUrl: brand.adminUrl });
}

export async function deliverExaminationRoomPublicationRequestEmail(env, message = {}, transport = globalThis.fetch) {
  const mode = String(env?.EXAMINATION_ROOM_EMAIL_MODE || '').trim().toLowerCase();
  if (mode === 'suppressed') return { status: 'suppressed', providerId: null, safeErrorCode: 'email_suppressed' };
  const from = String(env?.EXAMINATION_ROOM_EMAIL_FROM || env?.SUPPORT_NOTIFICATION_EMAIL_FROM || '').trim();
  const recipients = [...new Set((Array.isArray(message.recipients) ? message.recipients : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))
    .slice(0, 20))];
  const idempotencyHash = String(message.idempotencyHash || '').trim().toLowerCase();
  if (mode !== 'enabled' || !env?.RESEND_API_KEY || !from || recipients.length < 1 || !/^[0-9a-f]{64}$/u.test(idempotencyHash)) {
    return {
      status: 'not_configured',
      providerId: null,
      safeErrorCode: !from ? 'sender_missing'
        : !env?.RESEND_API_KEY ? 'provider_key_missing'
          : recipients.length < 1 ? 'owner_recipients_missing'
            : !/^[0-9a-f]{64}$/u.test(idempotencyHash) ? 'idempotency_hash_invalid'
              : 'email_mode_invalid',
    };
  }
  try {
    const email = buildExaminationRoomPublicationRequestEmail(env, message);
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `exam-room-request-${idempotencyHash}`,
      },
      body: JSON.stringify({
        from,
        to: [recipients[0]],
        ...(recipients.length > 1 ? { bcc: recipients.slice(1) } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) return { status: 'failed', providerId: null, safeErrorCode: `provider_${response.status}`.slice(0, 80) };
    return { status: 'sent', providerId: result?.id ? String(result.id).slice(0, 240) : null, safeErrorCode: null };
  } catch {
    return { status: 'failed', providerId: null, safeErrorCode: 'network_error' };
  }
}

export const EXAMINATION_ROOM_EMAIL_ASSETS = Object.freeze({
  defaultOrigin: DEFAULT_PUBLIC_ORIGIN,
  logoPath: OFFICIAL_LOGO_PATH,
  examinationRoomPath: EXAMINATION_ROOM_PATH,
  adminPath: EXAMINATION_ROOM_ADMIN_PATH,
});
