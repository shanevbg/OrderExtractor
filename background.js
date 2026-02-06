/**
 * Order Extractor - Background Script
 * Version: 1.0.68
 */

// --- 1. INITIALIZATION & LISTENERS ---
browser.menus.removeAll().then(() => {
    browser.menus.create({ id: "extract-orders", title: "Extract Orders", contexts: ["message_list"] });
    browser.menus.create({ id: "add-selection", title: "Add Selection to Order Report", contexts: ["selection"] });
});

browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId === "extract-orders") processMessages();
    else if (info.menuItemId === "add-selection") processSelection(info.selectionText);
});

browser.runtime.onMessage.addListener((message) => {
    if (message.action === "compose_report") openComposeWindow(message.to, message.html);
    else if (message.action === "open_message") openMessageInTab(message.id);
});

// --- 2. UI & TAB MANAGEMENT ---
async function openMessageInTab(messageId) {
    try {
        if (messageId) await messenger.messageDisplay.open({ messageId: messageId });
    } catch (err) { console.error("Open Message Error:", err); }
}

async function openComposeWindow(recipient, htmlContent) {
    try {
        await browser.compose.beginNew({
            to: recipient,
            subject: "Order Summary Report",
            body: htmlContent,
            isPlainText: false
        });
    } catch (err) { console.error("Compose Error:", err); }
}

async function openOrReloadReportTab() {
    try {
        let tabs = await browser.tabs.query({});
        let reportTab = tabs.find(t => t.url && t.url.includes("report.html"));
        if (reportTab) {
            await browser.tabs.reload(reportTab.id);
            await browser.tabs.update(reportTab.id, { active: true });
        } else {
            await browser.tabs.create({ url: "report.html" });
        }
    } catch (err) { console.error("Tab Error:", err); }
}

// --- 3. EXTRACTION ENGINES ---
async function processMessages() {
    try {
        await browser.storage.local.clear();
        let messageList = await browser.mailTabs.getSelectedMessages();
        if (!messageList.messages?.length) return;

        let extractedData = [];
        for (let header of messageList.messages) {
            let body = await getBodyText(header.id);
            if (!body) continue;

            let data = parseMessageContent(body, header);
            if (data.product !== "Unknown" || data.order !== "Unknown") {
                data.messageId = header.id;
                extractedData.push(data);
            }
        }
        extractedData.sort((a, b) => b.dateObj - a.dateObj);
        await browser.storage.local.set({ "reportData": extractedData });
        await openOrReloadReportTab();
    } catch (err) { console.error("Extraction Error:", err); }
}

async function processSelection(text) {
    try {
        let data = parseDirectFormat(text, "Manual Entry");
        data.dateObj = new Date(); 
        data.dateStr = formatDate24h(data.dateObj);
        data.source = "manual"; 
        
        let storage = await browser.storage.local.get("reportData");
        let currentData = storage.reportData || [];
        currentData.push(data);
        await browser.storage.local.set({ "reportData": currentData });
        await openOrReloadReportTab();
    } catch (err) { console.error("Selection Error:", err); }
}

async function getBodyText(messageId) {
    let part = await browser.messages.getFull(messageId);
    function findPart(p, type) {
        if (p.contentType?.toLowerCase().includes(type) && p.body) return p.body;
        if (p.parts) for (let sub of p.parts) { let f = findPart(sub, type); if(f) return f; }
        return null;
    }
    return findPart(part, "text/plain") || findPart(part, "text/html") || ""; 
}

// --- 4. THE PARSING BRAIN ---

