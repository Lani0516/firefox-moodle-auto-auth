'use strict';

/**
 * Popup controller.
 * Shows page match status, last OCR result, manual trigger, enable/disable toggle.
 */

(function () {
  // ── DOM refs ─────────────────────────────────────────────────────────
  var statusDot = document.getElementById('status-dot');
  var statusText = document.getElementById('status-text');
  var ocrSection = document.getElementById('ocr-section');
  var ocrText = document.getElementById('ocr-text');
  var ocrConfidence = document.getElementById('ocr-confidence');
  var solveBtn = document.getElementById('solve-btn');
  var enabledToggle = document.getElementById('enabled-toggle');
  var optionsLink = document.getElementById('options-link');

  var MOODLE_URL_PATTERN = /^https?:\/\/moodle\.ncku\.edu\.tw\/login\//;

  // ── Page match detection ─────────────────────────────────────────────

  function checkCurrentTab() {
    browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (!tabs || !tabs.length) {
        setPageStatus('no-match', '無法取得分頁資訊');
        return;
      }

      var tab = tabs[0];
      var url = tab.url || '';

      if (MOODLE_URL_PATTERN.test(url)) {
        setPageStatus('match', '已偵測到 Moodle 登入頁面');
        solveBtn.disabled = false;
      } else {
        setPageStatus('no-match', '目前頁面非 Moodle 登入頁');
        solveBtn.disabled = true;
      }
    }).catch(function () {
      setPageStatus('no-match', '無法取得分頁資訊');
    });
  }

  function setPageStatus(type, text) {
    statusDot.className = 'status-dot ' + type;
    statusText.textContent = text;
  }

  // ── Last OCR result (from status messages) ───────────────────────────

  /** Listen for status messages from the content script. */
  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== 'status') return;

    var detail = message.detail;

    switch (message.status) {
      case 'detecting':
        setPageStatus('processing', '偵測到驗證碼圖片');
        break;

      case 'processing':
      case 'ocr':
        setPageStatus('processing', typeof detail === 'string' ? detail : '辨識中...');
        break;

      case 'filled':
        setPageStatus('match', '辨識完成');
        if (detail && typeof detail === 'object') {
          showOcrResult(detail.text, detail.confidence);
        }
        break;

      case 'submitting':
        setPageStatus('processing', '正在提交表單...');
        break;

      case 'waiting':
      case 'waiting_credentials':
        setPageStatus('match', typeof detail === 'string' ? detail : '等待中...');
        break;

      case 'done':
        setPageStatus('match', typeof detail === 'string' ? detail : '完成');
        break;

      case 'error':
        setPageStatus('error', typeof detail === 'string' ? detail : '發生錯誤');
        break;

      case 'max_retries':
        setPageStatus('error', typeof detail === 'string' ? detail : '已達最大重試次數');
        break;

      case 'disabled':
        setPageStatus('no-match', '擴充功能已停用');
        break;
    }
  });

  function showOcrResult(text, confidence) {
    ocrSection.hidden = false;
    ocrText.textContent = text || '—';
    if (typeof confidence === 'number' && !isNaN(confidence)) {
      ocrConfidence.textContent = confidence + '%';
    } else {
      ocrConfidence.textContent = '';
    }
  }

  // ── Manual solve ─────────────────────────────────────────────────────

  solveBtn.addEventListener('click', function () {
    solveBtn.disabled = true;
    solveBtn.textContent = '辨識中...';

    browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (!tabs || !tabs.length) return;
      return browser.tabs.sendMessage(tabs[0].id, { type: 'solveNow' });
    }).then(function () {
      // Re-enable after a short delay to prevent rapid clicking
      setTimeout(function () {
        solveBtn.disabled = false;
        solveBtn.textContent = '手動辨識';
      }, 2000);
    }).catch(function () {
      solveBtn.disabled = false;
      solveBtn.textContent = '手動辨識';
      setPageStatus('error', '無法與頁面通訊，請重新整理頁面');
    });
  });

  // ── Enable/disable toggle ────────────────────────────────────────────

  // Load current state
  browser.storage.local.get('enabled').then(function (result) {
    // Default to true if not set
    enabledToggle.checked = result.enabled !== false;
  }).catch(function () {
    enabledToggle.checked = true;
  });

  enabledToggle.addEventListener('change', function () {
    var enabled = enabledToggle.checked;
    browser.storage.local.set({ enabled: enabled });

    if (!enabled) {
      setPageStatus('no-match', '擴充功能已停用');
      solveBtn.disabled = true;
    } else {
      checkCurrentTab();
    }
  });

  // ── Options link ─────────────────────────────────────────────────────

  optionsLink.addEventListener('click', function (e) {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  // ── Init ─────────────────────────────────────────────────────────────
  checkCurrentTab();
})();
