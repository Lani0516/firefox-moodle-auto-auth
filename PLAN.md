# Firefox Moodle CAPTCHA Auto-Solver - Implementation Plan

## Context

Build Firefox WebExtension that auto-solves simple text image CAPTCHAs on NCKU Moodle (`moodle.ncku.edu.tw`) login page using local OCR (Tesseract.js). Plugin only handles CAPTCHA recognition + form submit — browser autofill handles username/password.

## NCKU Moodle Login Page DOM (Verified)

```html
<form id="login" action="https://moodle.ncku.edu.tw/login/index.php" method="post">
  <input type="hidden" name="anchor" id="anchor" value="">
  <input type="hidden" name="logintoken" value="...">
  <input type="text" name="username" id="username" class="form-control">
  <input type="password" name="password" id="password" class="form-control">

  <div class="login-form-recaptcha form-group">
    <label for="reg_vcode">圖形驗證碼</label>
    <input type="text" name="vcode" class="reg_vcode" id="reg_vcode" value="">
    <img id="imgcode" src="https://moodle.ncku.edu.tw/lib/imgcode.php?t=TIMESTAMP" onclick="refresh_code()">
  </div>

  <input type="checkbox" name="rememberusername" id="rememberusername" value="1">
  <button type="submit" class="btn btn-primary btn-block mt-3" id="loginbtn">登入</button>
</form>
```

**Key selectors** (exact, verified from live page):
- CAPTCHA image: `#imgcode` (src pattern: `/lib/imgcode.php?t=`)
- CAPTCHA input: `#reg_vcode` (name: `vcode`)
- Form: `#login`
- Submit: `#loginbtn`
- Username: `#username`
- Password: `#password`

## Architecture

**Manifest V2** — Firefox fully supports it, persistent background pages simplify Tesseract.js WASM worker lifecycle (no service worker timeout issues with MV3).

## File Structure

```
firefox-moodle-auto-auth/
├── manifest.json                  # MV2 manifest, CSP with wasm-unsafe-eval
├── content/
│   └── content.js                 # Content script: detect, extract, fill, submit
├── background/
│   └── background.js              # Background: Tesseract.js OCR engine
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── popup/
│   ├── popup.html                 # Status + manual trigger
│   ├── popup.js
│   └── popup.css
├── lib/
│   ├── tesseract/                 # tesseract.min.js + worker.min.js
│   ├── tesseract-core/            # WASM (LSTM + SIMD-LSTM only)
│   └── traineddata/               # eng.traineddata.gz
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── build/
│   └── build.sh                   # Copy deps from node_modules → lib/
└── package.json                   # tesseract.js + web-ext devDeps
```

## Data Flow

```
Page Load → content.js at document_idle
  → Match URL: *://moodle.ncku.edu.tw/login/*
  → Find #imgcode element
  → Wait for image load
  → Preprocess: 2x upscale + grayscale + binary threshold (canvas)
  → Send imageDataUrl to background.js via runtime.sendMessage
  → background.js: lazy-init Tesseract.js worker (extension-local WASM + traineddata)
  → OCR: PSM SINGLE_LINE, char whitelist
  → Post-process: trim, strip spaces, common confusions
  → Return result → content.js
  → Set #reg_vcode.value + dispatch input/change events
  → If autoSubmit && #username.value && #password.value → #login.submit()
```

## Key Components

### 1. `manifest.json`

- MV2
- `content_security_policy`: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`
- Content script matches: `*://moodle.ncku.edu.tw/login/*` (configurable via options)
- Background scripts: `["lib/tesseract/tesseract.min.js", "background/background.js"]`
- Permissions: `storage`, `activeTab`
- `web_accessible_resources`: `lib/` contents (for WASM worker)

### 2. `content/content.js` — Detection + Image Processing + Filling

- Find `#imgcode`, wait for `.complete` or `onload`
- Image preprocessing on canvas:
  - 2x upscale (better OCR on small images)
  - Grayscale conversion
  - Binary threshold (pixel > 128 → white, else black)
  - Export as PNG data URL
- Send to background, receive OCR text
- Set `#reg_vcode.value`, dispatch `input`/`change` events
- Auto-submit: check `#username.value` + `#password.value` exist, then `document.getElementById('login').submit()`
- Retry: if page reloads with CAPTCHA again (login failed), re-run (up to maxRetries)

### 3. `background/background.js` — OCR Engine

- Lazy-init Tesseract.js worker on first message
- Config:
  - `workerPath`: `browser.runtime.getURL('lib/tesseract/worker.min.js')`
  - `corePath`: `browser.runtime.getURL('lib/tesseract-core/')`
  - `langPath`: `browser.runtime.getURL('lib/traineddata/')`
  - `cacheMethod`: `'none'` (files are local)
- Parameters: `tessedit_pageseg_mode: '7'` (SINGLE_LINE), `tessedit_char_whitelist` from settings
- Post-processing: trim, strip whitespace, optional char correction map
- Auto-terminate worker after 5min idle
- 30s timeout on OCR

### 4. Options Page

| Setting | Default | Purpose |
|---------|---------|---------|
| siteUrl | `*://moodle.ncku.edu.tw/login/*` | URL match pattern |
| autoSubmit | `true` | Auto-submit after fill |
| submitDelay | `300` ms | Wait before submit |
| charWhitelist | `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789` | OCR char restriction |
| numericOnly | `false` | Digits-only mode |
| retryOnFail | `true` | Retry on wrong CAPTCHA |
| maxRetries | `3` | Max retries |

### 5. Popup

- Current page status (match / no match)
- Last OCR result + confidence
- Manual "Solve Now" button
- Enable/disable toggle
- Link to options

## Build Process

No webpack/bundler. Simple shell script:

1. `npm install` → tesseract.js + tesseract.js-core + web-ext
2. `bash build/build.sh` → copy JS/WASM/traineddata to `lib/`
3. `npx web-ext run` → dev test in Firefox
4. `npx web-ext build -a dist/` → package .xpi

Ship 2 WASM variants only (LSTM + SIMD-LSTM) to save ~7MB.

## Implementation Order

1. **Scaffold**: manifest.json, package.json, build/build.sh, placeholder icons
2. **Background OCR**: Tesseract.js worker init + message handler + post-processing
3. **Content script**: detection + image extraction + preprocessing + fill + submit
4. **Options page**: settings UI with defaults
5. **Popup**: status display + manual trigger
6. **Test & tune**: load in Firefox, test against moodle.ncku.edu.tw

## Verification

1. `npm run build` → lib/ populated with all required files
2. `npx web-ext run` → extension loads without errors
3. Navigate to `moodle.ncku.edu.tw/login/index.php`
4. Verify: CAPTCHA image detected → OCR runs → result fills #reg_vcode
5. Enter username/password → verify auto-submit triggers
6. Wrong CAPTCHA → verify retry with new CAPTCHA image
7. Options page → change settings, verify effect
8. Popup → status correct, manual solve works
9. Test on other Moodle instances by changing siteUrl

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OCR accuracy on distorted text | 2x upscale + binarize preprocessing; tunable char whitelist; retry on fail |
| Extension size (~15-20MB) | Within AMO 200MB limit; ship only 2 WASM variants |
| Browser autofill timing | Poll #username/#password values for up to 3s before auto-submit |
| CAPTCHA image same-origin | Image is same origin (moodle.ncku.edu.tw), canvas won't be tainted |
| `imgcode.php` returns different format | Preprocessing normalizes; fallback: fetch blob directly |
