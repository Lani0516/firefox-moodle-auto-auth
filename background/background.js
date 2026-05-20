'use strict';

// ---------------------------------------------------------------------------
// background.js — OCR engine for Moodle CAPTCHA Auto-Solver
//
// Runs as a persistent MV2 background page. Tesseract global is available
// because tesseract.min.js is loaded before this script in manifest.json.
// ---------------------------------------------------------------------------

const NUMERIC_WHITELIST = '0123456789';
const CAPTCHA_LENGTH = 4;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const OCR_TIMEOUT_MS = 30 * 1000;       // 30 seconds

// Character confusion map applied only in numericOnly mode.
const NUMERIC_CORRECTIONS = new Map([
  ['O', '0'],
  ['o', '0'],
  ['I', '1'],
  ['l', '1'],
  ['S', '5'],
  ['B', '8'],
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let worker = null;
let idleTimer = null;
let settings = {
  charWhitelist: NUMERIC_WHITELIST,
  numericOnly: true,
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get({
      charWhitelist: NUMERIC_WHITELIST,
      numericOnly: true,
    });
    settings.charWhitelist = stored.charWhitelist || NUMERIC_WHITELIST;
    settings.numericOnly = true;
  } catch (err) {
    console.warn('[background] Failed to load settings, using defaults:', err);
  }
}

// React to setting changes made from the options page or popup.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.charWhitelist !== undefined) {
    settings.charWhitelist =
      changes.charWhitelist.newValue || NUMERIC_WHITELIST;
  }
  if (changes.numericOnly !== undefined) {
    settings.numericOnly = true;
  }
});

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

function resetIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(terminateWorker, IDLE_TIMEOUT_MS);
}

async function terminateWorker() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (worker !== null) {
    try {
      await worker.terminate();
    } catch (_) {
      // Worker may already be dead — ignore.
    }
    worker = null;
    console.log('[background] Tesseract worker terminated (idle timeout).');
  }
}

async function getWorker() {
  if (worker !== null) {
    return worker;
  }

  console.log('[background] Initializing Tesseract worker…');

  // OEM 1 = LSTM_ONLY (matches the LSTM-only WASM core shipped in lib/).
  worker = await Tesseract.createWorker('eng', 1, {
    workerPath: browser.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: browser.runtime.getURL('lib/tesseract-core/'),
    langPath: browser.runtime.getURL('lib/traineddata/'),
    cacheMethod: 'none',
    // Suppress noisy Tesseract.js logger in background console.
    logger: () => {},
  });

  console.log('[background] Tesseract worker ready.');
  return worker;
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function postProcess(raw) {
  // 1. Trim leading/trailing whitespace.
  let text = raw.trim();

  // 2. Strip all internal spaces.
  text = text.replace(/\s+/g, '');

  // 3. Apply numeric confusion corrections when numericOnly is enabled.
  if (settings.numericOnly) {
    text = Array.from(text)
      .map((ch) => NUMERIC_CORRECTIONS.get(ch) ?? ch)
      .join('');
    text = text.replace(/\D+/g, '');
  }

  return text;
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

/**
 * Run OCR on an image data URL. Resolves with the Tesseract result or
 * rejects after OCR_TIMEOUT_MS.
 */
async function recognize(imageDataUrl) {
  const w = await getWorker();
  resetIdleTimer();

  // Determine effective whitelist.
  const whitelist = settings.numericOnly
    ? NUMERIC_WHITELIST
    : settings.charWhitelist;

  // Set Tesseract parameters for this recognition pass.
  await w.setParameters({
    tessedit_pageseg_mode: '7',           // PSM SINGLE_LINE
    tessedit_char_whitelist: whitelist,
  });

  // Race recognition against a timeout.
  const result = await Promise.race([
    w.recognize(imageDataUrl),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('OCR timed out after 30 seconds')),
        OCR_TIMEOUT_MS,
      ),
    ),
  ]);

  const text = postProcess(result.data.text);
  const confidence = Math.round(result.data.confidence);

  if (settings.numericOnly && !/^\d{4}$/.test(text)) {
    throw new Error(`OCR result must be ${CAPTCHA_LENGTH} digits, got "${text || '(empty)'}"`);
  }

  return { text, confidence };
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender) => {
  if (message == null || typeof message !== 'object') {
    return undefined;
  }

  // Only accept messages from our own extension pages or matching content scripts.
  if (sender.url && !sender.url.startsWith(browser.runtime.getURL('')) &&
      !/^https?:\/\/moodle\.ncku\.edu\.tw\//.test(sender.url)) {
    return undefined;
  }

  switch (message.type) {
    case 'ocr':
      return handleOcr(message);
    case 'getStatus':
      return handleGetStatus();
    default:
      return undefined;
  }
});

async function handleOcr(message) {
  const { imageDataUrl } = message;
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return { success: false, error: 'Missing or invalid imageDataUrl' };
  }

  try {
    const { text, confidence } = await recognize(imageDataUrl);
    return { success: true, text, confidence };
  } catch (err) {
    console.error('[background] OCR failed:', err);
    // If the worker threw, it may be in a bad state — tear it down so the
    // next request gets a fresh one.
    await terminateWorker();
    return { success: false, error: err.message || String(err) };
  }
}

async function handleGetStatus() {
  return {
    ready: true,
    workerActive: worker !== null,
  };
}

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

loadSettings();
