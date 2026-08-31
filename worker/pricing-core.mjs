export const PRICING_ASSET_BUCKET = 'pricing-assets';

export const PRICING_ASSET_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  minDimension: 100,
  maxDimension: 4096,
  maxPixels: 16_777_216,
});

export const PRICING_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const PRICING_STABLE_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export class PricingValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PricingValidationError';
    this.code = code;
    this.status = status;
  }
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PricingValidationError('INVALID_PRICING_REQUEST', `${label} must be an object.`);
  }
  return value;
}

function safeText(value, maximum, { multiline = false, fallback = '' } = {}) {
  if (value == null) return fallback;
  const source = String(value);
  const withoutControls = multiline
    ? source.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    : source.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return withoutControls.trim().slice(0, maximum);
}

function safeInteger(value, minimum, maximum, fallback = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function safeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function safeTimestamp(value) {
  const input = safeText(value, 80);
  if (!input) return null;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function optionalUuid(value) {
  const normalized = safeText(value, 36).toLowerCase();
  return PRICING_UUID_PATTERN.test(normalized) ? normalized : null;
}

export function pricingUuid(value, label = 'identifier') {
  const normalized = safeText(value, 36).toLowerCase();
  if (!PRICING_UUID_PATTERN.test(normalized)) {
    throw new PricingValidationError(
      'INVALID_PRICING_IDENTIFIER',
      `The ${label} is invalid. Refresh the page and try again.`,
    );
  }
  return normalized;
}

export function pricingStableCode(value, label = 'code', { nullable = false } = {}) {
  const normalized = safeText(value, 64).toLowerCase();
  if (nullable && !normalized) return null;
  if (!PRICING_STABLE_CODE_PATTERN.test(normalized)) {
    throw new PricingValidationError(
      'INVALID_PRICING_CODE',
      `The ${label} must use stable lowercase letters, numbers, and underscores.`,
    );
  }
  return normalized;
}

export function normalizePricingRequestKey(value) {
  const normalized = safeText(value, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(normalized)) {
    throw new PricingValidationError(
      'INVALID_PRICING_REQUEST_KEY',
      'A valid retry-safe request key is required.',
    );
  }
  return normalized;
}

export function normalizePricingAdminQuery(payload) {
  const input = record(payload, 'Pricing query');
  if (safeText(input.operation, 40).toLowerCase() !== 'editor_snapshot') {
    throw new PricingValidationError(
      'INVALID_PRICING_OPERATION',
      'That pricing query is not supported.',
    );
  }
  return { operation: 'editor_snapshot' };
}

export function normalizePricingAdminAction(payload) {
  const input = record(payload, 'Pricing action');
  const operation = safeText(input.operation, 40).toLowerCase();
  const allowed = new Set([
    'create_draft',
    'save_draft',
    'schedule',
    'publish',
    'cancel_schedule',
    'rollback',
  ]);
  if (!allowed.has(operation)) {
    throw new PricingValidationError(
      'INVALID_PRICING_OPERATION',
      'That pricing action is not supported.',
    );
  }

  const requestKey = normalizePricingRequestKey(input.requestKey);
  const versionValue = input.expectedDraftVersion ?? input.expectedLockVersion;
  let expectedLockVersion = null;
  if (versionValue != null && versionValue !== '') {
    expectedLockVersion = safeInteger(versionValue, 0, 2_147_483_647);
    if (expectedLockVersion == null) {
      throw new PricingValidationError(
        'INVALID_PRICING_VERSION',
        'The draft version is invalid. Refresh the editor before saving.',
      );
    }
  }

  const rawDraftRevisionId = operation === 'rollback'
    ? input.expectedLiveRevisionId
    : input.draftRevisionId;
  const draftRevisionId = rawDraftRevisionId
    ? pricingUuid(rawDraftRevisionId, operation === 'rollback' ? 'expected live revision' : 'draft revision')
    : null;
  const rawSourceRevisionId = operation === 'rollback'
    ? input.sourceRevisionId
    : input.sourceRevisionId ?? input.expectedLiveRevisionId;
  const sourceRevisionId = rawSourceRevisionId
    ? pricingUuid(rawSourceRevisionId, 'source revision')
    : null;
  const publishAt = input.publishAt == null || input.publishAt === ''
    ? null
    : safeTimestamp(input.publishAt);
  if (input.publishAt && !publishAt) {
    throw new PricingValidationError('INVALID_PRICING_SCHEDULE', 'Choose a valid publishing date and time.');
  }

  let config = null;
  if (input.config != null) {
    config = record(input.config, 'Pricing configuration');
    if (JSON.stringify(config).length > 250_000) {
      throw new PricingValidationError(
        'PRICING_CONFIG_TOO_LARGE',
        'The pricing template is too large to save.',
        413,
      );
    }
  }
  const reason = input.reason == null ? null : safeText(input.reason, 1000, { multiline: true });
  const confirmed = input.confirmed === true;

  if (operation === 'save_draft' && !config) {
    throw new PricingValidationError('INVALID_PRICING_CONFIG', 'Pricing content is required to save the draft.');
  }
  if (operation === 'schedule' && !publishAt) {
    throw new PricingValidationError('INVALID_PRICING_SCHEDULE', 'Choose when the pricing changes should publish.');
  }
  if (['cancel_schedule', 'rollback'].includes(operation) && !sourceRevisionId) {
    throw new PricingValidationError(
      'INVALID_PRICING_REVISION',
      'Choose the pricing revision for this action.',
    );
  }
  if (operation === 'rollback' && !draftRevisionId) {
    throw new PricingValidationError(
      'INVALID_PRICING_REVISION',
      'Refresh the editor before rolling back so the current live revision can be verified.',
    );
  }
  if (['schedule', 'publish', 'cancel_schedule', 'rollback'].includes(operation)) {
    if (!confirmed) {
      throw new PricingValidationError(
        'PRICING_CONFIRMATION_REQUIRED',
        'Confirm this pricing publication action before continuing.',
      );
    }
    if (!reason || reason.length < 5) {
      throw new PricingValidationError(
        'PRICING_REASON_REQUIRED',
        'Add a short reason for the pricing publication record.',
      );
    }
  }

  return {
    operation,
    requestKey,
    expectedLockVersion,
    draftRevisionId,
    sourceRevisionId,
    publishAt,
    config,
    reason: reason || null,
    confirmed,
  };
}

function pngDimensions(data) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || !signature.every((byte, index) => data[index] === byte)) return null;
  if (String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < data.length) {
    while (offset < data.length && data[offset] !== 0xff) offset += 1;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) break;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > data.length) return null;
    const segmentLength = (data[offset] << 8) | data[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: (data[offset + 3] << 8) | data[offset + 4],
        width: (data[offset + 5] << 8) | data[offset + 6],
      };
    }
    offset += segmentLength;
  }
  return null;
}

