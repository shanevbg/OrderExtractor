/**
 * Order Extractor - Report Logic
 * Version: 1.0.68 (Safe Mode)
 */

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function copyToClip(encodedAddr, btn) {
    let rawAddr = decodeURIComponent(encodedAddr);
    navigator.clipboard.writeText(rawAddr).then(function() {
        let originalText = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(function() {
            btn.textContent = originalText;
            btn.classList.remove("copied");
        }, 2000);
    }).catch(function(err) { alert("Clipboard failed: " + err); });
}

function deleteRow(btn) {
    let row = btn.closest("tr");
    if (row) row.remove();
}

function parseAddressForCSV(linesRaw) {
    let lines = linesRaw.slice().map(l => l.trim());
    let result = { name: "", address1: "", address2: "", city: "", state: "", zip: "", country: "", phone: "", email: "" };
    if (lines.length === 0) return result;

    // 1. Extract Country (Last line if it's a known country name)
    const countries = /United Kingdom|UK|GBR|Canada|Australia|Puerto Rico|USA|United States/i;
    if (countries.test(lines[lines.length - 1])) {
        result.country = lines.pop();
    } else {
        result.country = "United States";
    }

    // 2. Identify UK Postcode or US Zip
    // Matches: "SW1A 2AA", "B37 9EB", or "62704"
    const pcRegex = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})|(\d{5}(-\d{4})?)/i;
    
    // Look at the new last line (could be city/state/zip or just zip)
    let lastLine = lines[lines.length - 1];
    let pcMatch = lastLine.match(pcRegex);

    if (pcMatch) {
        result.zip = pcMatch[0];
        // If the line has more than just the zip, it's likely "City, State Zip"
        let cityStatePart = lastLine.replace(pcMatch[0], "").trim().replace(/,$/, "");
        if (cityStatePart) {
            let parts = cityStatePart.split(/[\s,]+/);
            result.state = parts.pop();
            result.city = parts.join(" ");
        }
        lines.pop(); // Remove the zip/city line
    }

    // 3. Handle remaining lines (Name, Address, Province)
    if (lines.length > 0) result.name = lines.shift();
    if (lines.length > 0) result.address1 = lines.shift();
    
    // If there is still a line left, it's often the "Province" or "County"
    if (lines.length > 0) {
        result.state = result.state || lines.pop(); // Use as state if not found yet
        result.address2 = lines.join(", ");
    }

    return result;
}

