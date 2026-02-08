# Order Extractor Extension

**Target:** Mozilla Thunderbird (Manifest V2)  
**Current Version:** 6.5.2 (Sync with Manifest)  
**Author:** Shane Vincent / Gemini Assistant

## 📖 Overview
This is a specialized Thunderbird Mail Extension designed to streamline e-commerce fulfillment. It extracts order details (Order #, Product, Address) from incoming **eBay** and **WooCommerce** emails, checks them against a local inventory database, and generates shipping reports.

---

## 🛠 Parsing Logic

### eBay Parsing (Robust Multiline)
* **Problem:** Forwarded emails often insert blank lines between labels and values.
* **Solution:** The regex now uses a non-greedy multiline match to hop over empty lines.

### WooCommerce Parsing
* **Address Cleaning:** Aggressively removes Google Maps links (`<http...>`) injected by Gmail forwarding.
* **Contact Info:** Extracts and removes Phone/Email from the address block to prevent formatting issues in Stamps.com.

---

## 📦 Inventory System
The extension maintains a lightweight **Inventory Management System** (IMS) stored in `browser.storage.local`.

* **Negative Stock Alerts:** In the shipping report email, negative stock numbers are highlighted in **RED** and set to **BLINK** (CSS animation) to demand attention.
* **CSV Attachment:** The "Commit & Email" button attaches the full **Inventory CSV** (not the orders list) to facilitate restocking.

---

## ⚠️ Known Pitfalls & Lessons Learned
*Do not repeat these mistakes!*

1.  **Content Security Policy (CSP) Errors:**
    * *Issue:* Using `'unsafe-inline'` in `manifest.json` causes Thunderbird 115+ to block the extension from loading.
    * *Fix:* Ensure CSP is set to `"script-src 'self'; object-src 'self'"`. Do not use inline scripts in HTML files.
2.  **Google Maps Links Break Parsing:**
    * *Issue:* Gmail forwards inject hidden `<http...>` links between address lines.
    * *Fix:* The parser MUST explicitly filter out lines starting with `<http` or containing `googleusercontent.com` before reading the address.

3.  **Empty Lines in Regex:**
    * *Issue:* Forwarding often creates double newlines (`\n\n`) which standard regex treats as a "Stop" signal.
    * *Fix:* Use specific Stop Words (e.g., "Congratulations", "Billing address") instead of relying on empty lines to detect the end of a block.

4.  **CSV Attachments in Compose:**
    * *Issue:* Generating a `File` object in JS and attaching it to `compose.beginNew` sometimes fails to "bridge" to the actual email window in older Thunderbird versions.
    * *Fix:* If attachments fail, use a "Force Download" to local disk as a fallback, or ensure the file type is strictly `text/csv`.

---

## 🚀 Build Instructions

### Using `MakeXPI.ps1`
This PowerShell script handles versioning, cleaning, and packaging.

**Usage:**
```powershell
.\MakeXPI.ps1                  # Auto-detects version from manifest.json
.\MakeXPI.ps1 -Version 6.5.2   # Forces a specific version update
