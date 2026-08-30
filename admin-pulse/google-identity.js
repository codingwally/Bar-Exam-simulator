(function dueDiligenceAdminPulseGoogleIdentity(global) {
  'use strict';

  const NONCE_BYTE_LENGTH = 32;

  function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return global.btoa(binary);
  }

  function bytesToHex(bytes) {
    return [...bytes]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async function createNonce(cryptoProvider = global.crypto) {
    if (!cryptoProvider?.getRandomValues || !cryptoProvider?.subtle?.digest) {
      throw new Error('Secure Google sign-in is not supported by this browser.');
    }
    const bytes = new Uint8Array(NONCE_BYTE_LENGTH);
    cryptoProvider.getRandomValues(bytes);
    const raw = bytesToBase64(bytes);
    const encoded = new TextEncoder().encode(raw);
    const digest = await cryptoProvider.subtle.digest('SHA-256', encoded);
    return Object.freeze({
      raw,
      hashed: bytesToHex(new Uint8Array(digest)),
    });
  }

  async function exchangeCredential({ client, credential, rawNonce }) {
    if (!client?.auth?.signInWithIdToken) {
      throw new Error('Google sign-in is not configured.');
    }
    if (!String(credential || '').trim() || !String(rawNonce || '').trim()) {
      throw new Error('Google sign-in did not return a verifiable credential.');
    }
    return client.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
      nonce: rawNonce,
    });
  }

  function shouldOfferRedirectFallback({ isIos, gisAvailable }) {
    return isIos !== true && gisAvailable !== true;
  }

  global.DueDiligenceAdminPulseGoogleIdentity = Object.freeze({
    createNonce,
    exchangeCredential,
    shouldOfferRedirectFallback,
  });
})(window);