function parseMessageContent(rawBody, header) {
    let body = rawBody;
    if (body.includes("=3D") || body.includes("=20")) {
        body = body.replace(/=([a-fA-F0-9]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
    }
    body = body.replace(/^>+\s*/gm, ""); 
    
    let cleanSubject = header.subject ? header.subject.trim() : "";
    let data;

    if (/^\d{2}-\d{5}-\d{5}$/.test(cleanSubject)) {
        data = parseDirectFormat(body, cleanSubject);
        data.source = "manual";
    } else if (/New Order/i.test(body) || /bionootropics\.com/i.test(body) || cleanSubject.includes("New order")) {
        data = parseWooCommerce(body, rawBody);
        data.source = "woo";
    } else {
        data = parseEbay(body);
        data.source = "ebay";
    }

    data.subject = cleanSubject;
    data.sender = header.author ? header.author.replace(/.*<(.+)>$/, "$1") : "";
    data.dateObj = new Date(header.date);
    data.dateStr = formatDate24h(data.dateObj);
    return data;
}

function parseEbay(body) {
    // 1. Order ID
    let orderMatch = body.match(/Order:[\s\S]*?([\d-]{10,})/);
    let orderNumber = orderMatch ? orderMatch[1].trim() : "Unknown";

    // 2. High-Accuracy Product Extraction
    let product = "Unknown";
    let itemMatch = body.match(/You made the sale for\s+([\s\S]*?)[\r\n]+(?:To|From|Date|Subject)/i);
    if (!itemMatch) {
        itemMatch = body.match(/Sold:\s*([\s\S]*?)[\r\n]+Item price:/i);
    }
    if (itemMatch) product = itemMatch[1].replace(/[\r\n]+/g, " ").trim();

    // 3. Deep Notes Extraction (Variations, VAT, Buyer Notes)
    let notesList = [];
    
    // Check for Variations (e.g., Size, Color, Count)
    let varMatch = body.match(/Variations:\s*([\s\S]*?)\s*Buyer:/i);
    if (varMatch) notesList.push(`Var: ${varMatch[1].trim()}`);

    // Check for Buyer Note
    let buyerNote = body.match(/(?:Buyer note|Note to seller):\s*(.*?)(?:\r\n|\n)/i);
    if (buyerNote) notesList.push(`Note: ${buyerNote[1].trim()}`);

    // Check for VAT/Tax ID (Important for International)
    if (body.includes("VAT Paid") || body.includes("IOSS")) {
        let vatMatch = body.match(/(?:VAT Paid|IOSS|IOS ID)[\s\S]*?([A-Z0-9\s]{5,})/i);
        if (vatMatch) notesList.push(`TAX: ${vatMatch[1].trim()}`);
    }

    // 4. Address Logic
    let addressLines = [];
    let addrMatch = body.match(/Your buyer's shipping details:\s*([\s\S]*?)\s*Ship by:/);
    if (addrMatch) {
        addressLines = addrMatch[1].replace(/<[^>]*>/g, " ").split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith(">"));
    }

    return { 
        order: orderNumber, 
        product: product, 
        addressLines: addressLines, 
        notes: notesList.join(" | ") || "None" 
    };
}

function parseWooCommerce(body, rawBody) {
    // 1. Clean the body to handle HTML-to-text conversion issues
    let cleanBody = rawBody.replace(/<(br|p|tr)[^>]*>/gi, "\n")
                           .replace(/<[^>]*>/g, " ")
                           .replace(/&nbsp;/g, " ")
                           .replace(/[\r\n]+/g, "\n")
                           .replace(/[ \t]+/g, " ");

    // 2. Extract Order Number
    let orderMatch = cleanBody.match(/(?:New Order:|Order)\s*#?(\d+)/i);
    let orderNumber = orderMatch ? orderMatch[1] : "Unknown";

    // 3. Extract Products (Looks for the Product/Quantity/Price table)
    let productsList = [];
    let headerMatch = cleanBody.match(/Product\s+Quantity\s+Price/i);
    
    if (headerMatch) {
        let remaining = cleanBody.substring(headerMatch.index + headerMatch[0].length);
        let lines = remaining.split("\n").map(l => l.trim()).filter(l => l.length > 0);

        for (let line of lines) {
            // Stop parsing if we hit the totals section
            if (/Subtotal:|Shipping:|Payment method:/i.test(line)) break;

            // Regex for: [Product Name] [Quantity] $[Price]
            let match = line.match(/^(.*?)\s+(\d+)\s+\$/);
            if (match) {
                let name = match[1].trim();
                let qty = parseInt(match[2]);
                productsList.push(qty > 1 ? `${name} (x${qty})` : name);
            }
        }
    }
    
    // 4. Extract Shipping Address (Specifically for Woo format)
    let addressLines = [];
    let shipMatch = cleanBody.match(/Shipping address\s*([\s\S]*?)Congratulations/i) || 
                    cleanBody.match(/Shipping address\s*([\s\S]*?)Customer details/i);
    if (shipMatch) {
        addressLines = shipMatch[1].split("\n")
                                   .map(l => l.trim())
                                   .filter(l => l.length > 0 && !/United States|Congratulations/i.test(l));
        addressLines = [...new Set(addressLines)]; // Remove duplicates
    }

    // 5. Extract Notes
    let notesList = [];
    let noteMatch = cleanBody.match(/Note:\s*(.*?)(?:\n|$)/i);
    if (noteMatch) notesList.push(noteMatch[1].trim());

    return { 
        order: orderNumber, 
        product: productsList.join(" + ") || "Woo Order - Manual Check", 
        addressLines: addressLines, 
        notes: notesList.join(" | ") || "None" 
    };
}

function parseDirectFormat(body, subject) {
    let lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    let splitIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/United Kingdom|UK|Canada|Australia|Puerto Rico|USA|United States/i.test(lines[i])) { splitIndex = i; break; }
        if (/^(\+|00)?[1-9][0-9 \-\(\)\.]{6,}$/.test(lines[i])) { splitIndex = i; break; }
    }
    let addressLines = splitIndex !== -1 ? lines.slice(0, splitIndex + 1) : lines;
    let product = splitIndex !== -1 ? lines.slice(splitIndex + 1).join(" + ") : "Unknown";
    return { order: subject, product: product, addressLines: addressLines, notes: "Manual Entry" };
}

function formatDate24h(dateObj) {
    if (isNaN(dateObj.getTime())) return "Unknown";
    let pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
}
