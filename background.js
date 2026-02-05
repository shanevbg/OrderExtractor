/**
 * Order Extractor - Background Script
 * Version: 1.0.57
 */

browser.menus.removeAll().then(() => {
    browser.menus.create({
        id: "extract-orders",
        title: "Extract Orders",
        contexts: ["message_list"]
    });
    browser.menus.create({
        id: "add-selection",
        title: "Add Selection to Order Report",
        contexts: ["selection"]
    });
});

browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "extract-orders") {
        processMessages();
    } else if (info.menuItemId === "add-selection") {
        processSelection(info.selectionText);
    }
});

browser.runtime.onMessage.addListener((message) => {
    if (message.action === "compose_report") {
        openComposeWindow(message.to, message.html);
    } 
    else if (message.action === "open_message") {
        openMessageInTab(message.id);
    }
});

async function openMessageInTab(messageId) {
    try {
        if (messageId) {
            await browser.messageDisplay.open({ messageId: messageId });
        }
    } catch (err) {
        console.error("Open Message Error:", err);
    }
}

async function openComposeWindow(recipient, htmlContent) {
    try {
        await browser.compose.beginNew({
            to: recipient,
            subject: "Order Summary Report",
            body: htmlContent,
            isPlainText: false
        });
    } catch (err) {
        console.error("Compose Error:", err);
    }
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
    } catch (err) {
        console.error("Tab Management Error:", err);
    }
}

async function processSelection(text) {
    try {
        console.log("Processing manual selection...");
        let data = parseDirectFormat(text, "Manual Entry");
        data.dateObj = new Date(); 
        data.dateStr = formatDate24h(data.dateObj);
        data.subject = "Manual Entry"; 
        data.source = "manual"; 
        
        let storage = await browser.storage.local.get("reportData");
        let currentData = storage.reportData || [];
        currentData.push(data);
        await browser.storage.local.set({ "reportData": currentData });
        
        await openOrReloadReportTab();

    } catch (err) {
        console.error("Manual Selection Error:", err);
    }
}

async function processMessages() {
  try {
    await browser.storage.local.clear();
    console.log("Storage cleared. Starting extraction...");

    let messageList = await browser.mailTabs.getSelectedMessages();
    if (!messageList.messages || messageList.messages.length === 0) {
        console.warn("No messages selected.");
        return;
    }

    let extractedData = [];

    for (let messageHeader of messageList.messages) {
      try {
        let bodyText = await getBodyText(messageHeader.id);
        if (!bodyText) continue;

        let data = parseMessageContent(bodyText, messageHeader);
        
        if (data.product !== "Unknown" || data.order !== "Unknown") {
            data.messageId = messageHeader.id;
            extractedData.push(data);
        }
      } catch (err) {
        console.error(`Error processing msg ${messageHeader.id}:`, err);
      }
    }

    extractedData.sort((a, b) => b.dateObj - a.dateObj);
    await browser.storage.local.set({ "reportData": extractedData });
    console.log(`Saved ${extractedData.length} items to storage.`);
    
    await openOrReloadReportTab();

  } catch (error) {
    console.error("Critical error:", error);
  }
}

async function getBodyText(messageId) {
    let part = await browser.messages.getFull(messageId);
    function findPart(part, type) {
        if (part.contentType && part.contentType.toLowerCase().includes(type) && part.body) return part.body;
        if (part.parts) for (let sub of part.parts) { let f = findPart(sub, type); if(f) return f; }
        return null;
    }
    return findPart(part, "text/plain") || findPart(part, "text/html") || ""; 
}

