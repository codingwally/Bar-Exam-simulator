// Added only to a temporary version of the currently deployed bundle.
export function createWelcomeWorker(original, { tokenHash, expiresAt, requestKey }, transport = fetch) {
  const recipients = ['wallyesteban1993@gmail.com', 'gilmardecastro05@gmail.com'];
  const reply = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  return {
    ...original,
    async fetch(request, env, ctx) {
      const pathname = new URL(request.url).pathname;
      if (!pathname.startsWith('/_internal/authorized-welcome-email-test')) {
        return original.fetch(request, env, ctx);
      }
      const supplied = request.headers.get('Authorization') || '';
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (Date.now() > expiresAt || digest !== tokenHash || request.method !== 'POST') return reply({ error: 'Not found' }, 404);
      if (!env.RESEND_API_KEY) return reply({ error: 'Production Resend binding unavailable' }, 503);
      if (pathname === '/_internal/authorized-welcome-email-test/ready') return reply({ ready: true, requestKey });
      if (pathname === '/_internal/authorized-welcome-email-test/status') {
        const ids = await request.json();
        if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => !/^[a-f0-9-]{36}$/i.test(id))) return reply({ error: 'Invalid IDs' }, 400);
        const result = [];
        for (const id of ids) {
          const response = await transport('https://api.resend.com/emails/' + id, {
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000),
          });
          const body = await response.json().catch(() => ({}));
          result.push({ id, status: response.status, last_event: response.ok ? body.last_event : 'unavailable' });
          await new Promise(resolve => setTimeout(resolve, 650));
        }
        return reply({ result });
      }
      if (pathname !== '/_internal/authorized-welcome-email-test') return reply({ error: 'Not found' }, 404);
      const response = await transport('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `duediligence-welcome-batch-${requestKey}` },
        body: JSON.stringify(recipients.map(to => ({ from: 'support@duediligence.ph', to: [to],
          subject: 'DueDiligence.ph — Welcome back', text: 'Welcome back.' }))),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.data) || body.data.length !== 2 || body.data.some(x => typeof x.id !== 'string')) {
        return reply({ error: 'Provider acceptance not confirmed', providerStatus: response.status,
          providerError: typeof body.name === 'string' ? body.name.slice(0, 100) : undefined }, 502);
      }
      return reply({ accepted: body.data.map((item, index) => ({ to: recipients[index], id: item.id })) });
    },
  };
}
