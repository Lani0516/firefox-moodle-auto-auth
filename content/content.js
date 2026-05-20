'use strict';

/**
 * Content script for Moodle CAPTCHA Auto-Solver.
 * Injected at document_idle on *://moodle.ncku.edu.tw/login/*
 *
 * Responsibilities:
 *   1. Detect CAPTCHA image (#imgcode)
 *   2. Preprocess image (upscale, grayscale, binarize)
 *   3. Send to background for OCR
 *   4. Fill CAPTCHA input and optionally auto-submit
 *   5. Retry on failure (tracked via sessionStorage)
 */

(function () {
  const RETRY_STORAGE_KEY = 'moodle_captcha_retry_count';
  const POLL_INTERVAL_MS = 100;
  const POLL_TIMEOUT_MS = 3000;

  const DEFAULTS = {
    autoSubmit: true,
    submitDelay: 300,
    retryOnFail: true,
    maxRetries: 3,
    enabled: true,
  };

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Send a status message to the popup. Silently catches errors because
   * the popup may not be open.
   */
  function sendStatus(status, detail) {
    try {
      browser.runtime.sendMessage({
        type: 'status',
        status,
        detail: detail || null,
        timestamp: Date.now(),
      });
    } catch (_) {
      // popup closed — ignore
    }
  }

  /**
   * Load user settings from storage, merged with defaults.
   */
  async function loadSettings() {
    try {
      const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
      return { ...DEFAULTS, ...stored };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  /**
   * Wait until the given image element is fully loaded.
   * Resolves immediately if already complete; otherwise waits for `load`.
   * Rejects after 10 s.
   */
  function waitForImageLoad(img) {
    return new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) {
        return resolve();
      }
      const timeout = setTimeout(() => reject(new Error('Image load timeout')), 10000);
      img.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      img.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Image load error')); }, { once: true });
    });
  }

  /**
   * Preprocess the CAPTCHA image on a canvas:
   *   1. 2x upscale
   *   2. Grayscale (luminosity formula)
   *   3. Binary threshold at 128
   * Returns a PNG data-URL string.
   */
  function preprocessImage(img) {
    const scale = 2;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Cannot get canvas 2d context');
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const bw = gray > 128 ? 255 : 0;
      data[i] = bw;
      data[i + 1] = bw;
      data[i + 2] = bw;
      // alpha stays unchanged
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /**
   * Set a form field's value and dispatch input + change events so that
   * any framework listeners pick up the change.
   */
  function setFieldValue(el, value) {
    // Use the native setter in case a framework has overridden the property
    const nativeSet = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    ).set;
    nativeSet.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Poll until both #username and #password have values (autofill timing),
   * or until we time out.
   */
  function waitForCredentials() {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const user = document.getElementById('username');
        const pass = document.getElementById('password');
        if (user && pass && user.value && pass.value) {
          return resolve(true);
        }
        if (Date.now() - start >= POLL_TIMEOUT_MS) {
          return resolve(false);
        }
        setTimeout(check, POLL_INTERVAL_MS);
      };
      check();
    });
  }

  // ── Retry tracking via sessionStorage ──────────────────────────────────

  function getRetryCount() {
    return parseInt(sessionStorage.getItem(RETRY_STORAGE_KEY) || '0', 10);
  }

  function incrementRetry() {
    sessionStorage.setItem(RETRY_STORAGE_KEY, String(getRetryCount() + 1));
  }

  function resetRetries() {
    sessionStorage.removeItem(RETRY_STORAGE_KEY);
  }

  // ── Main solve logic ────────────────────────────────────────────────────

  let submitting = false;

  async function solveCaptcha() {
    const settings = await loadSettings();

    if (!settings.enabled) {
      sendStatus('disabled', '擴充功能已停用');
      return;
    }

    const imgCode = document.getElementById('imgcode');
    if (!imgCode) {
      return;
    }

    sendStatus('detecting', '偵測到驗證碼圖片');

    const retryCount = getRetryCount();
    if (settings.retryOnFail && retryCount >= settings.maxRetries) {
      sendStatus('max_retries', `已達最大重試次數 (${settings.maxRetries})`);
      resetRetries();
      return;
    }

    try {
      await waitForImageLoad(imgCode);
      sendStatus('processing', '正在預處理圖片...');

      const imageDataUrl = preprocessImage(imgCode);

      sendStatus('ocr', '正在辨識驗證碼...');
      const response = await browser.runtime.sendMessage({
        type: 'ocr',
        imageDataUrl,
      });

      if (!response || !response.success) {
        throw new Error(response ? response.error : 'No response from background');
      }

      const ocrText = response.text || '';
      const confidence = response.confidence || 0;

      sendStatus('filled', {
        text: ocrText,
        confidence,
        message: `辨識結果: ${ocrText} (${confidence}%)`,
      });

      const vcodeInput = document.getElementById('reg_vcode');
      if (!vcodeInput) {
        throw new Error('CAPTCHA input #reg_vcode not found');
      }
      setFieldValue(vcodeInput, ocrText);

      if (settings.autoSubmit) {
        sendStatus('waiting_credentials', '等待帳號密碼填入...');
        const credentialsReady = await waitForCredentials();

        if (credentialsReady && !submitting) {
          submitting = true;

          if (settings.retryOnFail) {
            incrementRetry();
          }

          await new Promise((r) => setTimeout(r, settings.submitDelay));
          sendStatus('submitting', '正在提交表單...');

          const form = document.getElementById('login');
          if (form) {
            form.submit();
          }
        } else {
          sendStatus('waiting', '帳號或密碼尚未填入，等待手動提交');
        }
      } else {
        sendStatus('done', '驗證碼已填入，請手動提交');
      }
    } catch (err) {
      sendStatus('error', `錯誤: ${err.message}`);
      console.error('[Moodle CAPTCHA Solver] Error:', err);
    }
  }

  // ── Listen for manual trigger from popup (registered once) ─────────────
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'solveNow') {
      resetRetries();
      solveCaptcha();
    }
  });

  // ── Run on load ────────────────────────────────────────────────────────
  solveCaptcha();
})();
