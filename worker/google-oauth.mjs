function safeCode(value, fallback = 'GOOGLE_REQUEST_FAILED') {
  const normalized = String(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80);
  return normalized.length >= 2 ? normalized : 'GOOGLE_REQUEST_FAILED';
}

async function jsonFetch(fetchImpl, url, options, safeFailure) {
  const response = await fetchImpl(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(safeFailure);
    error.safeCode = safeCode(`${safeFailure}_${response.status}`);
    throw error;
  }
  return body;
}

export async function googleAccessToken(env, fetchImpl = fetch) {
  const clientId = String(env?.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env?.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(env?.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refreshToken) {
    const error = new Error('Google OAuth credentials are not configured.');
    error.safeCode = 'GOOGLE_AUTH_NOT_CONFIGURED';
    throw error;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const result = await jsonFetch(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 'GOOGLE_TOKEN_FAILED');
  if (!result?.access_token) {
    const error = new Error('Google did not return an access token.');
    error.safeCode = 'GOOGLE_TOKEN_INVALID';
    throw error;
  }
  return String(result.access_token);
}
