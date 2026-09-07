// Presentation only. Sending policy, recipients, private data and attachments stay
// with the existing sender. Never interpret message text as HTML or as links.
export function escapeTransactionalEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function authorizedReviewUrl(path) {
  if (path === '/admin/') return 'https://duediligence.ph/admin/';
  if (/^\/admin\/payments\?request=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(path || ''))) {
    return `https://duediligence.ph${path}`;
  }
  return null;
}

export function renderTransactionalEmailHtml({ heading, text, adminPath } = {}) {
  const escape = escapeTransactionalEmailHtml;
  const reviewUrl = authorizedReviewUrl(adminPath);
  const paragraphs = String(text ?? '').split(/\r?\n\r?\n/).map((paragraph) => (
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;word-break:break-word;overflow-wrap:anywhere">${escape(paragraph).replace(/\r?\n/g, '<br>')}</p>`
  )).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#f6f2e9;color:#002147;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;background:#f6f2e9"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;table-layout:fixed;background:#fffdf8;border:1px solid #d6c59f;border-top:4px solid #c5a059">
<tr><td style="padding:24px;background:#002147;color:#fff"><img src="https://duediligence.ph/assets/brand/logo1-master.png" alt="Due Diligence" width="56" style="display:block;width:56px;max-width:100%;height:auto;margin-bottom:12px;border:0"><div style="font:700 23px Georgia,serif;letter-spacing:1px">DUE DILIGENCE</div><div style="margin-top:6px;color:#e7c76e;font-size:13px">Private internal notification</div></td></tr>
<tr><td style="padding:26px 24px;word-break:break-word;overflow-wrap:anywhere"><h1 style="margin:0 0 22px;font:700 28px/1.25 Georgia,serif;color:#002147">${escape(heading)}</h1>
${paragraphs}
${reviewUrl ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#002147;border:1px solid #c5a059;border-radius:6px"><a href="${escape(reviewUrl)}" style="display:inline-block;padding:14px 20px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">Open authorized review</a></td></tr></table>` : ''}
<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #d6c59f;color:#465468;font-size:13px;line-height:1.6">Private information for the authorized recipient only. Due Diligence.</p>
</td></tr></table></td></tr></table></body></html>`;
}
