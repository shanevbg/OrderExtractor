/**
 * Order Extractor - Background Script | 1.0.93
 */

browser.menus.removeAll().then(() => {
    browser.menus.create({ id: "extract-orders", title: "Extract Orders", contexts: ["message_list"] });
});

browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId === "extract-orders") processMessages();
});

browser.runtime.onMessage.addListener((message) => {
    if (message.action === "open_message") {
        messenger.messageDisplay.open({ messageId: message.id });
    }
    
    if (message.action === "compose_report") {
        messenger.compose.beginNew({
            to: "bionootropics.shipping@gmail.com",
            subject: `Orders for Processing - ${new Date().toLocaleDateString()}`,
            // In Thunderbird MailExtensions, providing HTML in 'body' 
            // automatically triggers HTML mode if 'plainTextBody' is absent.
            body: message.html 
        });
    }
});
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
                data.rawBody = body; 
                extractedData.push(data);
            }
        }
        extractedData.sort((a, b) => b.dateObj - a.dateObj);
        await browser.storage.local.set({ "reportData": extractedData });
        browser.tabs.create({ url: "report.html" });
    } catch (err) { console.error("Extraction Error:", err); }
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

function cleanAddress(lines) {
    return lines.filter(l => {
        const cleanLine = l.trim();
        // Skip empty lines, headers, and domestic country names for Stamps.com compatibility
        if (cleanLine.length < 1 || /Shipping address|Billing address/i.test(cleanLine)) return false;
        if (/^(United States|USA|U\.S\.A\.?)$/i.test(cleanLine)) return false; 
        return true;
    });
}

// Update parseWooCommerce and parseEbay to use this:
// Example: data.addressLines = cleanAddress(addressLines);
function parseMessageContent(rawBody, header) {
    // 1. Aggressively strip ALL levels of quote markers (e.g., > > >)
    let body = rawBody.replace(/^[ \t>]+/gm, ""); 
    
    // 2. Clean encoding
    if (body.includes("=3D") || body.includes("=20")) {
        body = body.replace(/=([a-fA-F0-9]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
    }
    
    // 3. Remove the Google Maps "noise" that breaks eBay addresses
    body = body.replace(/<http:\/\/googleusercontent\.com\/maps\.google\.com\/\d+>/g, "");

    let domain = "bionootropics.com";
    if (header.author.toLowerCase().includes("peptideamino")) domain = "peptideamino.com";

    let data;
    if (/New Order/i.test(body) || /WooCommerce/i.test(body)) {
        data = parseWooCommerce(body);
        data.source = "woo";
        data.domain = domain;
    } else {
        data = parseEbay(body);
        data.source = "ebay";
    }

    data.dateObj = new Date(header.date);
    data.dateStr = formatDate24h(data.dateObj);
    return data;
}

function parseEbay(body) {
    let orderMatch = body.match(/Order:[\s\S]*?([\d-]{10,})/);
    let itemMatch = body.match(/You made the sale for\s+([\s\S]*?)[\r\n]+(?:To|From|Date)/i);
    
    // Capture variations like "Capsule Count", "Size", or "Color"
    let variationMatch = body.match(/(?:Capsule Count|Size|Color|Flavor)\s*[\r\n]+([\s\S]*?)[\r\n]+/i);
    let variationNote = variationMatch ? variationMatch[1].trim() : "";

    let addrMatch = body.match(/Your buyer's shipping details:\s*([\s\S]*?)\s*(?:Ship\s*by:|Sold:|Ship)/i);
    
    let addressLines = [];
    if (addrMatch) {
        addressLines = addrMatch[1]
            .replace(/<[^>]*>/g, " ") 
            .split(/[\r\n]+/)
            .map(l => l.trim())
            .filter(l => l.length > 0 && !/Your buyer's shipping details/i.test(l));
    }
    // NEW: Apply the Stamps.com sanitizer to the results
    let finalAddress = cleanAddress(addressLines); //
    // Combine variation info with other notes
    let finalNotes = [];
    if (variationNote) finalNotes.push(variationNote);
    if (body.includes("VAT Paid")) finalNotes.push("VAT Paid");
    
    return { 
        order: orderMatch ? orderMatch[1].trim() : "Unknown", 
        product: itemMatch ? itemMatch[1].trim() : "Unknown", 
        addressLines: finalAddress, 
        notes: finalNotes.length > 0 ? finalNotes.join(" | ") : "None" 
    };
}
function parseWooCommerce(body) {
    // 1. Clean the 'static' and normalize HTML
    let clean = body.replace(/<http:\/\/googleusercontent\.com\/maps\.google\.com\/\d+>/g, "");
    clean = clean.replace(/<(br|p|tr)[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

    // 2. Extract Order Number
    let orderMatch = clean.match(/(?:Order|#)\s*(\d{4,8})/i);
    
    // 3. NEW: Extract Actual Product Details
    // Look for the text between 'Price' and 'Subtotal'
    let productDetails = "Woo Order";
    let productMatch = clean.match(/Product\s+Quantity\s+Price\s+([\s\S]*?)\s+Subtotal/i);
    if (productMatch) {
        productDetails = productMatch[1].trim().replace(/\s+/g, " ");
    }

    // 4. Extract Address
    let shipMatch = clean.match(/Shipping address\s+([\s\S]*?)(?:\s*Congratulations|Built with WooCommerce|$)/i);
    let addressLines = [];
    if (shipMatch) {
        addressLines = shipMatch[1].split("\n").map(l => l.trim()).filter(l => {
            if (l.length < 1 || /Shipping address|United States/i.test(l)) return false;
            if (/^\d{10,}$/.test(l.replace(/[\s-()]/g, "")) || l.includes("@")) return false;
            return l.length > 2 || /^(Apt|Ste|#|Unit)\s*\d+/i.test(l);
        });
    }
// NEW: Apply the Stamps.com sanitizer to the results
    let finalAddress = cleanAddress(addressLines); //
    return { 
        order: orderMatch ? orderMatch[1] : "Unknown", 
        product: productDetails, // Now contains the actual item name and quantity
        addressLines: finalAddress, 
        notes: "None" 
    };
}

function formatDate24h(dateObj) {
    let pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
}
