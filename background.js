/**
 * Order Extractor - Background Script
 * Version: 7.4.1 (Multi-Order Table Parsing)
 */

// --- MENUS ---
browser.menus.removeAll().then(() => {
    browser.menus.create({ id: "extract-orders", title: "Extract Orders", contexts: ["message_list"] });
    browser.menus.create({ id: "add-selection", title: "Add Selection to Orders", contexts: ["selection"] });
});

browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId === "extract-orders") processMessages();
    if (info.menuItemId === "add-selection") addSelectionOrder(info.selectionText);
});

if (browser.browserAction) {
    browser.browserAction.onClicked.addListener(async () => {
        let tabs = await browser.tabs.query({ title: "Fulfillment Dashboard" });
        if (tabs.length > 0) {
            browser.tabs.update(tabs[0].id, { active: true });
            browser.tabs.reload(tabs[0].id);
        } else {
            browser.tabs.create({ url: "report.html" });
        }
    });
}

// --- MESSAGING ---
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "open_message") browser.messageDisplay.open({ messageId: message.id });
    if (message.action === "compose_report") browser.compose.beginNew({ to: message.to, subject: message.subject, body: message.html, isPlainText: false });
    if (message.action === "get_thread") { getThread(message.id).then(sendResponse); return true; }
});

// --- CORE LOGIC ---

async function processMessages() {
    try {
        // 1. LOAD EXISTING DATA (Merge Strategy)
        let storage = await browser.storage.local.get("reportData");
        let currentData = storage.reportData || [];
        
        let storeConfig = [];
        let configStorage = await browser.storage.local.get("storeConfig");
        if (configStorage.storeConfig) storeConfig = configStorage.storeConfig;

        let messageList = await browser.mailTabs.getSelectedMessages();
        if (!messageList.messages?.length) return;

        let extractedOrders = [];
        
        for (let header of messageList.messages) {
            try {
                let fullPart = await browser.messages.getFull(header.id);
                let { text, html } = extractBodyParts(fullPart);
                
                let parseBody = text || html || ""; 
                let cleanBody = sanitizeBody(parseBody);

                // Determine Store by Sender
                let storeName = "Manual"; 
                if (header.author) {
                    let sender = header.author.toLowerCase(); 
                    let match = storeConfig.find(s => s.email && sender.includes(s.email.toLowerCase()));
                    if (match) storeName = match.name;
                }

                // Parse (Can return Object OR Array)
                let result = detectAndParse(cleanBody, html || text, header.id, storeName, header.date);
                
                // Normalize to array
                let orders = Array.isArray(result) ? result : (result ? [result] : []);
                
                extractedOrders.push(...orders);

            } catch (innerErr) {
                console.error("Message Error:", innerErr);
            }
        }

        // --- MERGE LOGIC ---
        extractedOrders.forEach(newOrder => {
            let existingIndex = currentData.findIndex(o => o.order === newOrder.order);
            
            if (existingIndex > -1) {
                // Update existing
                let existing = currentData[existingIndex];
                
                // Detect Changes (Simple serialization check)
                let oldSig = JSON.stringify({ i: existing.items, a: existing.addressLines });
                let newSig = JSON.stringify({ i: newOrder.items, a: newOrder.addressLines });
                
                if (oldSig !== newSig) {
                    existing.items = newOrder.items;
                    existing.addressLines = newOrder.addressLines;
                    existing.highlight = "updated"; // Visual Flag
                    existing.note = (existing.note || "") + ` [Updated ${new Date().toLocaleDateString()}]`;
                }
            } else {
                // Add New
                currentData.push(newOrder);
            }
        });

        await browser.storage.local.set({ "reportData": currentData });
        
        let tabs = await browser.tabs.query({ title: "Fulfillment Dashboard" });
        if (tabs.length > 0) {
            browser.tabs.update(tabs[0].id, { active: true });
            browser.tabs.reload(tabs[0].id);
        } else {
            browser.tabs.create({ url: "report.html" });
        }

    } catch (err) {
        console.error("Extraction Error:", err);
    }
}

async function addSelectionOrder(text) {
    let storage = await browser.storage.local.get("reportData");
    let currentData = storage.reportData || [];
    let cleanText = sanitizeBody(text);
    
    let data = {
        order: "Manual-" + Date.now(),
        date: new Date().toISOString(),
        items: [{ name: "Check Selection", qty: 1 }],
        addressLines: cleanAddress(cleanText.split("\n")),
        note: "Added via text selection",
        sender: "Manual",
        messageId: null,
        orderLink: null
    };

    currentData.push(data);
    await browser.storage.local.set({ "reportData": currentData });
    
    let tabs = await browser.tabs.query({ title: "Fulfillment Dashboard" });
    if (tabs.length > 0) {
        browser.tabs.update(tabs[0].id, { active: true });
        browser.tabs.reload(tabs[0].id);
    } else {
        browser.tabs.create({ url: "report.html" });
    }
}