export function validatePricingAsset(bytes, declaredMimeType, originalName = '') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.length || data.length > PRICING_ASSET_LIMITS.maxBytes) {
    throw new PricingValidationError(
      'UNSAFE_PRICING_ASSET',
      data.length ? 'The QR image exceeds the 5 MiB limit.' : 'The QR image is empty.',
      data.length ? 413 : 400,
    );
  }
  const mimeType = safeText(declaredMimeType, 100).toLowerCase();
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : null;
  if (!extension) {
    throw new PricingValidationError(
      'UNSAFE_PRICING_ASSET',
      'Upload a PNG or JPEG QR image.',
      415,
    );
  }
  const filenameExtension = safeText(originalName, 180).toLowerCase().split('.').pop();
  const extensionMatches = extension === 'jpg'
    ? ['jpg', 'jpeg'].includes(filenameExtension)
    : filenameExtension === extension;
  if (!extensionMatches) {
    throw new PricingValidationError(
      'UNSAFE_PRICING_ASSET',
      'The QR filename does not match its image type.',
      415,
    );
  }
  const dimensions = mimeType === 'image/png' ? pngDimensions(data) : jpegDimensions(data);
  if (!dimensions) {
    throw new PricingValidationError(
      'UNSAFE_PRICING_ASSET',
      'The uploaded file is not a valid PNG or JPEG image.',
      415,
    );
  }
  const { width, height } = dimensions;
  if (
    width < PRICING_ASSET_LIMITS.minDimension
    || height < PRICING_ASSET_LIMITS.minDimension
    || width > PRICING_ASSET_LIMITS.maxDimension
    || height > PRICING_ASSET_LIMITS.maxDimension
    || width * height > PRICING_ASSET_LIMITS.maxPixels
  ) {
    throw new PricingValidationError(
      'UNSAFE_PRICING_ASSET_DIMENSIONS',
      'Use a QR image between 100 and 4096 pixels on each side.',
      415,
    );
  }
  return { bytes: data, mimeType, extension, width, height };
}

