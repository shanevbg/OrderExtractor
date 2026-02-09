/**
 * Order Extractor - Background Script
 * Version: 7.5 (HTML Table Parsing)
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

                let storeName = "Manual"; 
                if (header.author) {
                    let sender = header.author.toLowerCase(); 
                    let match = storeConfig.find(s => s.email && sender.includes(s.email.toLowerCase()));
                    if (match) storeName = match.name;
                }

                let result = detectAndParse(cleanBody, html, header.id, storeName, header.date);
                let orders = Array.isArray(result) ? result : (result ? [result] : []);
                
                extractedOrders.push(...orders);

            } catch (innerErr) {
                console.error("Message Error:", innerErr);
            }
        }

        extractedOrders.forEach(newOrder => {
            let existingIndex = currentData.findIndex(o => o.order === newOrder.order);
            
            if (existingIndex > -1) {
                let existing = currentData[existingIndex];
                let oldSig = JSON.stringify({ i: existing.items, a: existing.addressLines });
                let newSig = JSON.stringify({ i: newOrder.items, a: newOrder.addressLines });
                
                if (oldSig !== newSig) {
                    existing.items = newOrder.items;
                    existing.addressLines = newOrder.addressLines;
                    existing.highlight = "updated";
                    existing.note = (existing.note || "") + ` [Updated ${new Date().toLocaleDateString()}]`;
                }
            } else {
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
    // 1. HTML Table Parser (Best for "Report" emails)
    if (html && (html.includes("<table") || html.includes("Order #"))) {
        let tableOrders = parseHtmlTable(html, msgId, storeName, emailDate);
        if (tableOrders.length > 0) return tableOrders;
    }

    // 2. Text Table Parser (Fallback)
    if (text.includes("Order #") && text.includes("Shipping Address")) {
        return parseTextTable(text, html, msgId, storeName, emailDate);
    }
    
    // 3. Standard Parsers
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

function cleanHtmlCell(htmlContent) {
    // Replace <br> with newlines, strip other tags
    let txt = htmlContent.replace(/<br\s*\/?>/gi, "\n");
    txt = txt.replace(/<[^>]+>/g, ""); // Strip tags
    txt = txt.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<");
    return txt.trim();
}

// --- PARSERS ---

// NEW: Robust HTML Table Parser
function parseHtmlTable(html, msgId, storeName, emailDate) {
    let orders = [];
    
    // Find all rows (simple regex approach, assumes standard table structure)
    let rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    
    while ((match = rowRegex.exec(html)) !== null) {
        let rowContent = match[1];
        let cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            cells.push(cellMatch[1]);
        }

        // We need at least 3 columns: ID, Product, Address
        if (cells.length < 3) continue;

        // Clean columns
        let col0 = cleanHtmlCell(cells[0]); // Order ID
        let col1 = cleanHtmlCell(cells[1]); // Product
        let col2 = cleanHtmlCell(cells[2]); // Address

        // Verify it looks like an order row
        if (!col0.match(/\d{2}-\d{5}-\d{5}/) && !col0.match(/Order #/)) continue;
        if (col0.includes("Order #")) continue; // Skip header

        let orderNum = col0;
        let product = col1;
        let rawAddress = col2.split("\n");

        orders.push({
            order: orderNum,
            date: emailDate,
            items: [{ name: product, qty: 1 }],
            addressLines: cleanAddress(rawAddress),
            note: "Extracted from HTML Table",
            sender: storeName === "Manual" ? "eBay" : storeName,
            messageId: msgId,
            orderLink: null
        });
    }
    
    return orders;
}

// Fallback Text Table Parser
function parseTextTable(text, html, msgId, storeName, emailDate) {
    let orders = [];
    let blocks = text.split(/(?=\d{2}-\d{5}-\d{5})/g);
    
    blocks.forEach(block => {
        let orderMatch = block.match(/^(\d{2}-\d{5}-\d{5})/);
        if (!orderMatch) return;
        
        let orderNum = orderMatch[1];
        let lines = block.split("\n").map(l => l.trim()).filter(l => l);
        
        let product = "Unknown Item";
        let rawAddress = [];
        
        if(lines.length > 1) product = lines[1];
        
        let nameIndex = 2; 
        if(lines[2] && lines[2].includes("Capsules")) nameIndex = 3; 
        
        for (let i = nameIndex; i < lines.length; i++) {
            let l = lines[i];
            if (l.match(/\d{4}-\d{2}-\d{2}/)) break;
            if (l.includes("Tracking #")) break;
            rawAddress.push(l);
        }

        orders.push({
            order: orderNum,
            date: emailDate,
            items: [{ name: product, qty: 1 }],
            addressLines: cleanAddress(rawAddress),
            note: "Extracted from Text Table",
            sender: storeName === "Manual" ? "eBay" : storeName,
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