async function getThread(messageId) {
    try {
        if (!messageId) return [];
        let originalMsg = await browser.messages.get(messageId);
        if (!originalMsg || !originalMsg.threadId) return originalMsg ? [formatMsg(originalMsg)] : [];
        let threadMessages = await browser.messages.query({ threadId: originalMsg.threadId });
        return threadMessages.sort((a, b) => b.date - a.date).map(formatMsg);
    } catch (e) {
        return [];
    }
}

function formatMsg(m) {
    return {
        id: m.id,
        subject: m.subject,
        author: m.author,
        recipients: m.recipients,
        date: m.date,
        folder: m.folder ? m.folder.name : ""
    };
}

// --- UTILS ---

function decodeQuotedPrintable(text) {
    return text
        .replace(/=\r?\n/g, "") 
        .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractBodyParts(part) {
    let text = "";
    let html = "";
    if (part.body) {
        if (part.contentType && part.contentType.includes("text/html")) html += part.body;
        else text += part.body;
    }
    if (part.parts) {
        part.parts.forEach(p => {
            let res = extractBodyParts(p);
            text += res.text;
            html += res.html;
        });
    }
    return { text, html };
}

function sanitizeBody(text) {
    if (text.includes("=3D") || text.includes("=E2")) {
        text = decodeQuotedPrintable(text);
    }
    return text
        .replace(/^>+ ?/gm, "") 
        .replace(/<http[\s\S]+?>/g, "")
        .replace(/\[image:[^\]]+\]/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\t/g, " ");
}

function detectAndParse(text, html, msgId, storeName, emailDate) {
    // 1. Table Dump Parser (Priority for "Re:" emails with tables)
    if (text.includes("Order #") && text.includes("Shipping Address")) {
        return parseTable(text, html, msgId, storeName, emailDate);
    }
    
    // 2. Standard Parsers
    if (text.includes("You made the sale") || text.includes("eBay")) return parseEbay(text, html, msgId, storeName, emailDate);
    else if (text.includes("New Order") || text.includes("bionootropics.com")) return parseWooCommerce(text, html, msgId, storeName, emailDate);
    
    return null;
}

function cleanAddress(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.map(l => l.trim()).filter(l => {
        if (l.length < 2) return false;
        const lower = l.toLowerCase();
        if (lower === "united states" || lower === "usa" || lower === "us" || lower.includes("shipping details") || lower.includes("shipping address") || lower.includes("ship by:")) return false;
        if (/^[\d-\s()+]{10,}$/.test(l)) return false; 
        if (l.includes("@")) return false; 
        if (l.includes("entry=3D") || l.includes("source=3D") || l.includes("ce=3D") || l.startsWith("http")) return false;
        return true;
    });
}

// --- PARSERS ---

// NEW: Handles "Report" style tables in replies
function parseTable(text, html, msgId, storeName, emailDate) {
    let orders = [];
    
    // Split by common separators or Order IDs
    // Look for patterns like "26-14177-87835" (eBay)
    let blocks = text.split(/(?=\d{2}-\d{5}-\d{5})/g);
    
    blocks.forEach(block => {
        let orderMatch = block.match(/^(\d{2}-\d{5}-\d{5})/);
        if (!orderMatch) return;
        
        let orderNum = orderMatch[1];
        let lines = block.split("\n").map(l => l.trim()).filter(l => l);
        
        // Strategy: Line 0 is ID. Line 1 is usually Product. Following lines are Address.
        // We look for address markers (City, State Zip)
        
        let product = "Unknown Item";
        let rawAddress = [];
        
        // Heuristic: Product is usually the 2nd line in these reports
        if(lines.length > 1) product = lines[1];
        
        // Find Address: Look for the name (usually line 2 or 3) down to Zip
        // In the sample: ID, Product, Name, Street, City...
        let nameIndex = 2; // Default guess
        
        // refine name index (skip product lines)
        if(lines[2] && lines[2].includes("Capsules")) nameIndex = 3; 
        
        // Capture address lines until we hit a Date or "United States"
        for (let i = nameIndex; i < lines.length; i++) {
            let l = lines[i];
            if (l.match(/\d{4}-\d{2}-\d{2}/)) break; // Stop at date
            if (l.includes("Tracking #")) break;
            rawAddress.push(l);
        }

        orders.push({
            order: orderNum,
            date: emailDate,
            items: [{ name: product, qty: 1 }],
            addressLines: cleanAddress(rawAddress),
            note: "Extracted from Reply Table",
            sender: storeName === "Manual" ? "eBay" : storeName, // Default to eBay for these IDs
            messageId: msgId,
            orderLink: null
        });
    });
    
    return orders;
}

