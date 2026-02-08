# Order Extractor Extension

**Target:** Mozilla Thunderbird (Manifest V2)  
**Current Version:** 1.0.93  
**Author:** Shane Vincent / Gemini Assistant

## 🤖 Context for AI Coding Assistants
This project is a Thunderbird Mail Extension designed to extract e-commerce order details (eBay/WooCommerce) from emails. It uses Regex parsing and saves data to `browser.storage.local`.

---

## 📂 Project Architecture & API Pitfalls

### 1. `compose.beginNew` Logic
**Crucial:** Do not use `isHTML: true` in the `details` object. Thunderbird's API validator will throw an "Unexpected property" error.
* **How to trigger HTML mode:** Simply provide the HTML string to the `body` property and ensure `plainTextBody` is omitted. The API will infer the format.

### 2. Encoding (UTF-8 with BOM)
When using the PowerShell `MakeXPI.ps1` script, ensure `Set-Content` uses `-Encoding utf8BOM`. Without the BOM (Byte Order Mark), Thunderbird may render icons like 💾, 📂, and 📧 as garbled characters (e.g., `â€`).

### 3. Regex & Forwarding
Forwarded emails often prefix lines with `>`. 
* **Safe Clean:** Use `body.replace(/^> ?/gm, "")`. 
* **Warning:** Do not use a broad `replace(/^[\s>]+/gm, "")` as it strips leading indentation, which can break WooCommerce product table parsing.

---

## 🛠 Parsing Logic

1. **WooCommerce:** Detects `New Order` or `bionootropics.com`. Uses `domain` detection to create dynamic links to the correct WP-Admin dashboard.
2. **eBay:** Detects `You made the sale`. Extracts shipping details and handles "VAT Paid" status in notes.

---

## 🚀 Build & Installation

### PowerShell Build (Total Commander / PowerShell)
Use `MakeXPI.ps1` to sync versions across all files and package the `.xpi`.
* **Note:** The script automatically bumps the version number in `manifest.json`, `background.js`, `report.js`, `report.html`, and `README.md`.

### Clean Account Workflow
The "Email Report" feature is designed to bridge the gap between a cluttered "source" email account and a clean "processing" webmail account. Links in the emailed report are absolute `https://` URLs to ensure they work in a standard browser/webmail environment.
