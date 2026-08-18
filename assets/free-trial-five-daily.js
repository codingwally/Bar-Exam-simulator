(function freeTrialFiveDailyExperience(global) {
  'use strict';

  const DAILY_LIMIT = 5;
  const PROTECTED_ROUTES = new Set([
    'bar-easy',
    'doctrines',
    'mock-bar',
    'subject-matter',
    'bar-feels',
    'verdict',
  ]);
  const copy = Object.freeze({
    intro: 'Choose your access before continuing. The Free Trial allows up to 5 protected question submissions per Philippine day through September 1, 2026. ₱149 Early Access provides unlimited access through October 1, 2026. Neither option renews automatically.',
    terms: 'Every ordinary account must choose one access option. The Free Trial allows up to five successful protected question submissions per Philippine calendar day through September 1, 2026, with the allowance resetting at Philippine midnight. The one-time ₱149 Early Access offer provides unlimited access through October 1, 2026. Administrator and approved Founding Beta accounts keep their existing access.',
    faq: 'How do the two access options work? The Free Trial begins only when selected and allows up to five successful protected question submissions per Philippine day through September 1, 2026. Early Access is a one-time ₱149 payment for unlimited access through October 1, 2026. A submitted payment proof receives one non-renewable 24-hour provisional period while verification is pending.',
  });

  let access = null;
  let observer = null;
  let lastDailyLimitNotice = '';

  function routeName() {
    return String(location.hash || '')
      .replace(/^#/, '')
      .split('?')[0]
      .trim()
      .toLowerCase();
  }

  function installStyles() {
    if (document.getElementById('dd-five-daily-copy-style')) return;
    const style = document.createElement('style');
    style.id = 'dd-five-daily-copy-style';
    style.textContent = `
      .dd-five-daily-copy {
        font-size: 0 !important;
      }
      .dd-five-daily-copy::after {
        content: attr(data-dd-five-daily-copy);
        display: block;
        font-size: 0.95rem;
        line-height: 1.65;
        white-space: normal;
      }
      .dd-five-daily-price-note {
        font-size: 0 !important;
      }
      .dd-five-daily-price-note::after {
        content: '5 questions per day';
        font-size: 0.72rem;
        line-height: 1.2;
        white-space: nowrap;
      }
      .dd-five-daily-choice-button {
        font-size: 0 !important;
      }
      .dd-five-daily-choice-button::after {
        content: 'Choose Free Trial — 5/day';
        font-size: 0.92rem;
        line-height: 1.2;
      }
    `;
    document.head.append(style);
  }

  function markCopy(element, value) {
    if (!element) return;
    if (!element.classList.contains('dd-five-daily-copy')) {
      element.classList.add('dd-five-daily-copy');
    }
    if (element.dataset.ddFiveDailyCopy !== value) {
      element.dataset.ddFiveDailyCopy = value;
    }
    if (element.getAttribute('aria-label') !== value) {
      element.setAttribute('aria-label', value);
    }
  }

  function freeTrialCard(body) {
    return Array.from(body.querySelectorAll('.dd2-plan')).find((card) => {
      const title = card.querySelector('h3')?.textContent?.trim().toLowerCase();
      return title === 'free' || title === 'free trial' || title === 'launch trial';
    }) || null;
  }

  function patchRetainerCopy() {
    const body = document.getElementById('dd2-native-body');
    if (!body) return;

    const pricingHost = document.getElementById('dd2-pricing-plans');
    if (pricingHost) {
      markCopy(body.querySelector('.dd2-pricing-intro'), copy.intro);
      const card = freeTrialCard(body);
      if (card) {
        const priceNote = card.querySelector('.dd2-price small');
        if (priceNote && !priceNote.classList.contains('dd-five-daily-price-note')) {
          priceNote.classList.add('dd-five-daily-price-note');
        }
        if (priceNote?.getAttribute('aria-label') !== '5 questions per Philippine day') {
          priceNote?.setAttribute('aria-label', '5 questions per Philippine day');
        }

        const button = card.querySelector('#dd2-start-free-trial');
        const selectable = button
          && !button.disabled
          && /start|choose/i.test(button.textContent || '');
        if (selectable) {
          button.classList.add('dd-five-daily-choice-button');
          button.setAttribute(
            'aria-label',
            'Choose Free Trial with five questions per Philippine day',
          );
        } else if (button) {
          button.classList.remove('dd-five-daily-choice-button');
        }
      }
    }

    body.querySelectorAll('h3').forEach((heading) => {
      const title = heading.textContent?.trim();
      if (title === 'Free and Early Access'
          || title === 'Free Trial and Early Access') {
        markCopy(heading.nextElementSibling, copy.terms);
      }
    });

    body.querySelectorAll('p').forEach((paragraph) => {
      const text = paragraph.textContent || '';
      if (text.includes('How do the two access options work?')
          || text.includes('How does Free access work?')
          || text.includes('How does Early Access work?')) {
        markCopy(paragraph, copy.faq);
      }
    });
  }

  function patchAccessBadge(nextAccess = access) {
    const badge = document.getElementById('dd2-guest-badge');
    if (!badge || !nextAccess) return;

    const basis = String(nextAccess.basis || '');
    if (basis === 'plan_selection_required') {
      badge.textContent = 'Choose access · Free Trial (5/day) or ₱149';
      badge.classList.add('is-visible');
      return;
    }

    if (!['daily_free', 'daily_limit_reached'].includes(basis)) return;
    const limit = Math.max(1, Number(nextAccess.dailyLimit) || DAILY_LIMIT);
    const remaining = Math.min(
      limit,
      Math.max(0, Number(nextAccess.remainingToday) || 0),
    );
    badge.textContent = `Free Trial · ${remaining} of ${limit} remaining today`;
    badge.classList.add('is-visible');
  }

  function notifyDailyLimit(nextAccess = access) {
    if (nextAccess?.basis !== 'daily_limit_reached') return;
    if (!PROTECTED_ROUTES.has(routeName())) return;
    const noticeKey = String(nextAccess.resetAt || 'next-midnight');
    if (lastDailyLimitNotice === noticeKey) return;
    lastDailyLimitNotice = noticeKey;
    global.toast?.(
      'You have used all 5 Free Trial questions for today. Your allowance resets at Philippine midnight.',
      'warn',
    );
  }

  function installToastCopyGuard() {
    const current = global.toast;
    if (typeof current !== 'function' || current.__ddFiveDailyCopyGuard === true) return;

    const wrapped = function fiveDailyToast(message, type, ...rest) {
      let normalized = String(message ?? '');
      if (normalized === 'Free Trial started. Full practice access is active through September 1, 2026.') {
        normalized = 'Free Trial started. You may submit up to 5 protected questions per Philippine day through September 1, 2026.';
      } else if (normalized === 'Choose Free Trial or ₱149 Early Access before continuing.') {
        normalized = 'Choose Free Trial (5 questions per day) or ₱149 Early Access before continuing.';
      }
      return current.call(this, normalized, type, ...rest);
    };
    Object.defineProperty(wrapped, '__ddFiveDailyCopyGuard', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    global.toast = wrapped;
  }

  function sync(nextAccess = access) {
    if (nextAccess) access = nextAccess;
    installStyles();
    patchRetainerCopy();
    patchAccessBadge();
    notifyDailyLimit();
  }

  installToastCopyGuard();

  global.addEventListener('duediligence:access', (event) => {
    sync(event.detail || null);
    requestAnimationFrame(() => patchRetainerCopy());
  });

  global.addEventListener('load', () => {
    installToastCopyGuard();
    sync(global.DueDiligencePhase4?.getAccess?.() || null);
    if (!observer && document.body) {
      observer = new MutationObserver(() => {
        patchRetainerCopy();
        patchAccessBadge();
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
      });
    }
  }, { once: true });
}(window));