function parseEbay(text, html, msgId, storeName, emailDate) {
    let orderNum = "Unknown";
    let product = "Unknown Item";
    let rawAddress = [];
    let orderLink = null;

    let orderMatch = text.match(/Order:[\s\S]*?([\d-]{10,})/i);
    if (orderMatch) orderNum = orderMatch[1];

    let peptideMatch = text.match(/Peptide(?:\s*\n+)+([^\n]+)/i);
    if (peptideMatch) {
        let p = peptideMatch[1].trim();
        if (p && !p.includes(":")) product = p;
    } 
    if (product === "Unknown Item") {
        let titleMatch = text.match(/sale\s+for\s+([^\n]+?)(?=\s+–|\s+-|\n|$)/i);
        if (titleMatch) product = titleMatch[1].trim();
    }

    let variantMatch = text.match(/Capsule Count[\s\S]*?(\d+\s*Caps)/i);
    if (variantMatch) {
        product += " " + variantMatch[1].trim(); 
    }

    let addrBlockMatch = text.match(/shipping details:([\s\S]*?)Ship by:/i);
    if (addrBlockMatch) rawAddress = addrBlockMatch[1].split("\n");

    if (html) {
        let linkMatch = html.match(/(https:\/\/www\.ebay\.com\/mesh\/ord\/details\?[^"'\s>]+)/);
        if (linkMatch) orderLink = linkMatch[1].replace(/&/g, "&"); 
    }

    if (storeName === "Manual") storeName = "eBay";

    return { 
        order: orderNum, 
        date: emailDate, 
        items: [{ name: product, qty: 1 }], 
        addressLines: cleanAddress(rawAddress), 
        note: text.includes("VAT Paid") ? "VAT Paid" : "", 
        sender: storeName, 
        messageId: msgId, 
        orderLink: orderLink 
    };
}

function parseWooCommerce(text, html, msgId, storeName, emailDate) {
    let orderMatch = text.match(/Order\s+(?:#)?(\d+)/i);
    let orderNum = orderMatch ? orderMatch[1] : "Woo";

    let items = [];
    let tableMatch = text.match(/Product\s+Quantity\s+Price\s*([\s\S]*?)\s*Subtotal:/i);
    
    if (tableMatch && tableMatch[1]) {
        let lines = tableMatch[1].trim().split("\n");
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            let lineMatch = line.match(/^(.+)\s+(\d+)\s+[\$£€]?[\d\.,]+$/);
            if (lineMatch) {
                items.push({ name: lineMatch[1].trim(), qty: parseInt(lineMatch[2]) || 1 });
            } else {
                items.push({ name: line, qty: 1 });
            }
        });
    }
    
    if (items.length === 0) items.push({ name: "Woo Order (Check Details)", qty: 1 });

    let rawAddress = [];
    let email = "";
    let phone = "";

    let shipMatch = text.match(/Shipping address[\s\S]*?([\s\S]*?)(?=Congratulations|Built with WooCommerce|Billing address)/i);
    
    if (shipMatch) {
        let rawBlock = shipMatch[1];
        let emailMatch = rawBlock.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) {
            email = emailMatch[0];
            rawBlock = rawBlock.replace(email, ""); 
        } else {
            let globalEmail = text.match(/[\w.-]+@[\w.-]+\.\w+/);
            if(globalEmail) email = globalEmail[0];
        }
        let phoneMatch = rawBlock.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (phoneMatch) {
            phone = phoneMatch[0];
            rawBlock = rawBlock.replace(phone, "");
        }
        let lines = rawBlock.split("\n");
        rawAddress = lines.filter(line => {
            let l = line.trim();
            if (!l) return false;
            if (l.startsWith("<http") || l.includes("http://googleusercontent.com")) return false;
            if (l.includes("entry=3D") || l.includes("source=3D")) return false; 
            return true;
        });
    }

    let noteMatch = text.match(/Note:\s*([\s\S]*?)(?=\n\n|Billing address|Shipping address)/i);
    let note = noteMatch ? noteMatch[1].trim().replace(/\n/g, " ") : "";

    let orderLink = null;
    if (html) {
        let adminMatch = html.match(/(https:\/\/[^"'\s>]+\/wp-admin\/post\.php\?post=(?:3D)?\d+&action=(?:3D)?edit)/);
        if (adminMatch) orderLink = adminMatch[1].replace(/=3D/g, "").replace(/&/g, "&");
    }

    if (storeName === "Manual") storeName = "WooCommerce";

    return { 
        order: orderNum,
        date: emailDate, 
        items: items, 
        addressLines: cleanAddress(rawAddress), 
        email: email, 
        phone: phone, 
        note: note,
        sender: storeName, 
        messageId: msgId, 
        orderLink: orderLink 
    };
}
