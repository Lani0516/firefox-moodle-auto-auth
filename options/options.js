'use strict';

/**
 * Options page controller.
 * Loads / saves settings from browser.storage.local.
 */

(function () {
  // ── Defaults ─────────────────────────────────────────────────────────
  const DEFAULTS = {
    siteUrl: '*://moodle.ncku.edu.tw/login/*',
    autoSubmit: true,
    submitDelay: 300,
    charWhitelist: '0123456789',
    numericOnly: true,
    retryOnFail: true,
    maxRetries: 3,
  };

  // ── DOM refs ─────────────────────────────────────────────────────────
  const form = document.getElementById('settings-form');
  const feedbackEl = document.getElementById('feedback');
  const resetBtn = document.getElementById('reset-btn');
  const numericOnlyCheckbox = document.getElementById('numericOnly');
  const charWhitelistInput = document.getElementById('charWhitelist');

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Show feedback banner; auto-hide after `duration` ms. */
  function showFeedback(message, type, duration) {
    feedbackEl.textContent = message;
    feedbackEl.className = 'feedback ' + type;
    feedbackEl.hidden = false;

    if (duration == null) {
      duration = 2500;
    }

    clearTimeout(showFeedback._timer);
    showFeedback._timer = setTimeout(function () {
      feedbackEl.hidden = true;
    }, duration);
  }

  /** Apply values object to the form controls. */
  function populateForm(values) {
    document.getElementById('siteUrl').value = values.siteUrl;
    document.getElementById('autoSubmit').checked = values.autoSubmit;
    document.getElementById('submitDelay').value = values.submitDelay;
    document.getElementById('charWhitelist').value = '0123456789';
    document.getElementById('numericOnly').checked = true;
    document.getElementById('retryOnFail').checked = values.retryOnFail;
    document.getElementById('maxRetries').value = values.maxRetries;
    syncWhitelistState();
  }

  /** Read current form values into an object. */
  function readForm() {
    return {
      siteUrl: document.getElementById('siteUrl').value.trim(),
      autoSubmit: document.getElementById('autoSubmit').checked,
      submitDelay: parseInt(document.getElementById('submitDelay').value, 10) || 0,
      charWhitelist: '0123456789',
      numericOnly: true,
      retryOnFail: document.getElementById('retryOnFail').checked,
      maxRetries: parseInt(document.getElementById('maxRetries').value, 10) || 1,
    };
  }

  /** Enable or disable the charWhitelist field based on numericOnly. */
  function syncWhitelistState() {
    numericOnlyCheckbox.checked = true;
    numericOnlyCheckbox.disabled = true;
    charWhitelistInput.disabled = true;
    charWhitelistInput.value = '0123456789';
  }

  // ── Load saved settings ──────────────────────────────────────────────
  browser.storage.local.get(Object.keys(DEFAULTS)).then(function (stored) {
    var merged = Object.assign({}, DEFAULTS, stored);
    populateForm(merged);
  }).catch(function () {
    populateForm(DEFAULTS);
  });

  // ── Events ───────────────────────────────────────────────────────────

  // Numeric-only toggle controls whitelist field
  numericOnlyCheckbox.addEventListener('change', syncWhitelistState);

  // Save
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var values = readForm();

    // Basic validation
    if (!values.siteUrl) {
      showFeedback('網站 URL 匹配模式不可為空', 'error');
      return;
    }
    if (values.submitDelay < 0) {
      showFeedback('提交延遲時間不可為負數', 'error');
      return;
    }
    if (values.maxRetries < 1) {
      showFeedback('最大重試次數至少為 1', 'error');
      return;
    }

    browser.storage.local.set(values).then(function () {
      showFeedback('設定已儲存', 'success');
    }).catch(function (err) {
      showFeedback('儲存失敗: ' + err.message, 'error');
    });
  });

  // Reset
  resetBtn.addEventListener('click', function () {
    populateForm(DEFAULTS);
    browser.storage.local.set(DEFAULTS).then(function () {
      showFeedback('已恢復預設值並儲存', 'success');
    }).catch(function (err) {
      showFeedback('恢復預設值失敗: ' + err.message, 'error');
    });
  });
})();
