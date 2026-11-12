import { pathToFileURL } from 'node:url';

export async function sendWelcomeEmail({ apiKey, requestKey, fetcher = fetch }) {
  if (!apiKey) throw new Error('RESEND_API_KEY is unavailable to this workflow. The production Worker secret cannot be read back through GitHub or Cloudflare.');
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(requestKey || '')) throw new Error('A stable request key is required.');
  const results = [];
  for (const to of ['wallyesteban1993@gmail.com', 'gilmardecastro05@gmail.com']) {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `duediligence-welcome-${requestKey}-${results.length}` },
      body: JSON.stringify({ from: 'support@duediligence.ph', to: [to],
        subject: 'DueDiligence.ph — Welcome back', text: 'Welcome back.' }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.id !== 'string') {
      throw new Error(`Email to ${to} was not confirmed accepted (HTTP ${response.status}). No automatic retry was made.`);
    }
    results.push({ to, providerMessageId: body.id, status: 'accepted' });
    console.log(JSON.stringify(results.at(-1)));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sendWelcomeEmail({ apiKey: process.env.RESEND_API_KEY, requestKey: process.env.EMAIL_TEST_REQUEST_KEY })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