export function normalizePricingAssetMetadata(value) {
  const input = record(value, 'Pricing asset');
  const assetId = pricingUuid(input.assetId ?? input.asset_id, 'asset identifier');
  const bucketId = safeText(input.bucketId ?? input.bucket_id, 80);
  if (bucketId !== PRICING_ASSET_BUCKET) {
    throw new PricingValidationError('PRICING_ASSET_NOT_FOUND', 'The QR image is not available.', 404);
  }
  const objectPath = safeText(input.objectPath ?? input.object_path, 500);
  if (
    !objectPath
    || objectPath.startsWith('/')
    || objectPath.includes('\\')
    || objectPath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new PricingValidationError('PRICING_ASSET_NOT_FOUND', 'The QR image is not available.', 404);
  }
  const mimeType = safeText(input.mimeType ?? input.mime_type, 100).toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(mimeType)) {
    throw new PricingValidationError('PRICING_ASSET_NOT_FOUND', 'The QR image is not available.', 404);
  }
  const sizeBytes = safeInteger(
    input.sizeBytes ?? input.size_bytes,
    1,
    PRICING_ASSET_LIMITS.maxBytes,
  );
  const width = safeInteger(
    input.width,
    PRICING_ASSET_LIMITS.minDimension,
    PRICING_ASSET_LIMITS.maxDimension,
  );
  const height = safeInteger(
    input.height,
    PRICING_ASSET_LIMITS.minDimension,
    PRICING_ASSET_LIMITS.maxDimension,
  );
  const sha256 = safeText(input.sha256, 64).toLowerCase();
  if (sizeBytes == null || width == null || height == null || !/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new PricingValidationError('PRICING_ASSET_NOT_FOUND', 'The QR image is not available.', 404);
  }
  return { assetId, bucketId, objectPath, mimeType, sizeBytes, width, height, sha256 };
}

function sanitizedQrAsset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const assetId = optionalUuid(value.assetId ?? value.asset_id);
  const sha256 = safeText(value.sha256, 64).toLowerCase();
  const mimeType = safeText(value.mimeType ?? value.mime_type, 100).toLowerCase();
  const width = safeInteger(value.width, 1, PRICING_ASSET_LIMITS.maxDimension);
  const height = safeInteger(value.height, 1, PRICING_ASSET_LIMITS.maxDimension);
  if (!assetId || !/^[0-9a-f]{64}$/u.test(sha256) || !['image/png', 'image/jpeg'].includes(mimeType)) {
    return null;
  }
  return { assetId, sha256, mimeType, width, height };
}

function publicQrUrl(value, assetId) {
  const supplied = safeText(value, 500);
  const match = supplied.match(/^\/pricing\/assets\/([0-9a-f-]{36})$/iu);
  if (match && optionalUuid(match[1])) return supplied;
  if (supplied === '/pricing/legacy-149-qr.png') return supplied;
  if (/^\/assets\/payments\/[a-z0-9._-]+\.(?:png|jpe?g)$/iu.test(supplied)) return supplied;
  return assetId ? `/pricing/assets/${assetId}` : null;
}

function sanitizedPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let planCode;
  try {
    planCode = pricingStableCode(value.planCode ?? value.plan_code, 'plan code');
  } catch {
    return null;
  }
  const versionId = optionalUuid(value.versionId ?? value.planVersionId ?? value.plan_version_id);
  if (!versionId) return null;
  const priceCentavos = safeInteger(value.priceCentavos ?? value.price_centavos, 0, 100_000_000);
  const durationDays = value.durationDays == null
    ? null
    : safeInteger(value.durationDays, 1, 36_600);
  if (priceCentavos == null || (value.durationDays != null && durationDays == null)) return null;
  const currency = safeText(value.currency, 3).toUpperCase();
  const features = (Array.isArray(value.features) ? value.features : [])
    .map((item) => safeText(item, 300, { multiline: true }))
    .filter(Boolean)
    .slice(0, 40);
  return {
    versionId,
    planVersionId: versionId,
    planCode,
    name: safeText(value.name, 120),
    badge: safeText(value.badge, 80),
    priceCentavos,
    ...(currency ? { currency } : {}),
    durationDays,
    entitlementMode: safeText(value.entitlementMode, 40),
    fixedEntitlementEndsAt: safeTimestamp(
      value.fixedEntitlementEndsAt ?? value.fixedEndsAt,
    ),
    description: safeText(value.description, 2000, { multiline: true }),
    features,
    ctaLabel: safeText(value.ctaLabel, 120),
    renewalNote: safeText(value.renewalNote, 1000, { multiline: true }),
    visible: safeBoolean(value.visible),
    displayOpen: safeBoolean(value.displayOpen),
    checkoutEnabled: safeBoolean(value.checkoutEnabled),
    checkoutOpen: safeBoolean(value.checkoutOpen),
    sortOrder: safeInteger(value.sortOrder, -10_000, 10_000, 0),
    ...(value.status != null ? { status: safeText(value.status, 40) } : {}),
  };
}

function sanitizedPaymentMethod(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let channelCode;
  let planCode;
  try {
    channelCode = pricingStableCode(value.channelCode ?? value.channel_code, 'payment channel code');
    planCode = pricingStableCode(value.planCode ?? value.plan_code, 'plan code', { nullable: true });
  } catch {
    return null;
  }
  const versionId = optionalUuid(
    value.versionId ?? value.paymentChannelVersionId ?? value.payment_channel_version_id,
  );
  if (!versionId) return null;
  const qrAsset = sanitizedQrAsset(value.qrAsset ?? value.qr_asset);
  const qrUrl = publicQrUrl(value.qrUrl ?? value.qr_url, qrAsset?.assetId);
  const qrAmountMode = safeText(value.qrAmountMode, 20).toLowerCase();
  if (!['exact', 'generic'].includes(qrAmountMode)) return null;
  const rawQrAmount = value.qrAmountCentavos ?? value.qr_amount_centavos;
  const qrAmountCentavos = rawQrAmount == null
    ? null
    : safeInteger(rawQrAmount, 0, 100_000_000);
  if (rawQrAmount != null && qrAmountCentavos == null) return null;
  return {
    versionId,
    paymentChannelVersionId: versionId,
    channelCode,
    planCode,
    label: safeText(value.label, 120),
    accountName: safeText(value.accountName, 160),
    accountDetails: safeText(value.accountDetails, 500, { multiline: true }),
    instructions: safeText(value.instructions, 2000, { multiline: true }),
    qrAsset,
    qrUrl,
    qrAmountMode,
    qrAmountCentavos,
    enabled: safeBoolean(value.enabled),
    visible: safeBoolean(value.visible),
    sortOrder: safeInteger(value.sortOrder, -10_000, 10_000, 0),
  };
}

function sanitizedFaq(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = safeText(value.id, 80);
  const question = safeText(value.question, 300, { multiline: true });
  const answer = safeText(value.answer, 4000, { multiline: true });
  if (!id || !question || !answer) return null;
  return {
    id,
    question,
    answer,
    visible: safeBoolean(value.visible),
    sortOrder: safeInteger(value.sortOrder, -10_000, 10_000, 0),
  };
}