function formatDate24h(dateObj) {
    if (isNaN(dateObj.getTime())) return "Unknown";
    let year = dateObj.getFullYear();
    let month = String(dateObj.getMonth() + 1).padStart(2, '0');
    let day = String(dateObj.getDate()).padStart(2, '0');
    let hours = String(dateObj.getHours()).padStart(2, '0');
    let minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function decodeQuotedPrintable(text) {
    return text.replace(/=([a-fA-F0-9]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
}

function cleanSenderEmail(authorString) {
    let match = authorString.match(/<([^>]+)>/);
    if (match) return match[1];
    return authorString.trim();
}

function parseMessageContent(rawBody, header) {
    let body = rawBody;
    if (body.includes("=3D") || body.includes("=20")) body = decodeQuotedPrintable(body);
    body = body.replace(/^>+\s*/gm, ""); 
    
    let cleanSubject = header.subject ? header.subject.trim() : "";
    let senderEmail = header.author ? cleanSenderEmail(header.author) : "";

    let data;

    if (/^\d{2}-\d{5}-\d{5}$/.test(cleanSubject)) {
        data = parseDirectFormat(body, cleanSubject);
        data.source = "manual";
    } 
    else if (/New Order:? #\d+/i.test(body) || /bionootropics\.com/i.test(body) || /\[Order #\d+\]/i.test(body) || cleanSubject.includes("New order")) {
        data = parseWooCommerce(body, rawBody);
        data.source = "woo";
    } 
    else {
        data = parseEbay(body);
        data.source = "ebay";
    }

    data.sender = senderEmail;
    data.subject = cleanSubject;

    if (data.dateStr === "Unknown" || isNaN(data.dateObj.getTime())) {
        if (header.date) {
            data.dateObj = new Date(header.date);
            data.dateStr = formatDate24h(data.dateObj);
        }
    }
    if ((data.product === "Unknown" || data.product === "") && header.subject) {
        let subjMatch = header.subject.match(/(?:sale for|order|item)\s+(.*)/i);
        if (!/^\d{2}-\d{5}-\d{5}$/.test(cleanSubject)) {
            data.product = subjMatch ? cleanProduct(subjMatch[1]) : header.subject;
        }
    }
    return data;
}

function parseDirectFormat(body, subject) {
    let lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    let product = "Unknown";
    let addressLines = [];
    let splitIndex = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
        let line = lines[i];
        if (/^(\+|00)?[1-9][0-9 \-\(\)\.]{6,}$/.test(line)) { splitIndex = i; break; }
        if (/United States|Canada|UK|Australia|Puerto Rico/i.test(line)) { splitIndex = i; break; }
    }

    if (splitIndex !== -1 && splitIndex < lines.length - 1) {
        addressLines = lines.slice(0, splitIndex + 1);
        let productLines = lines.slice(splitIndex + 1);
        product = productLines.join(" + ");
    } else {
        if (lines.length > 0) {
            product = lines.pop();
            addressLines = lines;
        }
    }

    return { order: subject, product: product, address: addressLines.join("<br>"), addressLines: addressLines, notes: "None", dateStr: "Unknown", dateObj: new Date(0) };
}

function cleanProduct(name) {
    if (!name) return "";
    name = name.replace("Khavinson Bioregulato...", "").trim();
    if (name.endsWith("|")) name = name.slice(0, -1).trim();
    if (name.endsWith("-")) name = name.slice(0, -1).trim();
    name = name.replace(/^(?:Fwd|Re):\s*/i, "").trim();
    return name;
}

function parseEbay(body) {
    let subjectProduct = "Unknown";
    let subjectMatch = body.match(/Subject:\s*(?:(?:Re|Fwd):\s*)*You(?: have)? made the sale for\s+([\s\S]*?)[\r\n]+(?:To|From|Date|Content-Type|MIME-Version):/i);
    if (subjectMatch) subjectProduct = subjectMatch[1].replace(/[\r\n]+/g, " ").trim();
    
    let bodyProduct = "";
    let soldIndex = body.search(/Sold:/i);
    if (soldIndex !== -1) {
        let context = body.substring(Math.max(0, soldIndex - 1000), soldIndex); 
        let lines = context.split(/\r?\n/);
        lines = lines.map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("<") && !l.startsWith("[") && !l.toLowerCase().includes("http"));
        if (lines.length > 0) bodyProduct = lines[lines.length - 1].replace(/^>+\s*/, "");
    }

    let finalProduct = cleanProduct(subjectProduct);
    if (bodyProduct) {
        let cleanBodyProd = cleanProduct(bodyProduct);
        if (!finalProduct || finalProduct === "Unknown") finalProduct = cleanBodyProd;
        else if (cleanBodyProd.length > finalProduct.length && !cleanBodyProd.endsWith("...")) finalProduct = cleanBodyProd;
    }

    let addressHtml = "Unknown";
    let addressLines = [];
    let addressMatch = body.match(/Your buyer's shipping details:\s*([\s\S]*?)\s*Ship by:/);
    if (addressMatch) {
        let lines = addressMatch[1].replace(/<[^>]*>/g, " ").replace(/[\r\n]+/g, "|").split("|");
        lines = lines.filter(line => {
            let clean = line.trim().replace(/^>+\s*/, "");
            return clean.length > 0 && clean !== "United States" && /[a-z0-9]/i.test(clean);
        });
        addressLines = lines.map(l => l.trim().replace(/^>+\s*/, ""));
        addressHtml = addressLines.join("<br>");
    }

    let orderMatch = body.match(/Order:[\s\S]*?([\d-]{10,})/);
    let orderNumber = orderMatch ? orderMatch[1].trim() : "Unknown";

    let notesList = [];
    if (body.includes("Variations")) {
        let varMatch = body.match(/Variations\s*([\s\S]*?)\s*Buyer:/);
        if (varMatch) notesList.push(`Variation: ${varMatch[1].trim()}`);
    }
    let capsuleMatch = body.match(/Capsule Count\s*[\r\n]+(.+)/i);
    if (capsuleMatch && capsuleMatch[1].length < 50) notesList.push(`Capsule Count: ${capsuleMatch[1].trim()}`);
    if (body.includes("VAT Paid") || body.includes("IOS ID")) {
        let vatMatch = body.match(/(?:VAT Paid|IOS ID)[\s\S]*?((?:GB|IM|AU|NZ|EU|IOS\s*ID)?\s*[\d\s]{5,})/i);
        if (vatMatch) notesList.push(`VAT Paid: ${vatMatch[1].replace(/IOS\s*ID/i, "").trim()}`);
    }
    let noteMatch = body.match(/(?:Buyer note|Note to seller):\s*(.*?)(?:\r\n|\n)/i);
    if (noteMatch) notesList.push(noteMatch[1].trim());

    let dateMatches = [...body.matchAll(/Date:\s*(.*?(?:AM|PM))/g)];
    let emailDateStr = (dateMatches.length > 0) ? dateMatches[0][1] : "Unknown";
    let dateObj = new Date(emailDateStr);
    
    return { order: orderNumber, product: finalProduct, address: addressHtml, addressLines: addressLines, notes: notesList.join("; ") || "None", dateStr: formatDate24h(dateObj), dateObj: dateObj };
}

function parseWooCommerce(body, rawBody) {
    let cleanBody = rawBody.replace(/<(br|p|tr)[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;/g, "$").replace(/[\r\n]+/g, "\n").replace(/[ \t]+/g, " ");

    let orderMatch = cleanBody.match(/(?:New Order:|Order)\s*#?(\d+)/i);
    let orderNumber = orderMatch ? orderMatch[1] : "Unknown";

    let product = "Unknown";
    let productsList = [];

    let headerMatch = cleanBody.match(/Product\s+Quantity\s+Price/i);
    if (headerMatch) {
        let remaining = cleanBody.substring(headerMatch.index + headerMatch[0].length);
        let lines = remaining.split("\n").map(l => l.trim()).filter(l => l.length > 0);

        for (let line of lines) {
            if (/^Subtotal:/i.test(line)) break;
            if (/^Shipping:/i.test(line)) break;
            if (/^Payment method:/i.test(line)) break;

            let match = line.match(/^(.*?)\s+(\d+)\s+\$/);
            if (match) {
                let name = match[1].trim();
                let qty = parseInt(match[2]);
                if (qty > 1) {
                    name = `${name} (x${qty})`;
                }
                productsList.push(name);
            }
        }
    }
    
    if (productsList.length > 0) {
        product = productsList.join(" + ");
    }

    let addressHtml = "Unknown";
    let addressLines = [];
    let shipMatch = cleanBody.match(/Shipping address\s*([\s\S]*?)Congratulations/i);
    if (shipMatch) {
        let lines = shipMatch[1].split("\n").map(l => l.trim()).filter(l => l.length > 0 && l !== "United States");
        addressLines = [...new Set(lines)];
        addressHtml = addressLines.join("<br>");
    }

    let notesList = [];
    let noteMatch = cleanBody.match(/Note:\s*(.*?)(?:\n|$)/i);
    if (noteMatch) notesList.push(noteMatch[1].trim());

    let dateObj = new Date(0);
    let timeTagMatch = rawBody.match(/<time[^>]*datetime="([^"]+)"/i);
    if (timeTagMatch) {
        dateObj = new Date(timeTagMatch[1]);
    } else {
        let textDateMatch = cleanBody.match(/\((\d{1,2}\s+[A-Za-z]+\s+\d{4})\)/);
        if (textDateMatch) dateObj = new Date(textDateMatch[1]);
    }

    return { order: orderNumber, product: product, address: addressHtml, addressLines: addressLines, notes: notesList.join("; ") || "None", dateStr: formatDate24h(dateObj), dateObj: dateObj };
}