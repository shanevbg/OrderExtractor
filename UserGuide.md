User Guide for **Order Extractor** extension

---

# 📦 Order Extractor Extension | User Guide

**Version:** 7.5.0

**Target:** Mozilla Thunderbird

## 📖 Overview

The **Order Extractor** is a powerful tool designed to streamline your e-commerce fulfillment. It turns messy email notifications from **eBay**, **WooCommerce**, and **Sales Reports** into a clean, organized dashboard where you can manage inventory, print invoices, and send shipping confirmations with a single click.

---

## 🚀 Getting Started: The Daily Workflow

### 1. 📨 Extract Orders

Don't waste time copy-pasting.

1. Open **Thunderbird**.
2. Select one or more order emails (eBay "You made a sale", WooCommerce "New Order", or Daily Reports).
3. **Right-Click** the selected messages.
4. Choose **"Extract Orders"**.
* *Note:* The dashboard will open (or reload) automatically with the new data merged in.



### 2. 📋 Review the Dashboard

The dashboard displays all active orders.

* **🔴 Red Rows:** Orders that have been **updated** since you last saw them (e.g., customer changed address).
* **⚪ Normal Rows:** Standard active orders.
* **❌ Strikethrough:** Cancelled orders.

### 3. ⚠ Resolve Unknown Items

If the system sees a product it doesn't recognize (e.g., "New Flavor 50g"), it will show a **⚠ Link** button. Click it to open the **Resolver Tool**:

| Action | Icon | Description |
| --- | --- | --- |
| **Link & Learn** | 🔗 | **Permanent Fix.** Teaches the system that "Item A" is actually "Inventory Item B". It will remember this forever. |
| **Substitute** | 🔀 | **One-Time Swap.** Use this if you are out of stock and sending a replacement *just for this order*. Logs a note but **does not** save a permanent rule. |
| **Create New** | ➕ | Creates a brand new inventory item from this product. |

### 4. 🚚 Fulfill & Ship

1. **Tracking:** Paste the tracking number into the input box.
2. **Reply:** Click the **↩ button** next to the tracking number.
* *Magic:* This generates a pre-written email to the customer with the tracking link, pulled from your **Store Signature**.


3. **Commit:** When finished with a batch, click **"✉ Commit & Email"**.
* Deducts stock from inventory.
* Saves the changes to history.
* Emails you a Shipping Report CSV.



---

## 🏪 Features in Detail

### 🏢 Multi-Store Management

Manage multiple businesses (e.g., "Bio Nootropics", "Peptide Amino") from one place.

* **Setup:** Click the **"🏪 Stores"** button in the toolbar.
* **Auto-Detection:** The system detects which store an order belongs to by looking at the **Sender Email** (who forwarded it to you).
* *Example:* If `bmntherapy@gmail.com` forwards an email, it auto-tags as "Peptide Amino".


* **Signatures:** Set a custom email signature for each store. The "Reply" button automatically picks the right one!

### 📦 Inventory Management

Click **"Inventory"** to toggle the management panel.

* **⚡ Bulk Move:** Filter items by name (e.g., "Peptide") and use the "Bulk Action" bar to move them all to a specific Store instantly.
* **♻ Convert Stock:** Click the recycle icon to split or combine variants (e.g., turn 1x "60 count" bottle into 3x "20 count" bottles).
* **📊 Stock History:** Click this button to view a timestamped ledger of every stock change, shipment, and manual edit.

### 🚫 Handling Cancellations

If an order needs to be cancelled:

1. Click the **"🚫 Cancel"** button on the order row.
2. The system will ask: *"Do you want to restock items?"*
3. **Yes:** Items are added back to inventory automatically.
4. **No:** Order is marked cancelled, but stock is untouched.

---

## 🛠 Dashboard Controls

| Filter / Button | Function |
| --- | --- |
| **🔍 Search** | Filter orders by Customer Name, Order ID, or Product. |
| **📅 Date Picker** | Show only orders received *after* this date (great for hiding old history). |
| **Hide Shipped** | Check this to hide orders that already have a tracking number entered. |
| **Partials** | Show only orders marked as "Partial" shipment. |
| **⬇ Inventory CSV** | Download a full backup of your inventory. |
| **🐞 Debug** | Shows raw data for troubleshooting. |

---

## 💡 Pro Tips

* **Address Cleaning:** The extension automatically strips out those annoying `<http://google...>` links that Gmail inserts into forwarded addresses.
* **Colors Matter:**
* <span style="color:red">**Red Stock:**</span> You are oversold (negative quantity).
* <span style="color:orange">**Orange Stock:**</span> Low stock (less than 5).
* <span style="color:green">**Green Stock:**</span> Plenty of stock.


* **Manual Orders:** You can manually add an order (e.g., phone order) using the **"+ Add Manual Order"** button at the bottom of the list.