function exportToCSV(data) {
    if (!data || data.length === 0) return;
    let csvContent = "Order ID,Order Date,Full Name,Address 1,Address 2,City,State,Zip Code,Country,Phone,Email,Notes,Item Title\n";
    
    function q(str) { 
        return '"' + String(str || '').replace(/"/g, '""') + '"'; 
    }

    data.forEach(function(item) {
        let addr = parseAddressForCSV(item.addressLines || []);
        let row = [
            q(item.order), q(item.dateStr), q(addr.name), q(addr.address1), q(addr.address2),
            q(addr.city), q(addr.state), q(addr.zip), q(addr.country), q(addr.phone), q(addr.email),
            q(item.notes), q(item.product)
        ];
        csvContent += row.join(",") + "\n";
    });

    let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    let url = URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "stamps_import.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function composeReportEmail(data) {
    let senders = [];
    data.forEach(function(item) {
        if (item.sender && item.sender.includes("@") && senders.indexOf(item.sender) === -1) {
            senders.push(item.sender);
        }
    });

    let targetEmail = senders.length > 0 ? senders[0] : "";
    if (!targetEmail) alert("No sender email found. 'To' field will be empty.");

    let originalTable = document.getElementById("orderTable");
    let emailTable = originalTable.cloneNode(true);

    let headerRow = emailTable.querySelector("thead tr");
    if (headerRow && headerRow.lastElementChild.innerText === "Actions") {
        headerRow.lastElementChild.remove();
    }
    
    let rows = emailTable.querySelectorAll("tbody tr");
    for (let i = 0; i < rows.length; i++) {
        let tr = rows[i];
        if (tr.lastElementChild) tr.lastElementChild.remove();
        
        let addrCell = tr.children[2];
        let copyBtn = addrCell.querySelector(".copy-btn");
        if (copyBtn) copyBtn.remove();

        let nameLink = addrCell.querySelector(".name-link");
        if (nameLink) {
            let name = nameLink.innerText.trim();
            let rowId = nameLink.getAttribute("data-msgid");
            
            let dataItem = null;
            // Manual find because we can't use .find in older ECMA without polyfill sometimes
            for (let d = 0; d < data.length; d++) {
                if (data[d].messageId == rowId) { dataItem = data[d]; break; }
            }
            
            let finalUrl = "#";

            if (dataItem && dataItem.source === "ebay" && dataItem.order !== "Unknown") {
                finalUrl = "https://www.ebay.com/sh/ord/details?orderid=" + dataItem.order;
            } 
            else if (dataItem && dataItem.sender && dataItem.subject) {
                let query = encodeURIComponent("from:" + dataItem.sender + " subject:\"" + dataItem.subject + "\"");
                finalUrl = "https://mail.google.com/mail/u/0/#search/" + query;
            } 
            else {
                finalUrl = "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(name);
            }

            nameLink.href = finalUrl;
            nameLink.style.color = "#1a73e8";
            nameLink.style.textDecoration = "none";
            nameLink.style.fontWeight = "bold";
            nameLink.removeAttribute("class");
            nameLink.removeAttribute("data-msgid");
        }
    }

    emailTable.setAttribute("border", "1");
    emailTable.setAttribute("cellpadding", "5");
    emailTable.style.borderCollapse = "collapse";
    emailTable.style.width = "100%";
    emailTable.style.fontSize = "12px";
    
    let ths = emailTable.querySelectorAll("th");
    for (let j = 0; j < ths.length; j++) {
        ths[j].style.background = "#333";
        ths[j].style.color = "#fff";
        ths[j].style.textAlign = "left";
    }

    let htmlParts = [];
    htmlParts.push('<html><body style="font-family: Arial, sans-serif; color: #000;">');
    htmlParts.push('<h2>Order Summary Report</h2>');
    htmlParts.push('<p>Here is the extracted summary. Click a name to open the order (eBay) or search Gmail.</p><br>');
    htmlParts.push(emailTable.outerHTML);
    htmlParts.push('<br><p>Generated by Order Extractor</p>');
    htmlParts.push('</body></html>');

    browser.runtime.sendMessage({
        action: "compose_report",
        to: targetEmail,
        html: htmlParts.join("")
    });
}

document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("reload-btn").addEventListener("click", function() { location.reload(); });

    browser.storage.local.get("reportData").then(function(storage) {
        let data = storage.reportData;
        let tbody = document.querySelector("tbody");
        tbody.innerHTML = ""; 

        let count = data ? data.length : 0;
        let footer = document.getElementById("footer-ver");
        if(footer) footer.textContent += " - Items Loaded: " + count;

        if (!data || data.length === 0) {
            tbody.innerHTML = "<tr><td colspan='6'>No data found. Please re-run extraction.</td></tr>";
            return;
        }

        document.getElementById("export-btn").addEventListener("click", function() { exportToCSV(data); });
        document.getElementById("email-btn").addEventListener("click", function() { composeReportEmail(data); });

        let orderCounts = {};
        data.forEach(function(item) {
            let num = item.order;
            orderCounts[num] = (orderCounts[num] || 0) + 1;
        });

        data.forEach(function(item) {
            let safeOrder = escapeHtml(item.order);
            let safeProduct = escapeHtml(item.product);
            let safeNotes = escapeHtml(item.notes);
            let safeDate = escapeHtml(item.dateStr); 
            
            let addressDisplayHtml = "";
            if (item.addressLines && item.addressLines.length > 0) {
                let name = escapeHtml(item.addressLines[0]);
                let rest = item.addressLines.slice(1).map(escapeHtml).join("<br>");
                
                if (item.messageId) {
                    addressDisplayHtml = '<a class="name-link" href="#" data-msgid="' + item.messageId + '">' + name + '</a><br>' + rest;
                } else {
                    addressDisplayHtml = name + "<br>" + rest;
                }
            } else {
                addressDisplayHtml = item.address || "";
            }

            let rawAddress = (item.addressLines && Array.isArray(item.addressLines)) ? item.addressLines.join("\n") : "";
            let encodedAddress = encodeURIComponent(rawAddress);

            let orderClass = "";
            if (orderCounts[item.order] > 1) {
                orderClass = "duplicate-order";
            }

            let tr = document.createElement("tr");
            
            // SAFER HTML CONSTRUCTION (No Backticks)
            let html = '';
            html += '<td class="' + orderClass + '">' + safeOrder + '</td>';
            html += '<td>' + safeProduct + '</td>';
            html += '<td><div>' + addressDisplayHtml + '</div></td>';
            html += '<td class="notes-cell">' + safeNotes + '</td>';
            html += '<td>' + safeDate + '</td>';
            html += '<td style="text-align:center;"></td>';
            
            tr.innerHTML = html;

            let btnCopy = document.createElement("button");
            btnCopy.className = "copy-btn";
            btnCopy.textContent = "Copy Address";
            btnCopy.addEventListener("click", function() { copyToClip(encodedAddress, this); });
            tr.children[2].appendChild(btnCopy);

            let btnDel = document.createElement("button");
            btnDel.className = "del-btn";
            btnDel.textContent = "X";
            btnDel.title = "Remove this order";
            btnDel.addEventListener("click", function() { deleteRow(this); });
            tr.children[5].appendChild(btnDel);

            tbody.appendChild(tr);
        });

        // Click Listener
        document.querySelector("tbody").addEventListener("click", function(e) {
            let link = e.target.closest(".name-link");
            if (link) {
                e.preventDefault();
                let msgId = parseInt(link.dataset.msgid);
                if (msgId) {
                    browser.runtime.sendMessage({ action: "open_message", id: msgId });
                }
            }
        });
    });
});
