# Firefox Moodle Auto Auth

這是一個 Firefox WebExtension，用來在 NCKU Moodle 登入頁自動辨識並填入圖形驗證碼。擴充功能會在本機使用 Tesseract.js 執行 OCR，不會把驗證碼圖片送到外部服務；帳號與密碼仍由 Firefox 或密碼管理器負責填入。

> 本專案適用於你有權限登入的網站與個人自動化情境。擴充功能不會讀取、儲存或傳送帳號密碼。

## 功能

- 偵測 `moodle.ncku.edu.tw/login/*` 登入頁。
- 尋找驗證碼圖片 `#imgcode` 與輸入欄位 `#reg_vcode`。
- 在 content script 內用 canvas 預處理圖片：放大、灰階、二值化。
- 在 background page 中使用本機 Tesseract.js 檔案執行 OCR。
- Moodle 驗證碼固定以 4 位 `0-9` 數字處理，辨識結果不符合時不會填入提交。
- 將辨識結果填入驗證碼欄位，並觸發 `input` / `change` 事件。
- 可在帳號密碼已填入後自動提交登入表單。
- 提供 popup 顯示狀態、手動辨識、啟用/停用切換。
- 提供 options page 調整 OCR 白名單、僅數字模式、自動提交延遲、重試設定等行為。

## 專案結構

```text
firefox-moodle-auto-auth/
├── manifest.json              # Firefox Manifest V2 設定
├── background/
│   └── background.js          # Tesseract worker 生命週期與 OCR message handler
├── content/
│   └── content.js             # 頁面偵測、圖片預處理、填入與提交
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js               # 擴充功能 popup UI
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js             # 使用 browser.storage.local 的設定頁
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── build/
│   └── build.sh               # 將 Tesseract runtime 檔案複製到 lib/
├── lib/                       # 由 npm run build 產生，不納入 Git
├── package.json
└── README.md
```

## 系統需求

- Firefox
- Node.js and npm
- macOS、Linux，或其他可執行 shell build script 的環境

主要依賴：

- `tesseract.js` for OCR
- `tesseract.js-core` for WASM runtime
- `web-ext` for local development and packaging

## 安裝與建置

安裝 npm dependencies：

```bash
npm install
```

將 Tesseract.js、WASM core、英文訓練資料複製到 `lib/`：

```bash
npm run build
```

`lib/` 是由 `node_modules/` 產生的建置輸出，已在 `.gitignore` 中排除。每次 fresh clone 或重新安裝依賴後，都需要再執行一次 `npm run build`。

## 開發

使用 `web-ext` 啟動 Firefox 並載入擴充功能：

```bash
npm run dev
```

這會從目前專案目錄載入擴充功能，並使用 `moodle-dev` Firefox profile。

也可以手動載入：

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select this project's `manifest.json`.
5. Open `https://moodle.ncku.edu.tw/login/`.

## 打包

產生擴充功能套件：

```bash
npm run package
```

輸出會放在 `dist/`。打包產物已在 `.gitignore` 中排除。

## 使用方式

1. 完成安裝與 `npm run build`。
2. 在 Firefox 載入此擴充功能。
3. 開啟 NCKU Moodle 登入頁。
4. 讓 Firefox 或密碼管理器填入 `username` 和 `password`。
5. 擴充功能會偵測驗證碼、執行 OCR、填入驗證碼欄位；若啟用自動提交，會在帳密已填入後提交表單。

也可以點擊擴充功能 icon，按下 `手動辨識`，對目前頁面重新執行一次辨識。

## 設定項目

從 popup 的 `進階設定` 進入 options page。

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| 網站 URL 匹配模式 | `*://moodle.ncku.edu.tw/login/*` | 儲存預期作用的登入頁 URL pattern。 |
| 自動提交表單 | 啟用 | 辨識完成且帳密已填入後提交登入表單。 |
| 提交延遲時間 | `300` ms | 自動提交前等待的時間。 |
| OCR 字元白名單 | `0123456789` | Moodle 驗證碼固定為 4 碼數字，因此只辨識 `0-9`。 |
| 僅辨識數字 | 啟用且固定 | 只接受 4 位 `0-9`，並套用常見數字誤辨修正。 |
| 辨識失敗時自動重試 | 啟用 | 登入失敗並重新載入頁面後再次嘗試。 |
| 最大重試次數 | `3` | 避免無限重試。 |

注意：目前 `manifest.json` 的 content script match 固定為 `*://moodle.ncku.edu.tw/login/*`。options page 中儲存的 URL pattern 不會自動改變 Firefox manifest 層級的注入範圍。

## 運作流程

1. `content/content.js` 在 Moodle 登入頁執行。
2. content script 等待 `#imgcode` 載入，將圖片畫到 canvas。
3. canvas 影像會被放大、轉灰階、二值化，最後輸出成 PNG data URL。
4. content script 將圖片資料送到 `background/background.js`。
5. background page 使用 `lib/` 內的本機檔案 lazy-init Tesseract worker。
6. OCR 使用 single-line page segmentation 與數字白名單 `0123456789`。
7. 辨識結果經過 trim、移除空白、數字誤辨修正後，只保留並接受 4 位數字。
8. content script 將結果填入 `#reg_vcode`。
9. 若啟用自動提交，content script 會短暫等待 `#username` 與 `#password` 有值，再提交 `#login`。

## .gitignore 原則

此 repository 追蹤原始碼、icons、manifest、build script 與文件。以下內容不納入 Git：

- dependencies，例如 `node_modules/`
- 由 build script 產生的 OCR runtime 檔案，例如 `lib/tesseract/`、`lib/tesseract-core/`、`lib/traineddata/`
- 擴充功能打包產物，例如 `dist/`、`web-ext-artifacts/`、
  `*.xpi`
- 本機環境檔、editor 設定、OS metadata、logs、暫存檔
- 本機 `.claude/` agent configuration

## 疑難排解

如果擴充功能載入時找不到 Tesseract 相關檔案，執行：

```bash
npm run build
```

如果 `npm run build` 顯示 `node_modules not found`，先執行：

```bash
npm install
```

如果 OCR 有執行但結果不穩定，可以嘗試：

- 確認 options page 顯示僅辨識 `0-9`
- 調整設定時先停用自動提交
- 從 popup 使用手動辨識，比較多次辨識結果

如果 popup 顯示目前頁面不是 Moodle 登入頁，確認目前 tab URL 是否符合 `https://moodle.ncku.edu.tw/login/`。

## 隱私與安全

- OCR 在擴充功能內本機執行。
- 驗證碼圖片資料只在 content script 與 extension background page 之間傳遞。
- 擴充功能不會讀取、儲存或傳送帳號密碼。
- 自動提交只檢查帳號與密碼欄位是否已有值，不處理 credential 本身。

## npm Scripts

```bash
npm run build    # 複製 Tesseract runtime assets 到 lib/
npm run dev      # 透過 web-ext 在 Firefox 執行擴充功能
npm run package  # 打包 XPI 到 dist/
```
