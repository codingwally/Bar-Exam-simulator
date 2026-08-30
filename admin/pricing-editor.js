(function dueDiligencePricingEditor(global) {
  'use strict';

  const MANILA_TIME_ZONE = 'Asia/Manila';
  const QR_MAX_BYTES = 5 * 1024 * 1024;
  const QR_MIN_EDGE = 100;
  const QR_MAX_EDGE = 4_096;
  const MAX_PLANS = 20;
  const MAX_PAYMENT_METHODS = 40;
  const MAX_FAQS = 40;
  const CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
  const OPERATION_COPY = Object.freeze({
    publish: {
      title: 'Publish these changes now?',
      copy: 'The current pricing page and checkout rules will change as soon as the server accepts this publication.',
      button: 'Publish now',
    },
    schedule: {
      title: 'Schedule these changes?',
      copy: 'The server will publish this revision at the selected Asia/Manila time.',
      button: 'Schedule publication',
    },
    cancel_schedule: {
      title: 'Cancel the scheduled publication?',
      copy: 'The current live revision will remain in effect. The draft will not be deleted.',
      button: 'Cancel schedule',
    },
    rollback: {
      title: 'Restore this earlier revision?',
      copy: 'Rollback creates a new published revision. It never changes or deletes the original history.',
      button: 'Restore revision',
    },
  });

  let activeController = null;

  function renderer() {
    const available = global.DueDiligencePricingRenderer;
    if (!available?.normalizeConfig || !available?.render) {
      throw new Error('The safe pricing preview could not be loaded.');
    }
    return available;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function randomId(prefix = 'item') {
    const supplied = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return `${prefix}-${supplied}`;
  }

  function generatedUuid() {
    return global.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000';
  }

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function unwrapEnvelope(value) {
    let current = asObject(value);
    for (let index = 0; index < 5; index += 1) {
      if (current.editorSnapshot && typeof current.editorSnapshot === 'object') {
        current = current.editorSnapshot;
        continue;
      }
      if (current.snapshot && typeof current.snapshot === 'object') {
        current = current.snapshot;
        continue;
      }
      if (current.pricing && typeof current.pricing === 'object') {
        current = current.pricing;
        continue;
      }
      const looksLikeSnapshot = ['serverNow', 'timezone', 'draft', 'live', 'scheduled', 'history']
        .some((key) => Object.prototype.hasOwnProperty.call(current, key));
      if (!looksLikeSnapshot && current.data && typeof current.data === 'object') {
        current = current.data;
        continue;
      }
      break;
    }
    return asObject(current);
  }

  function revisionId(revision) {
    const source = asObject(revision);
    return String(source.revisionId || source.versionId || source.id || '').trim() || null;
  }

  function revisionVersion(revision, fallback = 0) {
    const source = asObject(revision);
    const supplied = Number(
      source.lockVersion ?? source.draftVersion ?? source.versionNumber ?? source.version ?? fallback,
    );
    return Number.isFinite(supplied) ? supplied : fallback;
  }

  function revisionConfig(revision) {
    const source = asObject(revision);
    if (source.config && typeof source.config === 'object') return source.config;
    if (source.configuration && typeof source.configuration === 'object') return source.configuration;
    if (source.page || source.plans || source.paymentMethods || source.faqs) {
      return {
        page: asObject(source.page),
        plans: Array.isArray(source.plans) ? source.plans : [],
        paymentMethods: Array.isArray(source.paymentMethods) ? source.paymentMethods : [],
        faqs: Array.isArray(source.faqs) ? source.faqs : [],
      };
    }
    return {};
  }

  function normalizeHistoryItem(item) {
    const source = asObject(item);
    return {
      revisionId: revisionId(source),
      version: revisionVersion(source),
      status: String(source.status || source.revisionStatus || source.eventType || 'saved').trim(),
      createdAt: source.createdAt || source.created_at || source.occurredAt || null,
      publishedAt: source.publishedAt || source.published_at || null,
      scheduledAt: source.scheduledAt || source.publishAt || source.scheduled_at || null,
      actorName: String(source.actorName || source.createdByName || source.created_by || '').trim(),
      reason: String(source.reason || source.changeReason || '').trim(),
      config: revisionConfig(source),
    };
  }

  function normalizeSnapshot(payload) {
    const source = unwrapEnvelope(payload);
    const liveSource = source.live || source.published;
    const live = Object.keys(asObject(liveSource)).length ? liveSource : null;
    const draft = Object.keys(asObject(source.draft)).length ? source.draft : null;
    const scheduledItems = Array.isArray(source.scheduled)
      ? source.scheduled
      : Object.keys(asObject(source.scheduled)).length ? [source.scheduled] : [];
    scheduledItems.sort((left, right) => new Date(
      left?.effectiveAt || left?.publishAt || left?.scheduledAt || 0,
    ).getTime() - new Date(
      right?.effectiveAt || right?.publishAt || right?.scheduledAt || 0,
    ).getTime());
    const generatedIds = asObject(source.generatedIds || source.generated_ids);
    return {
      serverNow: source.serverNow || source.server_now || new Date().toISOString(),
      timezone: String(source.timezone || MANILA_TIME_ZONE),
      draft,
      live,
      scheduled: scheduledItems[0] || null,
      history: (Array.isArray(source.history) ? source.history : []).map(normalizeHistoryItem),
      generatedIds,
      expectedDraftVersion: Number(
        source.expectedDraftVersion ?? source.expected_draft_version ?? revisionVersion(draft),
      ) || 0,
    };
  }

  function consumeGeneratedId(controller, kind, prefix) {
    const generated = controller.snapshot.generatedIds;
    const candidates = generated[kind] || generated[`${kind}Ids`] || generated[`${kind}_ids`];
    if (Array.isArray(candidates) && candidates.length) return String(candidates.shift());
    if (typeof candidates === 'string' && candidates) {
      delete generated[kind];
      return candidates;
    }
    return generatedUuid();
  }

  function withEditorMetadata(config, persisted = true) {
    const normalized = clone(renderer().normalizeConfig(config));
    normalized.plans = normalized.plans.map((plan) => ({
      ...plan,
      _editorKey: randomId('plan'),
      _persisted: persisted,
    }));
    normalized.paymentMethods = normalized.paymentMethods.map((method) => ({
      ...method,
      _editorKey: randomId('payment'),
      _persisted: persisted,
    }));
    normalized.faqs = normalized.faqs.map((faq) => ({
      ...faq,
      _editorKey: randomId('faq'),
      _persisted: persisted,
    }));
    return normalized;
  }

  function serializeConfig(controller) {
    const normalized = clone(renderer().normalizeConfig(controller.config));
    normalized.paymentMethods = normalized.paymentMethods.map((method) => ({
      ...method,
      qrAmountCentavos: method.qrAmountMode === 'generic'
        ? null
        : method.qrAmountCentavos,
    }));
    return normalized;
  }

  function reconfirmExactQrAmount(controller, method) {
    if (!method || method.qrAmountMode !== 'exact' || !method.planCode) return;
    const plan = controller.config.plans.find((candidate) => candidate.planCode === method.planCode);
    if (plan) method.qrAmountCentavos = plan.priceCentavos;
  }

  function stableConfig(controller) {
    return JSON.stringify(serializeConfig(controller));
  }

  function editorShell() {
    return '<div class="pricing-editor" data-pricing-editor-root></div>';
  }

  function formatDateTime(value) {
    const parsed = new Date(value || 0);
    if (!Number.isFinite(parsed.getTime())) return 'Not set';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: MANILA_TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }

  function toManilaInput(value) {
    const supplied = String(value ?? '').trim();
    if (!supplied) return '';
    const parsed = new Date(supplied);
    if (!Number.isFinite(parsed.getTime())) return '';
    return new Date(parsed.getTime() + (8 * 60 * 60 * 1_000)).toISOString().slice(0, 16);
  }

  function fromManilaInput(value) {
    const supplied = String(value || '').trim();
    if (!supplied) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(supplied)) return null;
    const parsed = new Date(`${supplied}:00+08:00`);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  function statusLabel(revision, fallback) {
    if (!revision) return fallback;
    const source = asObject(revision);
    const version = Number(source.revisionNumber ?? source.versionNumber ?? source.version ?? 0);
    const id = revisionId(source);
    return version ? `Revision ${version}` : id ? `Revision ${id.slice(0, 8)}` : fallback;
  }

  function field(label, control, hint = '') {
    return `<label class="pricing-field"><span>${escapeHtml(label)}</span>${control}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`;
  }

  function textInput(value, attributes = '') {
    return `<input type="text" value="${escapeHtml(value)}" ${attributes}>`;
  }

  function textarea(value, attributes = '') {
    return `<textarea ${attributes}>${escapeHtml(value)}</textarea>`;
  }

  function itemActionButtons(type, key, index, length) {
    return `<div class="pricing-item-actions" aria-label="Item order and removal">
      <button type="button" data-editor-action="move-${type}" data-key="${escapeHtml(key)}" data-direction="up"${index === 0 ? ' disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" data-editor-action="move-${type}" data-key="${escapeHtml(key)}" data-direction="down"${index === length - 1 ? ' disabled' : ''} aria-label="Move down">↓</button>
      <button type="button" class="pricing-remove" data-editor-action="remove-${type}" data-key="${escapeHtml(key)}">Remove</button>
    </div>`;
  }

  function overviewHtml(controller) {
    const { snapshot } = controller;
    const scheduledAt = snapshot.scheduled
      ? snapshot.scheduled.effectiveAt || snapshot.scheduled.publishAt
        || snapshot.scheduled.scheduledAt || snapshot.scheduled.scheduled_at
      : null;
    return `<section class="pricing-workspace-panel" data-editor-panel="overview">
      <div class="pricing-panel-heading">
        <div>
          <p class="pricing-kicker">Simple publishing</p>
          <h2>Overview</h2>
          <p>Edit a draft freely. Nothing changes for subscribers until you publish or the scheduled server time arrives.</p>
        </div>
      </div>
      <div class="pricing-cutoff-note">
        <strong>September transition</strong>
        <p>Server time controls the cutoff. The ₱149 legacy offer ends September 1. The new ₱199, 30-day checkout opens September 2. Existing subscribers keep the price and term recorded when they subscribed.</p>
      </div>
      <dl class="pricing-status-grid">
        <div><dt>Live</dt><dd>${escapeHtml(statusLabel(snapshot.live, 'Not published yet'))}</dd><small>${escapeHtml(formatDateTime(snapshot.live?.publishedAt || snapshot.live?.published_at))}</small></div>
        <div><dt>Draft</dt><dd>${escapeHtml(statusLabel(snapshot.draft, 'New draft'))}</dd><small>Version lock ${escapeHtml(controller.expectedDraftVersion)}</small></div>
        <div><dt>Scheduled</dt><dd>${scheduledAt ? escapeHtml(formatDateTime(scheduledAt)) : 'None'}</dd><small>${escapeHtml(snapshot.timezone)}</small></div>
        <div><dt>Server time</dt><dd>${escapeHtml(formatDateTime(snapshot.serverNow))}</dd><small>Used for opening and closing rules</small></div>
      </dl>
      <div class="pricing-publish-actions" aria-label="Draft and publication actions">
        <button class="pricing-primary" type="button" data-editor-action="save-draft">Save draft</button>
        <button type="button" data-editor-action="open-operation" data-operation="schedule">Schedule</button>
        <button type="button" data-editor-action="open-operation" data-operation="publish">Publish now</button>
        ${snapshot.scheduled ? `<button type="button" data-editor-action="open-operation" data-operation="cancel_schedule" data-source-revision-id="${escapeHtml(revisionId(snapshot.scheduled) || '')}">Cancel schedule</button>` : ''}
      </div>
      <section class="pricing-history" aria-labelledby="pricing-history-heading">
        <div class="pricing-panel-heading compact">
          <div><h3 id="pricing-history-heading">History</h3><p>Rollback creates a new revision and preserves the audit trail.</p></div>
        </div>
        ${historyHtml(controller)}
      </section>
    </section>`;
  }

  function historyHtml(controller) {
    if (!controller.snapshot.history.length) {
      return '<p class="pricing-empty-state">No earlier pricing revisions are available yet.</p>';
    }
    const rollbackBlocked = Boolean(controller.snapshot.draft || controller.snapshot.scheduled);
    const rollbackTitle = controller.snapshot.draft
      ? 'Publish the current draft before rollback.'
      : controller.snapshot.scheduled
        ? 'Cancel the scheduled publication before rollback.'
        : 'Restore this revision';
    return `<div class="pricing-history-list">${controller.snapshot.history.map((item) => {
      const identifier = item.revisionId || '';
      const date = item.publishedAt || item.scheduledAt || item.createdAt;
      return `<article class="pricing-history-row">
        <div><strong>${escapeHtml(item.version ? `Revision ${item.version}` : identifier.slice(0, 8) || 'Revision')}</strong><span>${escapeHtml(item.status || 'saved')}</span></div>
        <p>${escapeHtml(formatDateTime(date))}${item.actorName ? ` · ${escapeHtml(item.actorName)}` : ''}</p>
        ${item.reason ? `<p class="pricing-history-reason">${escapeHtml(item.reason)}</p>` : ''}
        <button type="button" data-editor-action="open-operation" data-operation="rollback" data-source-revision-id="${escapeHtml(identifier)}"${identifier && !rollbackBlocked ? '' : ' disabled'} title="${escapeHtml(rollbackTitle)}">Rollback</button>
      </article>`;
    }).join('')}</div>`;
  }

  function plansHtml(controller) {
    const plans = controller.config.plans;
    return `<section class="pricing-workspace-panel" data-editor-panel="plans" hidden>
      <div class="pricing-panel-heading">
        <div><p class="pricing-kicker">Offers</p><h2>Plans</h2><p>Prices are stored precisely in centavos and shown here in pesos. Plan codes become permanent after the draft is saved.</p></div>
        <button type="button" data-editor-action="add-plan">Add plan</button>
      </div>
      <div class="pricing-item-list">${plans.length ? plans.map((plan, index) => planHtml(controller, plan, index)).join('') : '<p class="pricing-empty-state">Add the plan customers should see.</p>'}</div>
    </section>`;
  }

  function planHtml(controller, plan, index) {
    const key = plan._editorKey;
    const persisted = plan._persisted;
    const pesos = (Number(plan.priceCentavos || 0) / 100).toFixed(2);
    return `<article class="pricing-edit-card" data-plan-key="${escapeHtml(key)}">
      <header><div><p>Plan ${index + 1}</p><h3>${escapeHtml(plan.name || 'Untitled plan')}</h3></div>${itemActionButtons('plan', key, index, controller.config.plans.length)}</header>
      <div class="pricing-form-grid">
        ${field('Stable plan code', textInput(plan.planCode, `data-plan-field="planCode" data-key="${escapeHtml(key)}" maxlength="64" pattern="[a-z][a-z0-9_]{2,63}" ${persisted ? 'readonly' : ''}`), persisted ? 'Saved codes cannot be renamed.' : 'Start with a letter; use lowercase letters, numbers, and underscores.')}
        ${field('Plan name', textInput(plan.name, `data-plan-field="name" data-key="${escapeHtml(key)}" maxlength="100"`))}
        ${field('Badge', textInput(plan.badge, `data-plan-field="badge" data-key="${escapeHtml(key)}" maxlength="80"`), 'Optional, for example New or Legacy.')}
        ${field('Price in pesos', `<input type="number" value="${escapeHtml(pesos)}" min="0" max="1000000" step="0.01" inputmode="decimal" data-plan-field="pricePesos" data-key="${escapeHtml(key)}">`, 'Stored as whole centavos.')}
        ${field('Duration in days', `<input type="number" value="${escapeHtml(plan.durationDays)}" min="1" max="366" step="1" data-plan-field="durationDays" data-key="${escapeHtml(key)}">`)}
        ${field('Button label', textInput(plan.ctaLabel, `data-plan-field="ctaLabel" data-key="${escapeHtml(key)}" maxlength="80"`))}
        ${field('Description', textarea(plan.description, `data-plan-field="description" data-key="${escapeHtml(key)}" maxlength="4000" rows="3"`))}
        ${field('Features', textarea((plan.features || []).join('\n'), `data-plan-field="features" data-key="${escapeHtml(key)}" maxlength="3000" rows="5"`), 'One feature per line.')}
        ${field('Renewal note', textarea(plan.renewalNote, `data-plan-field="renewalNote" data-key="${escapeHtml(key)}" maxlength="1000" rows="3"`), 'Explain whether access renews or requires another payment.')}
      </div>
      <fieldset class="pricing-checkout-rules">
        <legend>Visibility and checkout</legend>
        <label class="pricing-check"><input type="checkbox" data-plan-field="visible" data-key="${escapeHtml(key)}"${plan.visible ? ' checked' : ''}><span>Show this plan</span></label>
        <label class="pricing-check"><input type="checkbox" data-plan-field="checkoutEnabled" data-key="${escapeHtml(key)}"${plan.checkoutEnabled ? ' checked' : ''}><span>Allow checkout during the window</span></label>
        <div class="pricing-form-grid four">
          ${field('Show from (Manila)', `<input type="datetime-local" value="${escapeHtml(toManilaInput(plan.displayStartsAt))}" data-plan-field="displayStartsAt" data-key="${escapeHtml(key)}">`, 'Optional display opening.')}
          ${field('Hide at (Manila)', `<input type="datetime-local" value="${escapeHtml(toManilaInput(plan.displayEndsAt))}" data-plan-field="displayEndsAt" data-key="${escapeHtml(key)}">`, 'Optional display closing.')}
          ${field('Checkout opens (Manila)', `<input type="datetime-local" value="${escapeHtml(toManilaInput(plan.checkoutStartsAt))}" data-plan-field="checkoutStartsAt" data-key="${escapeHtml(key)}">`)}
          ${field('Checkout closes (Manila)', `<input type="datetime-local" value="${escapeHtml(toManilaInput(plan.checkoutEndsAt))}" data-plan-field="checkoutEndsAt" data-key="${escapeHtml(key)}">`, 'Optional.')}
        </div>
      </fieldset>
    </article>`;
  }

  function paymentMethodsHtml(controller) {
    const methods = controller.config.paymentMethods;
    return `<section class="pricing-workspace-panel" data-editor-panel="payments" hidden>
      <div class="pricing-panel-heading">
        <div><p class="pricing-kicker">Payment QR</p><h2>Payment methods</h2><p>Selecting a QR shows a private local preview first. Click Upload image before saving the draft.</p></div>
        <button type="button" data-editor-action="add-payment">Add payment method</button>
      </div>
      <div class="pricing-item-list">${methods.length ? methods.map((method, index) => paymentMethodHtml(controller, method, index)).join('') : '<p class="pricing-empty-state">Add a payment method when you are ready to accept payments.</p>'}</div>
    </section>`;
  }

  function planOptions(controller, selected) {
    return `<option value=""${selected ? '' : ' selected'}>All plans</option>${controller.config.plans.map((plan) => `<option value="${escapeHtml(plan.planCode)}"${selected === plan.planCode ? ' selected' : ''}>${escapeHtml(plan.name || plan.planCode)}</option>`).join('')}`;
  }

  function paymentMethodHtml(controller, method, index) {
    const key = method._editorKey;
    const pending = controller.pendingFiles.get(key);
    const asset = method.qrAsset;
    const legacyQrUrl = legacyQrUrlFor(method);
    const previewAvailable = Boolean(pending || asset?.assetId || legacyQrUrl);
    return `<article class="pricing-edit-card" data-payment-key="${escapeHtml(key)}">
      <header><div><p>Payment method ${index + 1}</p><h3>${escapeHtml(method.label || 'Untitled payment method')}</h3></div>${itemActionButtons('payment', key, index, controller.config.paymentMethods.length)}</header>
      <div class="pricing-payment-layout">
        <div class="pricing-form-grid">
          ${field('Stable channel code', textInput(method.channelCode, `data-payment-field="channelCode" data-key="${escapeHtml(key)}" maxlength="64" pattern="[a-z][a-z0-9_]{2,63}" ${method._persisted ? 'readonly' : ''}`), method._persisted ? 'Saved codes cannot be renamed.' : 'For example bpi_instapay.')}
          ${field('Assign this QR to plan', `<select data-payment-field="planCode" data-key="${escapeHtml(key)}">${planOptions(controller, method.planCode)}</select>`, 'Choose 30-Day Access for its exact ₱199 QR, or All plans for a generic QR.')}
          ${field('Label', textInput(method.label, `data-payment-field="label" data-key="${escapeHtml(key)}" maxlength="100"`))}
          ${field('Account name', textInput(method.accountName, `data-payment-field="accountName" data-key="${escapeHtml(key)}" maxlength="200"`))}
          ${field('Account details', textarea(method.accountDetails, `data-payment-field="accountDetails" data-key="${escapeHtml(key)}" maxlength="500" rows="3"`))}
          ${field('Instructions', textarea(method.instructions, `data-payment-field="instructions" data-key="${escapeHtml(key)}" maxlength="4000" rows="4"`))}
          ${field('QR amount', `<select data-payment-field="qrAmountMode" data-key="${escapeHtml(key)}"><option value="exact"${method.qrAmountMode === 'exact' ? ' selected' : ''}>Exact plan amount</option><option value="generic"${method.qrAmountMode === 'generic' ? ' selected' : ''}>Generic QR</option></select>`, 'Exact QR should be assigned to one plan.')}
          <label class="pricing-check"><input type="checkbox" data-payment-field="enabled" data-key="${escapeHtml(key)}"${method.enabled ? ' checked' : ''}><span>Enable this payment method</span></label>
        </div>
        <div class="pricing-qr-box">
          <div class="pricing-qr-preview" data-qr-preview="${escapeHtml(key)}">${previewAvailable ? '<span>Loading QR preview…</span>' : '<span>No QR image selected</span>'}</div>
          <label class="pricing-file-control"><span>Choose PNG or JPEG</span><input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" data-qr-file data-key="${escapeHtml(key)}"></label>
          <button type="button" data-editor-action="upload-qr" data-key="${escapeHtml(key)}"${pending ? '' : ' disabled'}>Upload image</button>
          <small>${pending ? `${escapeHtml(pending.file.name)} · ${escapeHtml(Math.ceil(pending.file.size / 1024))} KB · not uploaded` : asset?.assetId ? `Uploaded asset ${escapeHtml(asset.assetId.slice(0, 8))}` : legacyQrUrl ? 'Existing protected payment QR' : 'Maximum 5 MB and 4096 × 4096 pixels.'}</small>
        </div>
      </div>
    </article>`;
  }

  function pageTextHtml(controller) {
    const page = controller.config.page;
    const faqs = controller.config.faqs;
    return `<section class="pricing-workspace-panel" data-editor-panel="page" hidden>
      <div class="pricing-panel-heading"><div><p class="pricing-kicker">Words customers see</p><h2>Page text</h2><p>Plain text only. HTML, scripts, custom CSS, and external links are not accepted.</p></div></div>
      <div class="pricing-edit-card pricing-page-card">
        <div class="pricing-form-grid">
          ${field('Eyebrow', textInput(page.eyebrow, 'data-page-field="eyebrow" maxlength="120"'))}
          ${field('Page title', textInput(page.title, 'data-page-field="title" maxlength="240"'))}
          ${field('Introduction', textarea(page.intro, 'data-page-field="intro" maxlength="2000" rows="4"'))}
          ${field('Notice', textarea(page.notice, 'data-page-field="notice" maxlength="2000" rows="4"'), 'Use this for a short timing or eligibility notice.')}
          ${field('Fine print', textarea(page.finePrint, 'data-page-field="finePrint" maxlength="2000" rows="5"'))}
        </div>
      </div>
      <div class="pricing-panel-heading pricing-faq-heading">
        <div><h3>Frequently asked questions</h3><p>Keep answers short and practical.</p></div>
        <button type="button" data-editor-action="add-faq">Add question</button>
      </div>
      <div class="pricing-item-list">${faqs.length ? faqs.map((faq, index) => faqHtml(controller, faq, index)).join('') : '<p class="pricing-empty-state">No questions added.</p>'}</div>
    </section>`;
  }

  function faqHtml(controller, faq, index) {
    const key = faq._editorKey;
    return `<article class="pricing-edit-card pricing-faq-card" data-faq-key="${escapeHtml(key)}">
      <header><div><p>Question ${index + 1}</p><h3>${escapeHtml(faq.question || 'Untitled question')}</h3></div>${itemActionButtons('faq', key, index, controller.config.faqs.length)}</header>
      <div class="pricing-form-grid">
        ${field('Question', textInput(faq.question, `data-faq-field="question" data-key="${escapeHtml(key)}" maxlength="300"`))}
        ${field('Answer', textarea(faq.answer, `data-faq-field="answer" data-key="${escapeHtml(key)}" maxlength="3000" rows="4"`))}
        <label class="pricing-check"><input type="checkbox" data-faq-field="visible" data-key="${escapeHtml(key)}"${faq.visible ? ' checked' : ''}><span>Show this question</span></label>
      </div>
    </article>`;
  }

  function operationDialogHtml(controller) {
    const operation = controller.operation;
    const copy = operation ? OPERATION_COPY[operation.type] : null;
    return `<dialog class="pricing-operation-dialog" data-pricing-operation-dialog aria-labelledby="pricing-operation-title">
      <form method="dialog" data-operation-form>
        <header><div><p class="pricing-kicker">Confirm publication change</p><h2 id="pricing-operation-title">${escapeHtml(copy?.title || 'Confirm change')}</h2></div><button type="button" data-editor-action="close-operation" aria-label="Close">×</button></header>
        <p>${escapeHtml(copy?.copy || '')}</p>
        ${operation?.type === 'schedule' ? field('Publish at (Asia/Manila)', `<input type="datetime-local" data-operation-publish-at required>`) : ''}
        ${operation?.type === 'rollback' ? `<p class="pricing-rollback-source">Source revision: <strong>${escapeHtml(operation.sourceRevisionId?.slice(0, 12) || 'Not selected')}</strong></p>` : ''}
        ${field('Reason', textarea('', 'data-operation-reason minlength="5" maxlength="1000" rows="4" required'), 'At least 5 characters. This is recorded in history.')}
        <p class="pricing-operation-error" data-operation-error role="alert" hidden></p>
        <label class="pricing-operation-confirm"><input type="checkbox" data-operation-confirm required><span>I reviewed the draft, timing, price, subscription term, and QR details. I understand this change is recorded.</span></label>
        <div class="pricing-dialog-actions"><button type="button" data-editor-action="close-operation">Back</button><button class="pricing-primary" type="submit">${escapeHtml(copy?.button || 'Confirm')}</button></div>
      </form>
    </dialog>`;
  }

  function renderEditor(controller, options = {}) {
    if (!controllerIsActive(controller)) return;
    const currentPanel = controller.panel;
    controller.root.innerHTML = `<div class="pricing-editor-status" data-editor-status role="status" aria-live="polite"${controller.message ? ` data-tone="${escapeHtml(controller.message.tone)}"` : ''}>
        <span>${escapeHtml(controller.message?.text || (controller.dirty ? 'Unsaved draft changes' : 'Draft matches the last server version'))}</span>
        ${controller.conflict ? '<button type="button" data-editor-action="reload-latest">Load latest server draft</button>' : ''}
      </div>
      <div class="pricing-editor-toolbar">
        <nav aria-label="Plans and pricing editor sections">
          <button type="button" data-editor-tab="overview">Overview</button>
          <button type="button" data-editor-tab="plans">Plans</button>
          <button type="button" data-editor-tab="payments">Payment QR</button>
          <button type="button" data-editor-tab="page">Page text</button>
        </nav>
        <p><span aria-hidden="true">●</span> Founder Admin only</p>
      </div>
      <div class="pricing-editor-layout">
        <div class="pricing-editor-workspace">
          ${overviewHtml(controller)}
          ${plansHtml(controller)}
          ${paymentMethodsHtml(controller)}
          ${pageTextHtml(controller)}
        </div>
        <aside class="pricing-preview-panel" aria-label="Live plans and pricing preview">
          <header><div><p class="pricing-kicker">Live preview</p><h2>Customer view</h2></div><div class="pricing-preview-toggle" role="group" aria-label="Preview size"><button type="button" data-preview-mode="desktop">Desktop</button><button type="button" data-preview-mode="mobile">Mobile</button></div></header>
          <div class="pricing-preview-frame" data-preview-frame data-preview-size="${escapeHtml(controller.previewMode)}"><div data-pricing-preview></div><div class="pricing-payment-preview" data-payment-preview></div></div>
          <p class="pricing-preview-note">Preview uses server time ${escapeHtml(formatDateTime(controller.snapshot.serverNow))}. Payment submission remains unchanged.</p>
        </aside>
      </div>
      ${operationDialogHtml(controller)}`;

    controller.root.querySelectorAll('[data-editor-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.editorPanel !== currentPanel;
    });
    controller.root.querySelectorAll('[data-editor-tab]').forEach((button) => {
      button.setAttribute('aria-current', button.dataset.editorTab === currentPanel ? 'page' : 'false');
    });
    controller.root.querySelectorAll('[data-preview-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.previewMode === controller.previewMode));
    });
    setBusy(controller, controller.busy);
    renderPreview(controller);
    hydrateQrPreviews(controller);

    if (controller.operation && options.openDialog !== false) {
      const dialog = controller.root.querySelector('[data-pricing-operation-dialog]');
      dialog?.showModal?.();
      dialog?.querySelector('[data-operation-reason]')?.focus();
    }
  }

  function renderPreview(controller) {
    if (!controllerIsActive(controller)) return;
    const host = controller.root.querySelector('[data-pricing-preview]');
    if (!host) return;
    renderer().render(host, serializeConfig(controller), {
      mode: 'preview',
      access: { serverNow: controller.snapshot.serverNow },
    });

    const paymentHost = controller.root.querySelector('[data-payment-preview]');
    if (!paymentHost) return;
    const enabled = controller.config.paymentMethods
      .filter((method) => method.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    paymentHost.innerHTML = enabled.length ? `<h3>Payment details</h3>${enabled.map((method) => `<article>
      <strong>${escapeHtml(method.label)}</strong>
      ${method.accountName ? `<span>${escapeHtml(method.accountName)}</span>` : ''}
      ${method.accountDetails ? `<p>${escapeHtml(method.accountDetails)}</p>` : ''}
      ${method.instructions ? `<small>${escapeHtml(method.instructions)}</small>` : ''}
    </article>`).join('')}` : '';
  }

  function controllerIsActive(controller) {
    return activeController === controller
      && controller.root?.isConnected
      && (typeof controller.options.isActive !== 'function' || controller.options.isActive());
  }

  function setBusy(controller, busy, label = '') {
    controller.busy = Boolean(busy);
    if (!controller.root) return;
    controller.root.toggleAttribute('aria-busy', controller.busy);
    controller.root.querySelectorAll('button, input, select, textarea').forEach((control) => {
      if (control.matches('[data-editor-action="close-operation"]')) return;
      if (controller.busy) {
        if (!Object.prototype.hasOwnProperty.call(control.dataset, 'pricingWasDisabled')) {
          control.dataset.pricingWasDisabled = String(control.disabled);
        }
        control.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(control.dataset, 'pricingWasDisabled')) {
        control.disabled = control.dataset.pricingWasDisabled === 'true';
        delete control.dataset.pricingWasDisabled;
      }
    });
    const status = controller.root.querySelector('[data-editor-status] span');
    if (busy && status) {
      status.textContent = label || 'Working…';
    } else if (status) {
      status.textContent = controller.message?.text
        || (controller.dirty ? 'Unsaved draft changes' : 'Draft matches the last server version');
    }
  }

  function setMessage(controller, tone, textValue, conflict = false) {
    controller.message = { tone, text: String(textValue || '') };
    controller.conflict = conflict;
    const node = controller.root?.querySelector('[data-editor-status]');
    if (!node) return;
    node.dataset.tone = tone;
    const textNode = node.querySelector('span');
    if (textNode) textNode.textContent = controller.message.text;
    const currentReload = node.querySelector('[data-editor-action="reload-latest"]');
    if (conflict && !currentReload) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.editorAction = 'reload-latest';
      button.textContent = 'Load latest server draft';
      node.append(button);
    } else if (!conflict) currentReload?.remove();
    controller.options.notify?.(controller.message.text);
  }

  function setOperationError(controller, form, message) {
    const textValue = String(message || 'Review the required fields and try again.');
    const node = form?.querySelector('[data-operation-error]');
    if (node) {
      node.textContent = textValue;
      node.hidden = false;
    }
    setMessage(controller, 'error', textValue);
  }

  function updateDirty(controller) {
    controller.dirty = controller.pendingFiles.size > 0
      || stableConfig(controller) !== controller.baseline;
    controller.options.onDirtyChange?.(controller.dirty);
    if (!controller.message || controller.message.tone === 'neutral') {
      controller.message = {
        tone: 'neutral',
        text: controller.dirty ? 'Unsaved draft changes' : 'Draft matches the last server version',
      };
    }
    const node = controller.root?.querySelector('[data-editor-status]');
    if (node && !controller.conflict) {
      node.dataset.tone = controller.message.tone;
      node.querySelector('span').textContent = controller.dirty
        ? 'Unsaved draft changes'
        : 'Draft matches the last server version';
    }
  }

  function revokeUrl(controller, url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    controller.objectUrls.delete(url);
  }

  function assetIdFor(method) {
    return String(method.qrAsset?.assetId || method.qrAssetId || '').trim();
  }

  function legacyQrUrlFor(method) {
    const supplied = String(method?.qrUrl || '').trim();
    return /^\/assets\/payments\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g)$/i.test(supplied)
      ? supplied
      : null;
  }

  async function hydrateQrPreviews(controller) {
    for (const method of controller.config.paymentMethods) {
      if (!controllerIsActive(controller)) return;
      const preview = controller.root.querySelector(`[data-qr-preview="${CSS.escape(method._editorKey)}"]`);
      if (!preview) continue;
      const pending = controller.pendingFiles.get(method._editorKey);
      if (pending?.url) {
        preview.innerHTML = `<img src="${escapeHtml(pending.url)}" alt="Selected QR preview"><span>Local preview</span>`;
        continue;
      }
      const assetId = assetIdFor(method);
      if (!assetId) {
        const legacyUrl = legacyQrUrlFor(method);
        preview.innerHTML = legacyUrl
          ? `<img src="${escapeHtml(legacyUrl)}" alt="Existing payment QR preview"><span>Existing protected QR</span>`
          : '<span>No QR image selected</span>';
        continue;
      }
      if (controller.assetUrls.has(assetId)) {
        preview.innerHTML = `<img src="${escapeHtml(controller.assetUrls.get(assetId))}" alt="Uploaded QR preview"><span>Uploaded QR</span>`;
        continue;
      }
      if (controller.assetLoads.has(assetId) || typeof controller.options.loadAsset !== 'function') continue;
      controller.assetLoads.add(assetId);
      try {
        const blob = await controller.options.loadAsset(assetId);
        if (!controllerIsActive(controller)) return;
        if (!(blob instanceof Blob) || !/^image\/(png|jpeg)$/i.test(blob.type)) {
          throw new Error('The saved QR preview was not a supported image.');
        }
        const url = URL.createObjectURL(blob);
        controller.objectUrls.add(url);
        controller.assetUrls.set(assetId, url);
        const current = controller.root.querySelector(`[data-qr-preview="${CSS.escape(method._editorKey)}"]`);
        if (current) current.innerHTML = `<img src="${escapeHtml(url)}" alt="Uploaded QR preview"><span>Uploaded QR</span>`;
      } catch (error) {
        if (controllerIsActive(controller)) {
          preview.innerHTML = `<span>${escapeHtml(error.message || 'QR preview unavailable')}</span>`;
        }
      } finally {
        controller.assetLoads.delete(assetId);
      }
    }
  }

  function findByKey(items, key) {
    return items.find((item) => item._editorKey === key);
  }

  function updatePlanField(controller, target) {
    const plan = findByKey(controller.config.plans, target.dataset.key);
    if (!plan) return;
    const fieldName = target.dataset.planField;
    if (fieldName === 'pricePesos') {
      plan.priceCentavos = Math.max(0, Math.round(Number(target.value || 0) * 100));
    } else if (fieldName === 'durationDays') {
      plan.durationDays = Math.max(1, Math.round(Number(target.value || 1)));
    } else if (fieldName === 'features') {
      plan.features = String(target.value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    } else if (['visible', 'checkoutEnabled'].includes(fieldName)) {
      plan[fieldName] = target.checked;
    } else if (['checkoutStartsAt', 'checkoutEndsAt', 'displayStartsAt', 'displayEndsAt'].includes(fieldName)) {
      plan[fieldName] = fromManilaInput(target.value);
    } else if (fieldName === 'planCode') {
      const previousCode = plan.planCode;
      plan.planCode = String(target.value || '').trim().toLowerCase();
      controller.config.paymentMethods.forEach((method) => {
        if (method.planCode === previousCode) method.planCode = plan.planCode;
      });
    } else if (fieldName) {
      plan[fieldName] = String(target.value || '');
    }
  }

  function updatePaymentField(controller, target) {
    const method = findByKey(controller.config.paymentMethods, target.dataset.key);
    if (!method) return;
    const fieldName = target.dataset.paymentField;
    if (fieldName === 'enabled') method.enabled = target.checked;
    else if (fieldName === 'planCode') method.planCode = String(target.value || '').trim() || null;
    else if (fieldName === 'channelCode') method.channelCode = String(target.value || '').trim().toLowerCase();
    else if (fieldName === 'qrAmountMode') {
      const previousMode = method.qrAmountMode;
      method.qrAmountMode = String(target.value || '');
      if (previousMode !== 'exact' && method.qrAmountMode === 'exact') {
        reconfirmExactQrAmount(controller, method);
      }
    }
    else if (fieldName) method[fieldName] = String(target.value || '');
  }

  function updateFaqField(controller, target) {
    const faq = findByKey(controller.config.faqs, target.dataset.key);
    if (!faq) return;
    const fieldName = target.dataset.faqField;
    if (fieldName === 'visible') faq.visible = target.checked;
    else if (fieldName) faq[fieldName] = String(target.value || '');
  }

  function onEditorInput(controller, event) {
    const target = event.target;
    if (target.matches('[data-page-field]')) {
      controller.config.page[target.dataset.pageField] = String(target.value || '');
    } else if (target.matches('[data-plan-field]')) updatePlanField(controller, target);
    else if (target.matches('[data-payment-field]')) updatePaymentField(controller, target);
    else if (target.matches('[data-faq-field]')) updateFaqField(controller, target);
    else return;
    controller.message = null;
    controller.conflict = false;
    updateDirty(controller);
    renderPreview(controller);
  }

  function normalizeSort(items) {
    items.forEach((item, index) => { item.sortOrder = (index + 1) * 10; });
  }

  function moveItem(controller, collectionName, key, direction) {
    const items = controller.config[collectionName];
    const index = items.findIndex((item) => item._editorKey === key);
    const next = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    normalizeSort(items);
    controller.message = null;
    updateDirty(controller);
    renderEditor(controller, { openDialog: false });
  }

  function removeItem(controller, collectionName, key) {
    const items = controller.config[collectionName];
    const item = findByKey(items, key);
    if (!item) return;
    if (!global.confirm('Remove this item from the draft? Nothing live changes until you publish.')) return;
    const pending = controller.pendingFiles.get(key);
    if (pending) revokeUrl(controller, pending.url);
    controller.pendingFiles.delete(key);
    controller.config[collectionName] = items.filter((candidate) => candidate !== item);
    normalizeSort(controller.config[collectionName]);
    controller.message = null;
    updateDirty(controller);
    renderEditor(controller, { openDialog: false });
  }

  function addPlan(controller) {
    if (controller.config.plans.length >= MAX_PLANS) {
      setMessage(controller, 'error', `A pricing revision can contain up to ${MAX_PLANS} plans.`);
      return;
    }
    const number = controller.config.plans.length + 1;
    controller.config.plans.push({
      versionId: consumeGeneratedId(controller, 'plan', 'plan-version'),
      planCode: `new_plan_${number}`,
      name: 'New plan',
      badge: '',
      priceCentavos: 19_900,
      durationDays: 30,
      description: '',
      features: [],
      ctaLabel: 'Subscribe for 30 days',
      renewalNote: 'Access does not renew automatically.',
      visible: true,
      checkoutEnabled: false,
      checkoutStartsAt: null,
      checkoutEndsAt: null,
      displayStartsAt: null,
      displayEndsAt: null,
      sortOrder: number * 10,
      _editorKey: randomId('plan'),
      _persisted: false,
    });
    controller.panel = 'plans';
    controller.message = null;
    updateDirty(controller);
    renderEditor(controller, { openDialog: false });
  }

  function addPaymentMethod(controller) {
    if (controller.config.paymentMethods.length >= MAX_PAYMENT_METHODS) {
      setMessage(controller, 'error', `A pricing revision can contain up to ${MAX_PAYMENT_METHODS} payment methods.`);
      return;
    }
    const number = controller.config.paymentMethods.length + 1;
    controller.config.paymentMethods.push({
      versionId: consumeGeneratedId(controller, 'paymentMethod', 'payment-version'),
      channelCode: `payment_${number}`,
      planCode: null,
      label: 'New payment method',
      accountName: '',
      accountDetails: '',
      instructions: '',
      qrAsset: null,
      qrAmountMode: 'generic',
      qrAmountCentavos: null,
      enabled: false,
      visible: true,
      sortOrder: number * 10,
      _editorKey: randomId('payment'),
      _persisted: false,
    });
    controller.panel = 'payments';
    controller.message = null;
    updateDirty(controller);
    renderEditor(controller, { openDialog: false });
  }

  function addFaq(controller) {
    if (controller.config.faqs.length >= MAX_FAQS) {
      setMessage(controller, 'error', `A pricing revision can contain up to ${MAX_FAQS} questions.`);
      return;
    }
    const number = controller.config.faqs.length + 1;
    controller.config.faqs.push({
      id: consumeGeneratedId(controller, 'faq', 'faq'),
      question: 'New question',
      answer: '',
      visible: true,
      sortOrder: number * 10,
      _editorKey: randomId('faq'),
      _persisted: false,
    });
    controller.panel = 'page';
    controller.message = null;
    updateDirty(controller);
    renderEditor(controller, { openDialog: false });
  }

  function imageDimensions(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The selected file is not a readable image.'));
      image.src = url;
    });
  }

  async function validateQrFile(file) {
    if (!(file instanceof File) || file.size <= 0) throw new Error('Choose a PNG or JPEG image.');
    if (file.size > QR_MAX_BYTES) throw new Error('The QR image must be 5 MB or smaller.');
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const isPng = bytes.length >= 8
      && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!isPng && !isJpeg) throw new Error('Only real PNG and JPEG image files are accepted.');
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    if (file.type && file.type !== mimeType) throw new Error('The file type does not match the image contents.');
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await imageDimensions(url);
      if (dimensions.width < QR_MIN_EDGE || dimensions.height < QR_MIN_EDGE
          || dimensions.width > QR_MAX_EDGE || dimensions.height > QR_MAX_EDGE) {
        throw new Error(`The QR image must be between ${QR_MIN_EDGE} and ${QR_MAX_EDGE} pixels on each side.`);
      }
      return { file, url, mimeType, ...dimensions };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function selectQrFile(controller, input) {
    const method = findByKey(controller.config.paymentMethods, input.dataset.key);
    const file = input.files?.[0];
    if (!method || !file) return;
    setBusy(controller, true, 'Checking QR image…');
    try {
      const validated = await validateQrFile(file);
      if (!controllerIsActive(controller)) {
        URL.revokeObjectURL(validated.url);
        return;
      }
      const previous = controller.pendingFiles.get(method._editorKey);
      if (previous) revokeUrl(controller, previous.url);
      controller.pendingFiles.set(method._editorKey, validated);
      controller.objectUrls.add(validated.url);
      updateDirty(controller);
      setMessage(controller, 'success', 'QR image selected. Review the preview, then click Upload image.');
      renderEditor(controller, { openDialog: false });
    } catch (error) {
      if (controllerIsActive(controller)) setMessage(controller, 'error', error.message || 'The QR image could not be selected.');
    } finally {
      if (controllerIsActive(controller)) setBusy(controller, false);
    }
  }

  function assetFromPayload(payload) {
    const source = unwrapEnvelope(payload);
    const asset = asObject(source.asset || source.upload || source);
    const assetId = String(asset.assetId || asset.id || '').trim();
    if (!assetId) throw new Error('The server did not return a QR asset ID.');
    return {
      assetId,
      sha256: String(asset.sha256 || '').trim(),
      mimeType: String(asset.mimeType || asset.mime_type || '').trim(),
      width: Math.max(0, Math.round(Number(asset.width || 0))),
      height: Math.max(0, Math.round(Number(asset.height || 0))),
    };
  }

  async function uploadQr(controller, key) {
    const method = findByKey(controller.config.paymentMethods, key);
    const pending = controller.pendingFiles.get(key);
    if (!method || !pending) {
      setMessage(controller, 'error', 'Choose a PNG or JPEG image before uploading.');
      return;
    }
    if (typeof controller.options.uploadAsset !== 'function') {
      setMessage(controller, 'error', 'QR upload is not available. Nothing was changed.');
      return;
    }
    const formData = new FormData();
    formData.append('draftRevisionId', controller.draftRevisionId || '');
    formData.append('paymentMethodId', method.versionId || method.channelCode);
    formData.append('channelCode', method.channelCode);
    formData.append('expectedDraftVersion', String(controller.expectedDraftVersion));
    formData.append('requestKey', randomId('pricing-upload'));
    formData.append('file', pending.file, pending.file.name);
    setBusy(controller, true, 'Uploading QR image…');
    try {
      const payload = await controller.options.uploadAsset(formData);
      if (!controllerIsActive(controller)) return;
      method.qrAsset = assetFromPayload(payload);
      method.qrUrl = null;
      reconfirmExactQrAmount(controller, method);
      revokeUrl(controller, pending.url);
      controller.pendingFiles.delete(key);
      controller.message = null;
      updateDirty(controller);
      setMessage(controller, 'success', 'QR image uploaded. Save the draft to attach it to this payment method.');
      renderEditor(controller, { openDialog: false });
    } catch (error) {
      if (controllerIsActive(controller)) {
        const conflict = /VERSION_CONFLICT/i.test(String(error.code || ''));
        setMessage(
          controller,
          'error',
          conflict
            ? 'Someone else changed this draft. Your local edits are still here. Load the latest server draft before retrying.'
            : error.message || 'The QR image could not be uploaded. Nothing was published.',
          conflict,
        );
      }
    } finally {
      if (controllerIsActive(controller)) setBusy(controller, false);
    }
  }

  function hasMarkup(value) {
    const supplied = String(value || '');
    return /<\/?[a-z][^>]*>|javascript\s*:|(?:^|[\s"'])data\s*:/i.test(supplied);
  }

  function validatePlainText(value, label) {
    if (hasMarkup(value)) throw new Error(`${label} must be plain text without HTML, scripts, or data URLs.`);
  }

  function validateWindow(startValue, endValue, label) {
    if (!startValue || !endValue) return;
    if (new Date(endValue).getTime() <= new Date(startValue).getTime()) {
      throw new Error(`${label} closing time must be later than its opening time.`);
    }
  }

  function validateConfig(controller, operation) {
    if (controller.pendingFiles.size) {
      throw new Error('Upload each selected QR image before saving or publishing.');
    }
    const config = serializeConfig(controller);
    if (!config.plans.length || config.plans.length > MAX_PLANS) {
      throw new Error(`Add at least one plan and keep the revision to ${MAX_PLANS} plans or fewer.`);
    }
    if (config.paymentMethods.length > MAX_PAYMENT_METHODS) {
      throw new Error(`Keep the revision to ${MAX_PAYMENT_METHODS} payment methods or fewer.`);
    }
    if (config.faqs.length > MAX_FAQS) {
      throw new Error(`Keep the revision to ${MAX_FAQS} questions or fewer.`);
    }
    if (!config.page.title) throw new Error('Add a page title.');
    Object.entries(config.page).forEach(([key, value]) => validatePlainText(value, `Page ${key}`));

    const codes = new Set();
    config.plans.forEach((plan, index) => {
      if (!CODE_PATTERN.test(plan.planCode)) {
        throw new Error(`Plan ${index + 1} needs a stable code of at least 3 characters, starting with a lowercase letter.`);
      }
      if (codes.has(plan.planCode)) throw new Error(`Plan code “${plan.planCode}” is used more than once.`);
      codes.add(plan.planCode);
      if (plan.name.length < 2 || plan.name.length > 100) {
        throw new Error(`Plan ${index + 1} needs a name between 2 and 100 characters.`);
      }
      if (!Number.isInteger(plan.priceCentavos) || plan.priceCentavos < 0) {
        throw new Error(`${plan.name} needs a valid peso price.`);
      }
      if (plan.checkoutEnabled && plan.priceCentavos === 0) {
        throw new Error(`${plan.name} needs a price above ₱0 before checkout can be enabled.`);
      }
      if (plan.entitlementMode !== 'fixed_end'
          && (!Number.isInteger(plan.durationDays) || plan.durationDays < 1 || plan.durationDays > 366)) {
        throw new Error(`${plan.name} needs a subscription duration between 1 and 366 days.`);
      }
      validateWindow(plan.displayStartsAt, plan.displayEndsAt, `${plan.name} display`);
      validateWindow(plan.checkoutStartsAt, plan.checkoutEndsAt, `${plan.name} checkout`);
      [plan.name, plan.badge, plan.description, plan.ctaLabel, plan.renewalNote, ...plan.features]
        .forEach((value) => validatePlainText(value, plan.name || `Plan ${index + 1}`));
    });
    if (['publish', 'schedule'].includes(operation) && !config.plans.some((plan) => plan.visible)) {
      throw new Error('At least one plan must be visible before publishing.');
    }

    const channels = new Set();
    config.paymentMethods.forEach((method, index) => {
      if (!CODE_PATTERN.test(method.channelCode)) {
        throw new Error(`Payment method ${index + 1} needs a stable lowercase channel code.`);
      }
      if (method.label.length < 2 || method.label.length > 100) {
        throw new Error(`Payment method ${index + 1} needs a label between 2 and 100 characters.`);
      }
      const channelKey = `${method.channelCode}:${method.planCode || 'all'}`;
      if (channels.has(channelKey)) {
        throw new Error(`${method.channelCode} is already assigned to ${method.planCode || 'all plans'}.`);
      }
      channels.add(channelKey);
      if (method.planCode && !codes.has(method.planCode)) {
        throw new Error(`${method.label} refers to a plan that no longer exists.`);
      }
      if (method.qrAmountMode === 'exact' && !method.planCode) {
        throw new Error(`${method.label} uses an exact QR amount, so assign it to one plan.`);
      }
      if (method.qrAmountMode === 'exact' && !Number.isInteger(method.qrAmountCentavos)) {
        throw new Error(`${method.label} needs a captured exact amount. Choose Generic QR until the exact amount is reconfirmed.`);
      }
      if (method.enabled && !method.qrAsset?.assetId && !legacyQrUrlFor(method)) {
        throw new Error(`Disable ${method.label} or upload its QR image before saving this draft.`);
      }
      [method.label, method.accountName, method.accountDetails, method.instructions]
        .forEach((value) => validatePlainText(value, method.label || `Payment method ${index + 1}`));
    });

    config.faqs.forEach((faq, index) => {
      validatePlainText(faq.question, `Question ${index + 1}`);
      validatePlainText(faq.answer, `Answer ${index + 1}`);
      if (faq.question.length < 2 || faq.answer.length < 2) {
        throw new Error(`Question ${index + 1} needs both a question and an answer of at least 2 characters.`);
      }
    });
    return config;
  }

  function expectedLiveRevisionId(controller) {
    return revisionId(controller.snapshot.live);
  }

  function actionBody(controller, operation, details = {}) {
    const scheduledRevisionId = revisionId(controller.snapshot.scheduled);
    const sourceRevisionId = details.sourceRevisionId
      || (operation === 'cancel_schedule' ? scheduledRevisionId : null);
    const body = {
      operation,
      requestKey: randomId(`pricing-${operation}`),
      expectedDraftVersion: operation === 'cancel_schedule'
        ? controller.snapshot.scheduled ? revisionVersion(controller.snapshot.scheduled) : null
        : controller.expectedDraftVersion,
      expectedLiveRevisionId: expectedLiveRevisionId(controller),
      draftRevisionId: controller.draftRevisionId,
      sourceRevisionId,
      publishAt: details.publishAt || null,
      config: ['save_draft', 'schedule', 'publish'].includes(operation)
        ? validateConfig(controller, operation)
        : undefined,
      reason: details.reason || null,
      confirmed: Boolean(details.confirmed),
    };
    Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
    return body;
  }

  async function ensureDraft(controller) {
    if (controller.draftRevisionId) return;
    const liveRevisionId = expectedLiveRevisionId(controller);
    if (!liveRevisionId) throw new Error('Publish an initial pricing revision before starting a draft.');
    await controller.options.action({
      operation: 'create_draft',
      requestKey: randomId('pricing-create-draft'),
      expectedDraftVersion: null,
      expectedLiveRevisionId: liveRevisionId,
      draftRevisionId: null,
      sourceRevisionId: liveRevisionId,
      publishAt: null,
      reason: null,
      confirmed: false,
    });
    if (!controllerIsActive(controller)) return;
    const payload = await controller.options.query();
    if (!controllerIsActive(controller)) return;
    const latest = normalizeSnapshot(payload);
    const draftId = revisionId(latest.draft);
    if (!draftId) throw new Error('The new draft was created, but its version could not be loaded. Refresh before retrying.');
    controller.snapshot = latest;
    controller.draftRevisionId = draftId;
    controller.expectedDraftVersion = latest.expectedDraftVersion;
  }

  function operationSuccess(operation) {
    if (operation === 'save_draft') return 'Draft saved. Nothing was published.';
    if (operation === 'schedule') return 'Publication scheduled using Asia/Manila server time.';
    if (operation === 'publish') return 'Plans and pricing published.';
    if (operation === 'cancel_schedule') return 'Scheduled publication cancelled. The live revision is unchanged.';
    if (operation === 'rollback') return 'Earlier pricing restored as a new published revision.';
    return 'Pricing updated.';
  }

  function clearObjectUrls(controller) {
    [...controller.objectUrls].forEach((url) => URL.revokeObjectURL(url));
    controller.objectUrls.clear();
    controller.assetUrls.clear();
    controller.assetLoads.clear();
    controller.pendingFiles.clear();
  }

  function applySnapshot(controller, payload, message = null) {
    clearObjectUrls(controller);
    controller.snapshot = normalizeSnapshot(payload);
    controller.config = withEditorMetadata(chooseSnapshotConfig(controller.snapshot), true);
    controller.expectedDraftVersion = controller.snapshot.expectedDraftVersion;
    controller.draftRevisionId = revisionId(controller.snapshot.draft);
    controller.baseline = stableConfig(controller);
    controller.dirty = false;
    controller.conflict = false;
    controller.message = message ? { tone: 'success', text: message } : null;
    controller.operation = null;
    controller.options.onDirtyChange?.(false);
  }

  async function reloadSnapshot(controller, options = {}) {
    if (typeof controller.options.query !== 'function') {
      throw new Error('The latest pricing draft could not be requested.');
    }
    if (options.confirm && controller.dirty
        && !global.confirm('Discard these local edits and load the latest server draft?')) return false;
    setBusy(controller, true, 'Loading the latest server draft…');
    try {
      const payload = await controller.options.query();
      if (!controllerIsActive(controller)) return false;
      applySnapshot(controller, payload, options.message || null);
      renderEditor(controller, { openDialog: false });
      return true;
    } finally {
      if (controllerIsActive(controller)) setBusy(controller, false);
    }
  }

  async function performOperation(controller, operation, details = {}) {
    if (typeof controller.options.action !== 'function') {
      setMessage(controller, 'error', 'Pricing changes are not available. Nothing was changed.');
      return;
    }
    try {
      if (['save_draft', 'schedule', 'publish'].includes(operation)) {
        validateConfig(controller, operation);
      }
    } catch (error) {
      setMessage(controller, 'error', error.message);
      return;
    }
    setBusy(controller, true, operation === 'save_draft' ? 'Saving draft…' : 'Recording publication change…');
    try {
      if (['save_draft', 'schedule', 'publish'].includes(operation)) await ensureDraft(controller);
      if (!controllerIsActive(controller)) return;
      const body = actionBody(controller, operation, details);
      await controller.options.action(body);
      if (!controllerIsActive(controller)) return;
      await reloadSnapshot(controller, { message: operationSuccess(operation) });
    } catch (error) {
      if (!controllerIsActive(controller)) return;
      const conflict = /VERSION_CONFLICT|STALE_(?:DRAFT|REVISION)/i.test(String(error.code || ''))
        || /draft changed|published pricing changed|refresh before/i.test(String(error.message || ''));
      setMessage(
        controller,
        'error',
        conflict
          ? 'Another Founder Admin saved a newer version. Your local edits are still here. Load the latest server draft before retrying.'
          : error.message || 'The pricing change could not be saved. Nothing was published.',
        conflict,
      );
    } finally {
      if (controllerIsActive(controller)) setBusy(controller, false);
    }
  }

  function openOperation(controller, button) {
    const type = button.dataset.operation;
    if (!OPERATION_COPY[type]) return;
    controller.operation = {
      type,
      sourceRevisionId: String(button.dataset.sourceRevisionId || '').trim() || null,
    };
    renderEditor(controller);
  }

  function restoreOperationFocus(controller, operation) {
    if (!operation) return;
    const target = Array.from(controller.root.querySelectorAll('[data-editor-action="open-operation"]'))
      .find((button) => button.dataset.operation === operation.type
        && String(button.dataset.sourceRevisionId || '') === String(operation.sourceRevisionId || ''));
    target?.focus?.();
  }

  function closeOperation(controller) {
    const operation = controller.operation;
    controller.operation = null;
    controller.root.querySelector('[data-pricing-operation-dialog]')?.close?.();
    renderEditor(controller, { openDialog: false });
    restoreOperationFocus(controller, operation);
  }

  async function submitOperation(controller, form) {
    const operation = controller.operation;
    if (!operation) return;
    const reason = String(form.querySelector('[data-operation-reason]')?.value || '').trim();
    const confirmed = form.querySelector('[data-operation-confirm]')?.checked === true;
    if (reason.length < 5) {
      setOperationError(controller, form, 'Provide a reason of at least 5 characters.');
      return;
    }
    if (!confirmed) {
      setOperationError(controller, form, 'Confirm that you reviewed the price, timing, term, and QR details.');
      return;
    }
    let publishAt = null;
    if (operation.type === 'schedule') {
      publishAt = fromManilaInput(form.querySelector('[data-operation-publish-at]')?.value);
      if (!publishAt || new Date(publishAt).getTime() <= new Date(controller.snapshot.serverNow).getTime()) {
        setOperationError(controller, form, 'Choose a future publication time in Asia/Manila.');
        return;
      }
    }
    controller.root.querySelector('[data-pricing-operation-dialog]')?.close?.();
    controller.operation = null;
    await performOperation(controller, operation.type, {
      reason,
      confirmed,
      publishAt,
      sourceRevisionId: operation.sourceRevisionId,
    });
  }

  function chooseSnapshotConfig(snapshot) {
    const draftConfig = revisionConfig(snapshot.draft);
    if (Object.keys(draftConfig).length) return draftConfig;
    const scheduledConfig = revisionConfig(snapshot.scheduled);
    if (Object.keys(scheduledConfig).length) return scheduledConfig;
    const liveConfig = revisionConfig(snapshot.live);
    if (Object.keys(liveConfig).length) return liveConfig;
    return {
      page: {
        eyebrow: 'Due Diligence access',
        title: 'Plans & Pricing',
        intro: '',
        notice: '',
        finePrint: '',
      },
      plans: [],
      paymentMethods: [],
      faqs: [],
    };
  }

  async function handleEditorClick(controller, event) {
    const tab = event.target.closest('[data-editor-tab]');
    if (tab) {
      controller.panel = tab.dataset.editorTab;
      renderEditor(controller, { openDialog: false });
      return;
    }
    const previewButton = event.target.closest('[data-preview-mode]');
    if (previewButton) {
      controller.previewMode = previewButton.dataset.previewMode === 'mobile' ? 'mobile' : 'desktop';
      controller.root.querySelector('[data-preview-frame]')?.setAttribute('data-preview-size', controller.previewMode);
      controller.root.querySelectorAll('[data-preview-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button === previewButton));
      });
      return;
    }
    const button = event.target.closest('[data-editor-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.editorAction;
    if (action === 'add-plan') addPlan(controller);
    else if (action === 'add-payment') addPaymentMethod(controller);
    else if (action === 'add-faq') addFaq(controller);
    else if (action === 'move-plan') moveItem(controller, 'plans', button.dataset.key, button.dataset.direction);
    else if (action === 'move-payment') moveItem(controller, 'paymentMethods', button.dataset.key, button.dataset.direction);
    else if (action === 'move-faq') moveItem(controller, 'faqs', button.dataset.key, button.dataset.direction);
    else if (action === 'remove-plan') removeItem(controller, 'plans', button.dataset.key);
    else if (action === 'remove-payment') removeItem(controller, 'paymentMethods', button.dataset.key);
    else if (action === 'remove-faq') removeItem(controller, 'faqs', button.dataset.key);
    else if (action === 'upload-qr') await uploadQr(controller, button.dataset.key);
    else if (action === 'save-draft') await performOperation(controller, 'save_draft');
    else if (action === 'open-operation') openOperation(controller, button);
    else if (action === 'close-operation') closeOperation(controller);
    else if (action === 'reload-latest') {
      try {
        await reloadSnapshot(controller, { confirm: true });
      } catch (error) {
        if (controllerIsActive(controller)) setMessage(controller, 'error', error.message || 'The latest draft could not be loaded.');
      }
    }
  }

  function mount(options = {}) {
    destroy();
    const root = options.root?.matches?.('[data-pricing-editor-root]')
      ? options.root
      : options.root?.querySelector?.('[data-pricing-editor-root]');
    if (!(root instanceof Element)) throw new Error('The Plans & Pricing editor could not be mounted.');
    const snapshot = normalizeSnapshot(options.snapshot);
    const controller = {
      root,
      options,
      snapshot,
      config: withEditorMetadata(chooseSnapshotConfig(snapshot), true),
      expectedDraftVersion: snapshot.expectedDraftVersion,
      draftRevisionId: revisionId(snapshot.draft),
      baseline: '',
      dirty: false,
      busy: false,
      conflict: false,
      message: null,
      panel: 'overview',
      previewMode: 'desktop',
      operation: null,
      pendingFiles: new Map(),
      assetUrls: new Map(),
      assetLoads: new Set(),
      objectUrls: new Set(),
    };
    controller.baseline = stableConfig(controller);
    controller.handleClick = (event) => { handleEditorClick(controller, event); };
    controller.handleInput = (event) => onEditorInput(controller, event);
    controller.handleChange = (event) => {
      if (event.target.matches('[data-qr-file]')) selectQrFile(controller, event.target);
    };
    controller.handleSubmit = (event) => {
      if (!event.target.matches('[data-operation-form]')) return;
      event.preventDefault();
      submitOperation(controller, event.target);
    };
    controller.handleCancel = (event) => {
      if (!event.target.matches('[data-pricing-operation-dialog]')) return;
      event.preventDefault();
      closeOperation(controller);
    };
    root.addEventListener('click', controller.handleClick);
    root.addEventListener('input', controller.handleInput);
    root.addEventListener('change', controller.handleChange);
    root.addEventListener('submit', controller.handleSubmit);
    root.addEventListener('cancel', controller.handleCancel);
    activeController = controller;
    renderEditor(controller, { openDialog: false });
    return controller;
  }

  function isDirty() {
    return Boolean(activeController?.dirty);
  }

  function confirmLeave() {
    if (!activeController) return true;
    if (activeController.busy) {
      activeController.options.notify?.('Wait for the pricing change to finish before leaving this page.');
      return false;
    }
    if (!activeController.dirty) return true;
    return global.confirm('Leave Plans & Pricing and discard unsaved draft changes?');
  }

  function destroy() {
    const controller = activeController;
    if (!controller) return;
    controller.root?.removeEventListener('click', controller.handleClick);
    controller.root?.removeEventListener('input', controller.handleInput);
    controller.root?.removeEventListener('change', controller.handleChange);
    controller.root?.removeEventListener('submit', controller.handleSubmit);
    controller.root?.removeEventListener('cancel', controller.handleCancel);
    clearObjectUrls(controller);
    activeController = null;
  }

  global.addEventListener('beforeunload', (event) => {
    if (!activeController?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  global.DueDiligencePricingEditor = Object.freeze({
    shell: editorShell,
    mount,
    destroy,
    isDirty,
    confirmLeave,
    normalizeSnapshot,
  });
})(window);
