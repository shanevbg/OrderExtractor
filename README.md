# Order Extractor Extension

**Target:** Mozilla Thunderbird (Manifest V2)  
**Current Version:** 7.4.1  
**Author:** Shane Vincent / Gemini Assistant

## 📖 Overview
This is a specialized Thunderbird Mail Extension designed to streamline e-commerce fulfillment for multiple storefronts. It intelligently extracts order details from **eBay**, **WooCommerce**, and **Report Emails** (HTML Tables), matches them against a local inventory database, and generates shipping reports.

---

## ✨ Key Features (v7.x)

### 🏪 Multi-Store Management
* **Store Configuration:** Define multiple storefronts (e.g., "eBay", "WooCommerce", "Wholesale") with specific settings.
* **Smart Detection:** Automatically assigns orders to a store based on the **Sender/Forwarder Email** (e.g., emails from `bionootropics@gmail.com` go to the "Bio Nootropics" store).
* **Dynamic Replies:** "Reply to Customer" button pulls the correct email signature/template for the identified store.

### 📦 Inventory System
* **Ledger & History:** Tracks every stock change (shipments, manual edits, restocking) with a timestamped log. View via the **"📊 Stock History"** button.
* **Bulk Tools:** Filter items by keyword and use **"Bulk Move"** to reassign them to a different store instantly.
* **Variants:** Supports complex product variants (e.g., "20 Caps", "60 Caps") per item.

### 🛠 Advanced Parsing
* **Merge & Update:** Extracting orders does *not* wipe the dashboard. It merges new orders into the existing list.
    * **Updates:** If an order exists but details changed, it updates the record and highlights it in **RED**.
* **HTML Table Support:** Capable of parsing "Report" style emails containing tables of multiple orders.
* **Reply Chain Support:** aggressively cleans quoted text and decodes Quoted-Printable encoding to read order details buried in "Re: Re:" chains.

---

## 🚀 Workflow Guide

### 1. Setup
* Click **"🏪 Stores"** in the dashboard toolbar.
* Add your stores. Set the **Sender Email** (who forwards the order to you) as the match key.
* Set your **Reply Signature** for each store.

### 2. Daily Processing
1.  **Extract:** Select order emails in Thunderbird -> Right-click -> **"Extract Orders"**.
2.  **Review:** Open the Dashboard. New/Updated orders appear in the list.
3.  **Link:** If an item is red/unknown, click **"⚠ Link"**.
    * *Match & Learn:* Link it to an existing product. The extension remembers this alias forever.
    * *Create New:* Create a new product. It inherits the Store Name from the order.
4.  **Fulfillment:**
    * Enter Tracking Numbers (or paste them).
    * Click **"↩ Reply"** to send the shipping confirmation (uses Store Signature).
    * Click **"🚫 Cancel"** to cancel an order and optionally **Restock Items**.
5.  **Commit:** Click **"✉ Commit & Email"** to deduct stock, save history, and email the shipping report.

---

## ⚠️ Technical Pitfalls & Fixes

1.  **Content Security Policy (CSP):**
    * *Rule:* `manifest.json` must NOT use `'unsafe-inline'`. All scripts are external.

2.  **Date Filtering:**
    * The parser captures the email date. Use the **"Since: [Date]"** picker in the toolbar to filter old orders out of view without deleting them.

3.  **Google Maps Links:**
    * Gmail forwarding injects hidden `<http...>` links in address blocks. The parser (`cleanAddress` function) aggressively filters these out.

4.  **Version Sanity:**
    * The build script (`MakeXPI.ps1`) enforces strict version synchronization. `manifest.json`, `report.js`, and `report.html` MUST have matching version numbers, or the build will fail.

---

## 🏗 Build Instructions

### Using `MakeXPI.ps1`
This PowerShell script handles verification, cleaning, and packaging.

**Usage:**
```powershell
.\MakeXPI.ps1