export function sanitizePublicPricingSnapshot(value) {
  const root = record(value, 'Published pricing snapshot');
  const source = root.snapshot && typeof root.snapshot === 'object' && !Array.isArray(root.snapshot)
    ? root.snapshot
    : root;
  const revisionSource = source.revision && typeof source.revision === 'object'
    ? source.revision
    : {};
  const revisionId = optionalUuid(
    source.revisionId ?? source.revision_id ?? revisionSource.id ?? revisionSource.revisionId,
  );
  if (!revisionId) {
    throw new PricingValidationError(
      'PRICING_UNAVAILABLE',
      'Published plans are temporarily unavailable.',
      503,
    );
  }
  const pageInput = source.page && typeof source.page === 'object' && !Array.isArray(source.page)
    ? source.page
    : {};
  const plans = (Array.isArray(source.plans) ? source.plans : [])
    .map(sanitizedPlan)
    .filter(Boolean);
  const paymentMethods = (Array.isArray(source.paymentMethods) ? source.paymentMethods : [])
    .map(sanitizedPaymentMethod)
    .filter((method) => method?.enabled === true && method.visible === true && Boolean(method.qrUrl));
  const faqs = (Array.isArray(source.faqs) ? source.faqs : [])
    .map(sanitizedFaq)
    .filter(Boolean);
  return {
    revisionId,
    revision: {
      id: revisionId,
      revisionNumber: safeInteger(
        revisionSource.revisionNumber ?? source.revisionNumber,
        0,
        2_147_483_647,
        0,
      ),
    },
    serverNow: safeTimestamp(source.serverNow) || new Date().toISOString(),
    page: {
      eyebrow: safeText(pageInput.eyebrow, 160),
      title: safeText(pageInput.title, 300, { multiline: true }),
      intro: safeText(pageInput.intro, 3000, { multiline: true }),
      notice: safeText(pageInput.notice, 2000, { multiline: true }),
      finePrint: safeText(pageInput.finePrint, 3000, { multiline: true }),
    },
    plans,
    paymentMethods,
    faqs,
  };
}

export function sanitizeTrustedPayment(value) {
  const input = record(value, 'Payment response');
  const id = pricingUuid(input.id, 'payment request');
  const planVersionId = pricingUuid(input.planVersionId ?? input.plan_version_id, 'plan version');
  const paymentChannelVersionId = pricingUuid(
    input.paymentChannelVersionId ?? input.payment_channel_version_id,
    'payment channel version',
  );
  const pricingRevisionId = pricingUuid(
    input.pricingRevisionId ?? input.pricing_revision_id,
    'pricing revision',
  );
  const planCode = pricingStableCode(input.planCode ?? input.plan_code, 'plan code');
  const amountCentavos = safeInteger(
    input.amountCentavos ?? input.amount_centavos,
    0,
    100_000_000,
  );
  if (amountCentavos == null) {
    throw new PricingValidationError('PAYMENT_UNAVAILABLE', 'The trusted payment amount is unavailable.', 503);
  }
  const durationDays = input.durationDays == null
    ? null
    : safeInteger(input.durationDays, 1, 36_600);
  return {
    id,
    status: safeText(input.status, 40) || 'pending',
    planCode,
    planVersionId,
    paymentChannelVersionId,
    pricingRevisionId,
    planName: safeText(input.planName, 120),
    amountCentavos,
    amountPhp: amountCentavos / 100,
    currency: safeText(input.currency, 3).toUpperCase() || 'PHP',
    durationDays,
    entitlementMode: safeText(input.entitlementMode, 40),
    fixedEndsAt: safeTimestamp(input.fixedEndsAt),
    submittedAt: safeTimestamp(input.submittedAt),
    provisionalAccessExpiresAt: safeTimestamp(input.provisionalAccessExpiresAt),
    provisionalGrantReused: input.provisionalGrantReused === true,
    replayed: input.replayed === true,
  };
}
