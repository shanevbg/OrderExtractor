# Order Extractor Extension

**Target:** Mozilla Thunderbird (Manifest V2)
**Current Version:** 1.0.56
**Author:** Shane Vincent / Gemini Assistant

## 🤖 Context for AI Coding Assistants
This project is a Thunderbird Mail Extension designed to extract e-commerce order details (eBay/WooCommerce) from emails and generate a shipping report. It relies heavily on Regex parsing of email bodies.

**Crucial Constraints:**
1.  **Manifest V2:** Thunderbird still uses V2. Do not update to V3 syntax (e.g., keep `browser.browserAction` or `browser.menus`, do not use `chrome.scripting`).
2.  **Content Security Policy (CSP):** No inline JavaScript allowed in HTML. All logic must remain in `report.js` and be attached via event listeners in `DOMContentLoaded`.
3.  **Installation:** We use the **Proxy File** method or a specific PowerShell build script to avoid "unsigned extension" removal on restart.

---

## 📂 Project Architecture

### 1. `manifest.json`
* **Permissions:** `messagesRead`, `storage`, `clipboardWrite`, `tabs`, `menus`, `compose`, `messageDisplay`.
* **ID:** `order-extractor@shane` (Changed from legacy IDs to avoid Windows .com executable conflicts).

### 2. `background.js` ( The Controller)
* **Entry Points:**
    * **Context Menu (Message List):** Triggers `extract-orders`. Clears storage, parses selected messages, saves to `local.storage`, opens/reloads report tab.
    * **Context Menu (Selection):** Triggers `add-selection`. Parses highlighted text as a "Manual Entry", **appends** to existing storage (does not clear), and reloads the report.
* **Key Functions:**
    * `parseMessageContent()`: Router that detects email type (Direct/Woo/Ebay) and calls specific parsers.
    * `stripReplyHistory()`: *Disabled in v1.0.49+* (Caused data loss). currently we rely on specific Regex anchors.
    * `openOrReloadReportTab()`: Checks `browser.tabs.query` to avoid opening duplicate report tabs.
    * `openMessageInTab(id)`: Handles the `open_message` runtime request to jump to a specific email ID.

### 3. `report.html` & `report.js` (The View)
* **Rendering:** Loads data from `browser.storage.local`.
* **Smart Links (Hybrid Behavior):**
    * **In Report Tab:** Name links use `dataset.msgid`. Clicking triggers `browser.runtime.sendMessage({action: "open_message"})` to jump to the email inside Thunderbird.
    * **In Exported Email:** Name links are rewritten to **Gmail Search URLs** (`https://mail.google.com... search/from:x subject:y`). This ensures links work on Mobile/Gmail App.
* **Actions:**
    * **Copy Address:** Copies formatted address to clipboard.
    * **Delete Row:** Removes the row from the DOM (visual only) before generating the email report.
    * **Email Report:** Clones the current table DOM, strips buttons/actions, converts links to Gmail Search format, and opens a new Compose window with the table as HTML body. Target recipient is auto-detected from the first order's sender.
    * **Export CSV:** Formats data for Stamps.com import.

---

## 🛠 Parsing Logic (Regex)

The extension handles three main formats. If adding new support, stick to these patterns:

1.  **Direct Format (Manual/Plain Text):**
    * Identifies blocks ending in a Phone Number, Country, or Zip Code.
    * Everything above = Address. Everything below = Product.
2.  **WooCommerce:**
    * Looks for `New Order #...`.
    * Parses HTML tables for products.
3.  **eBay:**
    * Looks for `You made the sale for...`.
    * Extracts "Shipping details" block and "Ship by" date.

---

## 🚀 Installation & Development

### Method A: Proxy File (Recommended for Dev)
To prevent Thunderbird from deleting the extension on restart:
1.  Create a file named `order-extractor@shane` (no extension) in your Profile's `extensions` folder.
2.  Paste the full path to this source directory inside that file.

### Method B: PowerShell Build (For Distribution)
Use the included `MakeXPI.ps1` script via Total Commander or PowerShell.
* **Command:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "MakeXPI.ps1" "%P%N"`
* **Why:** Ensures `manifest.json` is at the root of the .xpi (zip), not inside a subfolder.

---

## 📝 Change Log (Recent)

* **v1.0.56:** Fixed brittle click listeners in `report.js`. Moved Gmail link generation logic strictly to the "Email Report" function to keep the desktop view clean.
* **v1.0.55:** Added `openOrReloadReportTab` to prevent tab spam.
* **v1.0.54:** Added `subject` capture to `background.js` to enable "Smart Search" links on mobile.
* **v1.0.53:** Added "Delete Row" button and auto-recipient detection for email reports.
* **v1.0.50:** Added "Add Selection to Order Report" for manual text parsing.