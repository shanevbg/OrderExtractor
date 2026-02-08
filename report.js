/**
 * Order Extractor - Fulfillment Logic
 * Version: 7.4.0 (Merge & History)
 */

// Default Stores
const DEFAULT_STORES = [
    { name: "Bio Nootropics", email: "bionootropics@gmail.com", signature: "Thank you,\nBio Nootropics Team" },
    { name: "Peptide Amino", email: "bmntherapy@gmail.com", signature: "Best regards,\nPeptide Amino Support" }
];

const DEFAULT_INVENTORY = [
    { 
        id: "A-1", 
        store: "Bio Nootropics",
        name: "Superfort (pancreas)", 
        note: "Sample", 
        variants: [{ name: "20", count: 10 }, { name: "60s", count: 5 }],
        keywords: ["a-1", "superfort", "pancreas", "sample", "20", "60s"],
        aliases: {} 
    }
];

let globalInventory = [];
let globalOrders = [];
let globalStores = []; 
let stockHistory = []; 

// Filter States
let filterSearch = "";
let filterPartialOnly = false;
let filterShipped = true; // DEFAULT: HIDE SHIPPED
let filterInvOOS = false;
let filterInvNeg = false;
let filterStore = "ALL"; 
let filterDate = ""; // Date string YYYY-MM-DD

// --- UTILITIES ---

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    let btn = document.getElementById("theme-btn");
    if(btn) btn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
    });
}

function getTrackingLink(number) {
    let n = number.replace(/\s+/g, '').toUpperCase();
    if (n.startsWith("1Z")) return { name: "UPS", url: `https://www.ups.com/track?tracknum=${n}` };
    if (/^\d{10}$/.test(n)) return { name: "DHL", url: `https://www.dhl.com/en/express/tracking.html?AWB=${n}&brand=DHL` };
    if (/^\d{12}$/.test(n) || /^\d{14}$/.test(n)) return { name: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${n}` };
    return { name: "USPS", url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` };
}

// --- STORE MANAGEMENT ---

function loadStoreConfig() {
    return browser.storage.local.get("storeConfig").then(res => {
        if (res.storeConfig && res.storeConfig.length > 0) {
            globalStores = res.storeConfig;
        } else {
            globalStores = DEFAULT_STORES;
            browser.storage.local.set({ "storeConfig": globalStores });
        }
        renderStoreConfig();
        populateStoreFilter();
    });
}

function renderStoreConfig() {
    let container = document.getElementById("store-list-container");
    if (!container) return; 
    
    container.innerHTML = "";
    
    globalStores.forEach((store, index) => {
        let div = document.createElement("div");
        div.className = "store-row";
        div.innerHTML = `
            <div class="store-field">
                <label>Store Name</label>
                <input type="text" class="cfg-name" value="${escapeHtml(store.name)}">
            </div>
            <div class="store-field">
                <label>Sender/Forwarder Email</label>
                <input type="text" class="cfg-email" value="${escapeHtml(store.email)}" placeholder="e.g. forwarded-from@gmail.com">
            </div>
            <div class="store-field" style="flex-basis: 100%;">
                <label>Reply Signature</label>
                <textarea class="cfg-sig" rows="2">${escapeHtml(store.signature || "")}</textarea>
            </div>
            <button class="del-store-btn" data-idx="${index}" style="background:var(--danger); color:white; border:none; border-radius:4px;">Delete</button>
        `;
        container.appendChild(div);
    });

    document.querySelectorAll(".del-store-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            globalStores.splice(this.dataset.idx, 1);
            renderStoreConfig();
        });
    });
}

function saveStoreConfig() {
    let rows = document.querySelectorAll(".store-row");
    let newStores = [];
    
    rows.forEach(row => {
        let name = row.querySelector(".cfg-name").value.trim();
        let email = row.querySelector(".cfg-email").value.trim();
        let sig = row.querySelector(".cfg-sig").value;
        if(name) newStores.push({ name, email, signature: sig });
    });
    
    globalStores = newStores;
    browser.storage.local.set({ "storeConfig": globalStores }).then(() => {
        alert("Store Settings Saved!");
        populateStoreFilter();
        renderInventoryPanel();
        document.getElementById("store-config-panel").style.display = "none";
    });
}

function getStoreSignature(storeName) {
    let store = globalStores.find(s => s.name === storeName);
    return store ? store.signature : "Thank you for your order!";
}

// --- HTML HELPERS ---

async function getOriginalHtml(messageId) {
    try {
        let rootPart = await browser.messages.getFull(messageId);
        const traverse = (part) => {
            if (part.body && part.contentType && part.contentType.includes("text/html")) return part.body;
            if (part.parts) { for (let p of part.parts) { let found = traverse(p); if (found) return found; } }
            return null;
        };
        let html = traverse(rootPart);
        if (html) return html;
        const traverseText = (part) => {
            if (part.body && part.contentType && part.contentType.includes("text/plain")) return part.body;
            if (part.parts) { for (let p of part.parts) { let f = traverseText(p); if(f) return f; } }
            return null;
        };
        let txt = traverseText(rootPart);
        return txt ? `<pre style="font-family:sans-serif; white-space:pre-wrap;">${txt}</pre>` : "(No content found)";
    } catch (e) { return "(Error loading original message)"; }
}

function generateInventoryHTML(forEmail = false) {
    let html = [];
    html.push('<table border="1" cellpadding="5" style="border-collapse:collapse; width:100%; font-family:Arial, sans-serif; font-size:12px;">');
    html.push('<tr style="background:#eee;"><th>Code</th><th>Product</th><th>Stock</th></tr>');
    
    globalInventory.forEach(item => {
        let stockList = item.variants.map(v => {
            let isNeg = v.count < 0;
            let isLow = v.count < 5;
            let color = isNeg ? "red" : (isLow ? "orange" : "black");
            let style = isNeg ? "font-weight:bold;" : "";
            let className = (isNeg && forEmail) ? 'class="blink"' : "";
            return `<span ${className} style="color:${color}; ${style}">${v.name}: ${v.count}</span>`;
        }).join(", ");
        html.push(`<tr><td>${item.id}</td><td>${item.name}</td><td>${stockList}</td></tr>`);
    });
    html.push('</table>');
    return html.join("");
}

// --- STOCK HISTORY & LOGGING ---

function recordStockChange(itemId, variantName, changeAmount, reason) {
    if (changeAmount === 0) return;
    let entry = {
        date: new Date().toISOString(),
        id: itemId,
        variant: variantName,
        change: changeAmount,
        reason: reason
    };
    stockHistory.push(entry);
    if (stockHistory.length > 1000) stockHistory.shift();
    browser.storage.local.set({ "stockHistory": stockHistory });
}

function showStockHistory() {
    let reversed = [...stockHistory].reverse();
    let rows = reversed.map(e => {
        let date = new Date(e.date).toLocaleString();
        let color = e.change > 0 ? "green" : "red";
        return `<tr>
            <td>${date}</td>
            <td>${escapeHtml(e.id)}</td>
            <td>${escapeHtml(e.variant)}</td>
            <td style="color:${color}; font-weight:bold;">${e.change > 0 ? "+" : ""}${e.change}</td>
            <td>${escapeHtml(e.reason)}</td>
        </tr>`;
    }).join("");

    let win = window.open("", "Stock History", "width=800,height=600");
    win.document.write(`
        <html><head><title>Stock History</title>
        <style>body{font-family:sans-serif; padding:20px; background:#f4f4f4;} 
        table{width:100%; border-collapse:collapse; background:#fff; box-shadow:0 2px 5px rgba(0,0,0,0.1);}
        th, td{padding:10px; border-bottom:1px solid #ddd; text-align:left;} th{background:#eee;}
        </style></head><body>
        <h2>Stock Movement Log</h2>
        <table><thead><tr><th>Date</th><th>Item ID</th><th>Variant</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>${rows}</tbody></table>
        </body></html>
    `);
}

// --- INVENTORY LOGIC ---

function generateKeywords(item) {
    let k = [item.id.toLowerCase()];
    if(item.name) item.name.toLowerCase().split(/[\s\-()]+/).forEach(w => { if(w.length>2) k.push(w); });
    if(item.note) item.note.toLowerCase().split(/[\s\-()]+/).forEach(w => { if(w.length>2) k.push(w); });
    if(item.variants) item.variants.forEach(v => k.push(v.name.toLowerCase()));
    if(item.keywords && Array.isArray(item.keywords)) {
        item.keywords.forEach(ek => { if(!k.includes(ek)) k.push(ek); });
    }
    return k;
}

function loadInventory() {
    return browser.storage.local.get(["inventory", "stockHistory"]).then(function(res) {
        stockHistory = res.stockHistory || [];
        if (res.inventory && res.inventory.length > 0) {
            globalInventory = res.inventory.map(item => {
                if (!item.keywords || !Array.isArray(item.keywords)) item.keywords = generateKeywords(item);
                if (!item.aliases) item.aliases = {};
                if (!item.store) item.store = "General"; 
                return item;
            });
        } else {
            globalInventory = DEFAULT_INVENTORY;
        }
        populateStoreFilter();
        renderInventoryPanel();
    });
}

function populateStoreFilter() {
    let select = document.getElementById("inv-store-filter");
    if(!select) return;

    let stores = new Set();
    globalStores.forEach(s => stores.add(s.name));
    globalInventory.forEach(i => { if(i.store) stores.add(i.store); });

    select.innerHTML = '<option value="ALL">All Stores</option>';
    stores.forEach(s => {
        let opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    });
    select.value = filterStore;
}

function saveInventory() {
    let rows = document.querySelectorAll("#inv-grid tr");
    let panel = document.getElementById("inventory-panel");
    
    if (panel.style.display !== "none") {
        let visibleIDs = Array.from(rows).map(r => r.querySelector(".inv-name-input").value.trim());
        let hiddenItems = globalInventory.filter(i => !visibleIDs.includes(i.id));
        
        let visibleItems = [];
        rows.forEach(row => {
            let id = row.querySelector(".inv-name-input").value.trim();
            if (!id) return;
            
            let store = row.querySelector(".inv-store-input").value.trim();
            let name = row.querySelector(".inv-product-name").textContent.trim();
            let note = row.querySelector(".inv-note-input").value.trim();
            
            let variants = [];
            row.querySelectorAll(".variant-tag").forEach(tag => {
                let vName = tag.querySelector(".var-name-edit").value.trim();
                let vCount = parseInt(tag.querySelector(".var-stock-edit").value) || 0;
                if (vName) variants.push({ name: vName, count: vCount });
            });
            
            let existingItem = globalInventory.find(i => i.id === id);
            let preservedKeywords = existingItem ? existingItem.keywords : [];
            let preservedAliases = existingItem ? (existingItem.aliases || {}) : {};
            
            let itemObj = { 
                id, store, name, note, variants,
                keywords: preservedKeywords,
                aliases: preservedAliases
            };
            itemObj.keywords = [...new Set([...preservedKeywords, ...generateKeywords(itemObj)])];
            visibleItems.push(itemObj);
        });
        
        globalInventory = [...hiddenItems, ...visibleItems];
    }

    browser.storage.local.set({ "inventory": globalInventory }).then(function() {
        populateStoreFilter();
        renderInventoryPanel();
        renderOrderTable();
        
        let btns = [document.getElementById("save-inv-btn"), document.getElementById("save-inv-btn-bottom")];
        btns.forEach(b => {
            if(b) {
                let original = b.textContent;
                b.textContent = "Saved!";
                setTimeout(() => b.textContent = original, 1000);
            }
        });
    });
}

function bulkMoveItems() {
    let targetStore = document.getElementById("bulk-store-input").value.trim();
    if (!targetStore) { alert("Please enter a new Store Name."); return; }
    if (!confirm(`Move all CURRENTLY VISIBLE items to store "${targetStore}"?`)) return;

    let rows = document.querySelectorAll("#inv-grid tr");
    let count = 0;
    
    rows.forEach(row => {
        let storeInput = row.querySelector(".inv-store-input");
        if (storeInput) {
            storeInput.value = targetStore;
            count++;
        }
    });
    
    saveInventory(); 
    alert(`Moved ${count} items to ${targetStore}.`);
}

function renderInventoryPanel() {
    let tbody = document.getElementById("inv-grid");
    if(!tbody) return;
    tbody.innerHTML = "";
    
    filterStore = document.getElementById("inv-store-filter").value;

    let storeCols = document.querySelectorAll(".col-store");
    storeCols.forEach(col => {
        if (filterStore === "ALL") col.classList.remove("hidden-col");
        else col.classList.add("hidden-col");
    });

    globalInventory.forEach((item, index) => {
        let hasStock = item.variants.some(v => v.count > 0);
        let hasNeg = item.variants.some(v => v.count < 0);

        if (filterInvOOS && !hasStock && !hasNeg) return; 
        if (filterInvNeg && !hasNeg) return; 
        if (filterStore !== "ALL" && item.store !== filterStore) return;

        addInventoryRow(item, index);
    });
}

function addInventoryRow(item = { id: "", store: "General", name: "New Product", note: "", variants: [] }, index = -1) {
    let tbody = document.getElementById("inv-grid");
    let tr = document.createElement("tr");
    
    let variantsHtml = `<div class="variant-container">`;
    (item.variants || []).forEach(v => {
        if (filterInvNeg && v.count >= 0) return; 
        let style = v.count < 0 ? "border-color:var(--danger); color:var(--danger);" : "";
        variantsHtml += `<div class="variant-tag" style="${style}"><input type="text" class="var-name-edit" value="${escapeHtml(v.name)}"><input type="number" class="var-stock-edit" value="${v.count}"><button class="var-btn del">×</button></div>`;
    });
    variantsHtml += `<button class="var-btn add">+</button></div>`;

    let storeDisplay = (filterStore === "ALL") ? "" : "hidden-col";

    tr.innerHTML = `
        <td><input type="text" class="inv-name-input" value="${escapeHtml(item.id)}" placeholder="Code"></td>
        <td class="col-store ${storeDisplay}"><input type="text" class="inv-store-input" value="${escapeHtml(item.store)}" placeholder="Store" list="store-list"></td>
        <td><div class="inv-product-name" contenteditable="true" style="font-weight:bold; border-bottom:1px dashed #555;">${escapeHtml(item.name)}</div><input type="text" class="inv-note-input" value="${escapeHtml(item.note || "")}" placeholder="Description..."></td>
        <td>${variantsHtml}</td>
        <td>
            <button class="convert-btn" title="Convert Stock">♻</button>
            <button class="row-del-btn" title="Delete Product">🗑</button>
        </td>
    `;
    
    tr.querySelectorAll(".var-btn.del").forEach(btn => btn.addEventListener("click", function() { this.parentElement.remove(); }));
    
    tr.querySelector(".var-btn.add").addEventListener("click", function() {
        let container = tr.querySelector(".variant-container");
        let newTag = document.createElement("div");
        newTag.className = "variant-tag";
        newTag.innerHTML = `<input type="text" class="var-name-edit" value="New"><input type="number" class="var-stock-edit" value="0"><button class="var-btn del">×</button>`;
        container.insertBefore(newTag, this);
        newTag.querySelector(".del").addEventListener("click", function() { newTag.remove(); });
    });
    
    tr.querySelector(".row-del-btn").addEventListener("click", function() { if(confirm("Delete product?")) { tr.remove(); saveInventory(); } });
    
    tr.querySelector(".convert-btn").addEventListener("click", function() {
        let targetIndex = index;
        if (targetIndex === -1) { alert("Please save the new product first before converting stock."); return; }
        openConvertModal(targetIndex);
    });
    
    tbody.appendChild(tr);
}

// --- RESOLVER MODAL ---

function openResolver(orderIdx, itemIdx) {
    let order = globalOrders[orderIdx];
    let item = order.items[itemIdx];
    
    let detectedVariant = "Standard";
    let variantMatch = item.name.match(/((?:\d+\s*[xX]\s*)?\d+\s*(?:g|mg|kg|mcg|ml|oz|lb|caps?|tablets?|softgels?|pills?))/i);
    if (variantMatch) detectedVariant = variantMatch[1];

    let modal = document.createElement("div");
    modal.id = "resolver-modal";
    modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; display:flex; justify-content:center; align-items:center;";
    
    let inner = document.createElement("div");
    inner.style.cssText = "background:var(--bg-card); padding:20px; border-radius:8px; width:500px; border:1px solid var(--border); box-shadow:0 10px 25px rgba(0,0,0,0.5);";
    
    inner.innerHTML = `
        <h3 style="margin-top:0;">Resolve: <span style="color:var(--accent)">${escapeHtml(item.name)}</span></h3>
        <p style="color:var(--text-muted); font-size:12px;">Link this item. We will remember your choice.</p>
        
        <div style="margin-bottom:20px; border-bottom:1px solid var(--border); padding-bottom:15px;">
            <h4>Option 1: Link to Existing</h4>
            <select id="resolve-search" style="width:100%; padding:8px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border); margin-bottom:10px;">
                <option value="">-- Select Product --</option>
            </select>
            
            <div id="resolve-variant-area" style="display:none; margin-top:10px;">
                <div style="display:flex; gap:10px;">
                    <select id="resolve-variant-select" style="flex-grow:1; padding:6px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);"></select>
                    <input type="text" id="resolve-variant-new" value="${escapeHtml(detectedVariant)}" style="flex-grow:1; padding:6px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border); display:none;">
                </div>
                <button id="btn-link-existing" class="primary" style="width:100%; margin-top:10px;">🔗 Link & Learn</button>
            </div>
        </div>

        <div>
            <h4>Option 2: Create New Product</h4>
            <input id="new-prod-name" type="text" value="${escapeHtml(item.name)}" style="width:100%; padding:8px; margin-bottom:5px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);" placeholder="Product Name">
            <input id="new-prod-store" type="text" value="${escapeHtml(order.sender || 'General')}" style="width:100%; padding:8px; margin-bottom:5px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);" placeholder="Store Name">
            <input id="new-prod-var" type="text" value="${escapeHtml(detectedVariant)}" style="width:100%; padding:8px; margin-bottom:10px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);" placeholder="Variant (e.g. 10g)">
            <button id="btn-create-new" style="width:100%;">+ Create New Product</button>
        </div>
        
        <button id="btn-cancel" style="margin-top:15px; background:transparent; border:none; color:var(--text-muted); width:100%; cursor:pointer;">Cancel</button>
    `;

    modal.appendChild(inner);
    document.body.appendChild(modal);

    let select = document.getElementById("resolve-search");
    globalInventory.forEach((prod, idx) => {
        let opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${prod.id} - ${prod.name} [${prod.store}]`;
        select.appendChild(opt);
    });

    select.addEventListener("change", function() {
        let varArea = document.getElementById("resolve-variant-area");
        let varSelect = document.getElementById("resolve-variant-select");
        let newVarInput = document.getElementById("resolve-variant-new");
        
        if (this.value === "") { varArea.style.display = "none"; return; }
        
        varArea.style.display = "block";
        varSelect.innerHTML = "";
        let selectedProd = globalInventory[this.value];
        
        selectedProd.variants.forEach(v => {
            let opt = document.createElement("option");
            opt.value = v.name;
            opt.textContent = `${v.name} (Stock: ${v.count})`;
            varSelect.appendChild(opt);
        });
        
        let newOpt = document.createElement("option");
        newOpt.value = "__NEW__";
        newOpt.textContent = "+ Create New Variant...";
        varSelect.appendChild(newOpt);
        
        newVarInput.style.display = "none";
    });

    document.getElementById("resolve-variant-select").addEventListener("change", function() {
        let newVarInput = document.getElementById("resolve-variant-new");
        if (this.value === "__NEW__") {
            newVarInput.style.display = "block";
            if(newVarInput.value === "") newVarInput.value = detectedVariant;
            newVarInput.focus();
        } else {
            newVarInput.style.display = "none";
        }
    });

    document.getElementById("btn-link-existing").addEventListener("click", () => {
        let prodIdx = document.getElementById("resolve-search").value;
        let varVal = document.getElementById("resolve-variant-select").value;
        let newVarVal = document.getElementById("resolve-variant-new").value;
        
        if (!prodIdx) return;
        
        let targetProd = globalInventory[prodIdx];
        let finalVariantName = (varVal === "__NEW__") ? newVarVal : varVal;
        
        if (!finalVariantName) { alert("Please specify a variant name"); return; }

        globalInventory.forEach(p => {
            if (p.aliases && p.aliases[item.name.toLowerCase()]) {
                delete p.aliases[item.name.toLowerCase()];
            }
        });

        if (varVal === "__NEW__") {
            targetProd.variants.push({ name: finalVariantName, count: 0 });
        }

        if (!targetProd.aliases) targetProd.aliases = {};
        targetProd.aliases[item.name.toLowerCase()] = finalVariantName;

        if (!targetProd.keywords.includes(item.name.toLowerCase())) {
            targetProd.keywords.push(item.name.toLowerCase());
        }

        item.name = targetProd.name + " " + finalVariantName; 
        
        saveInventory(); 
        saveOrders();    
        document.body.removeChild(modal);
    });

    document.getElementById("btn-create-new").addEventListener("click", () => {
        let name = document.getElementById("new-prod-name").value;
        let store = document.getElementById("new-prod-store").value || "General";
        let variant = document.getElementById("new-prod-var").value;
        
        if (!name) return;

        let newInvItem = {
            id: "GEN-" + Math.floor(Math.random() * 10000),
            store: store,
            name: name,
            note: "Created via Resolver",
            variants: [{ name: variant, count: 0 }],
            keywords: [name.toLowerCase()],
            aliases: {} 
        };
        
        newInvItem.aliases[item.name.toLowerCase()] = variant;
        
        globalInventory.push(newInvItem);
        item.name = name + " " + variant;
        
        saveInventory();
        saveOrders();
        document.body.removeChild(modal);
    });

    document.getElementById("btn-cancel").addEventListener("click", () => document.body.removeChild(modal));
}

// --- THREAD / HISTORY MODAL (Same as 7.0.0) ---

function openHistoryModal(orderIdx) {
    let order = globalOrders[orderIdx];
    
    if (!order.messageId) {
        alert("This order has no linked email (it might be a Manual Entry).");
        return;
    }

    let modal = document.createElement("div");
    modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:2000; display:flex; justify-content:center; align-items:center;";
    let inner = document.createElement("div");
    inner.style.cssText = "background:var(--bg-card); padding:20px; border-radius:8px; width:600px; height:500px; border:1px solid var(--border); box-shadow:0 10px 25px rgba(0,0,0,0.5); display:flex; flex-direction:column;";
    
    inner.innerHTML = `
        <h3 style="margin-top:0;">Email Chain: ${escapeHtml(order.order)}</h3>
        <p style="color:var(--text-muted); font-size:12px;">Showing all emails in this Thunderbird thread.</p>
        <div id="history-list" style="flex-grow:1; overflow-y:auto; border:1px solid var(--border); margin:10px 0; padding:10px; background:rgba(0,0,0,0.1);">
            <div style="text-align:center; padding:20px;">⏳ Loading Thread...</div>
        </div>
        <button id="btn-close-history" style="width:100%;">Close</button>
    `;
    modal.appendChild(inner);
    document.body.appendChild(modal);

    document.getElementById("btn-close-history").addEventListener("click", () => document.body.removeChild(modal));

    browser.runtime.sendMessage({ action: "get_thread", id: order.messageId }, (response) => {
        let listDiv = document.getElementById("history-list");
        listDiv.innerHTML = "";
        
        if (!response || response.length === 0) {
            listDiv.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Thread Not Found.</div>`;
            return;
        }

        response.forEach(msg => {
            let item = document.createElement("div");
            item.style.cssText = "padding:10px; border-bottom:1px solid var(--border); cursor:pointer; transition:background 0.2s; display:flex; gap:10px; align-items:center;";
            item.onmouseover = () => item.style.background = "var(--bg-header)";
            item.onmouseout = () => item.style.background = "transparent";
            
            let dateStr = new Date(msg.date).toLocaleDateString() + " " + new Date(msg.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            let isMe = msg.author.includes("bionootropics"); 
            let icon = isMe ? "📤" : "📥";
            let color = isMe ? "var(--accent)" : "var(--text-main)";
            
            item.innerHTML = `
                <div style="font-size:20px;">${icon}</div>
                <div style="flex-grow:1;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted);">
                        <span style="color:${color}; font-weight:bold;">${escapeHtml(msg.author)}</span>
                        <span>${dateStr}</span>
                    </div>
                    <div style="font-weight:600; font-size:13px; margin-top:2px;">${escapeHtml(msg.subject)}</div>
                </div>
            `;
            
            item.addEventListener("click", () => {
                browser.runtime.sendMessage({ action: "open_message", id: msg.id });
            });
            listDiv.appendChild(item);
        });
    });
}

// --- STOCK CONVERTER MODAL (Same as 7.0.0) ---

function openConvertModal(itemIdx) {
    let item = globalInventory[itemIdx];
    if (!item || !item.variants || item.variants.length < 2) {
        alert("You need at least 2 variants to convert stock (e.g. '1kg' and '100g').");
        return;
    }

    let modal = document.createElement("div");
    modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; display:flex; justify-content:center; align-items:center;";
    let inner = document.createElement("div");
    inner.style.cssText = "background:var(--bg-card); padding:20px; border-radius:8px; width:450px; border:1px solid var(--border); box-shadow:0 10px 25px rgba(0,0,0,0.5);";
    
    inner.innerHTML = `
        <h3 style="margin-top:0;">♻ Convert Stock: <span style="color:var(--accent)">${escapeHtml(item.name)}</span></h3>
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:15px;">
            <div style="flex:1;">
                <label style="font-size:12px; color:var(--text-muted)">FROM Source:</label>
                <select id="conv-from" style="width:100%; padding:8px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);"></select>
            </div>
            <div style="font-size:20px;">➡</div>
            <div style="flex:1;">
                <label style="font-size:12px; color:var(--text-muted)">TO Target:</label>
                <select id="conv-to" style="width:100%; padding:8px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);"></select>
            </div>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:20px;">
            <div style="flex:1;">
                <label style="font-size:12px; color:var(--text-muted)">Take Amount:</label>
                <input type="number" id="conv-take" value="1" style="width:100%; padding:8px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);">
            </div>
            <div style="flex:1;">
                <label style="font-size:12px; color:var(--text-muted)">Add Amount:</label>
                <input type="number" id="conv-add" value="1" style="width:100%; padding:8px; background:var(--input-bg); color:var(--text-main); border:1px solid var(--border);">
            </div>
        </div>

        <button id="btn-exec-conv" class="primary" style="width:100%;">Execute Conversion</button>
        <button id="btn-cancel-conv" style="width:100%; margin-top:10px; background:transparent; border:none; color:var(--text-muted); cursor:pointer;">Cancel</button>
    `;

    modal.appendChild(inner);
    document.body.appendChild(modal);

    let fromSel = document.getElementById("conv-from");
    let toSel = document.getElementById("conv-to");

    item.variants.forEach((v, idx) => {
        let opt1 = document.createElement("option"); opt1.value = idx; opt1.textContent = `${v.name} (Qty: ${v.count})`;
        let opt2 = document.createElement("option"); opt2.value = idx; opt2.textContent = `${v.name} (Qty: ${v.count})`;
        fromSel.appendChild(opt1);
        toSel.appendChild(opt2);
    });
    
    if(item.variants.length > 1) toSel.selectedIndex = 1;

    document.getElementById("btn-exec-conv").addEventListener("click", () => {
        let fromIdx = parseInt(fromSel.value);
        let toIdx = parseInt(toSel.value);
        let takeQty = parseInt(document.getElementById("conv-take").value);
        let addQty = parseInt(document.getElementById("conv-add").value);

        if (isNaN(takeQty) || isNaN(addQty) || takeQty <= 0 || addQty <= 0) {
            alert("Please enter valid positive quantities."); return;
        }
        if (fromIdx === toIdx) {
            alert("Source and Target must be different."); return;
        }

        item.variants[fromIdx].count -= takeQty;
        item.variants[toIdx].count += addQty;
        
        recordStockChange(item.id, item.variants[fromIdx].name, -takeQty, "Stock Conversion");
        recordStockChange(item.id, item.variants[toIdx].name, addQty, "Stock Conversion");

        saveInventory(); 
        document.body.removeChild(modal);
    });

    document.getElementById("btn-cancel-conv").addEventListener("click", () => document.body.removeChild(modal));
}

// --- ORDER RENDER LOGIC ---

function renderOrderTable() {
    let tbody = document.querySelector("#orderTable tbody");
    if(!tbody) return;
    tbody.innerHTML = ""; 

    if (!globalOrders || globalOrders.length === 0) {
        let panel = document.getElementById("inventory-panel");
        if(panel) panel.style.display = "block";
        return;
    }

    globalOrders.forEach((order, orderIdx) => {
        // --- 1. FILTERING LOGIC ---
        
        // Hide Cancelled if not relevant (or style them?)
        // Currently we show them but styled differently.
        
        // Hide Shipped?
        if (filterShipped && order.tracking && order.tracking.trim() !== "") return;
        
        // Filter by Date?
        if (filterDate) {
            let orderDate = new Date(order.date);
            let targetDate = new Date(filterDate);
            // Reset times for date-only comparison
            orderDate.setHours(0,0,0,0);
            targetDate.setHours(0,0,0,0);
            
            if (orderDate < targetDate) return;
        }

        // Partials Only?
        if (filterPartialOnly && !order.isPartial) return;
        
        // Search Filter
        let safeOrder = escapeHtml(order.order);
        let safeName = order.addressLines && order.addressLines[0] ? order.addressLines[0].toLowerCase() : "";
        if (filterSearch) {
            let term = filterSearch.toLowerCase();
            let match = safeOrder.toLowerCase().includes(term) || safeName.includes(term) || (order.tracking && order.tracking.includes(term));
            if (!match) return;
        }

        // --- 2. RENDER ROW ---
        let isCancelled = order.status === "cancelled";
        let isUpdated = order.highlight === "updated";

        let addressDisplay = order.addressLines && order.addressLines.length > 0 
            ? `<a href="#" class="name-link" data-msgid="${order.messageId}">${escapeHtml(order.addressLines[0])}</a><br>${order.addressLines.slice(1).map(escapeHtml).join("<br>")}`
            : "No Address";

        let orderIdHtml = safeOrder;
        if (order.orderLink) {
            orderIdHtml = `<a href="#" data-action="open-external" data-url="${escapeHtml(order.orderLink)}" style="color:var(--accent); text-decoration:underline; cursor:pointer;" title="Open in Browser">${safeOrder}</a>`;
        }

        let storeBadge = order.sender ? `<br><span style="font-size:10px; color:var(--text-muted); border:1px solid var(--border); padding:1px 3px; border-radius:3px;">${escapeHtml(order.sender)}</span>` : "";

        if(isCancelled) {
            orderIdHtml += " <span style='color:var(--danger); font-weight:bold; font-size:10px;'>[CANCELLED]</span>";
        }

        if (!order.items) order.items = [{ name: order.product || "Unknown Item", qty: 1 }];

        let itemsHtml = "";
        order.items.forEach((item, itemIdx) => {
            if(!item.qty) item.qty = 1;

            let match = findInventoryMatch(item.name);
            let badge = "";
            let linkHtml = "";

            if (match) {
                let color = match.variant.count < 0 ? "var(--danger)" : (match.variant.count < 5 ? "orange" : "var(--success)");
                let bgStyle = match.variant.count < 0 ? "border:1px solid var(--danger); background:rgba(207,102,121,0.1);" : "";
                
                badge = `<div style="font-size:11px; color:${color}; ${bgStyle} padding:2px 4px; border-radius:3px;">Stock: ${match.variant.count} (${match.variant.name})</div>`;
                linkHtml = `<span class="item-link" style="cursor:pointer; border-bottom:1px dotted var(--text-muted)" data-action="resolve" data-oid="${orderIdx}" data-iid="${itemIdx}">${escapeHtml(item.name)}</span>`;
            } else {
                badge = `<div style="font-size:11px; color:var(--danger)">⚠ Unknown</div>`;
                linkHtml = `<button class="warn-btn" style="background:var(--danger); border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px;" data-action="resolve" data-oid="${orderIdx}" data-iid="${itemIdx}">⚠ Link: ${escapeHtml(item.name)}</button>`;
            }

            itemsHtml += `
                <div class="order-item-chip" style="margin-bottom:8px; padding:6px; background:rgba(255,255,255,0.05); border-radius:4px;">
                    <div class="chip-header" style="display:flex; justify-content:space-between; align-items:center;">
                        ${linkHtml}
                        <input type="number" class="qty-input" data-oid="${orderIdx}" data-iid="${itemIdx}" value="${item.qty}" min="1">
                        <button class="mini-btn" style="background:none; border:none; color:var(--text-muted); cursor:pointer;" data-action="remove-item" data-oid="${orderIdx}" data-iid="${itemIdx}">×</button>
                    </div>
                    ${badge}
                </div>
            `;
        });

        itemsHtml += `<button class="add-item-row-btn" data-action="add-item" data-oid="${orderIdx}">+ Add Item</button>`;

        let tr = document.createElement("tr");
        if(isCancelled) tr.className = "order-cancelled";
        else if(isUpdated) tr.className = "order-updated"; // Red Highlight Logic
        
        tr.innerHTML = `
            <td>${orderIdHtml} ${storeBadge}</td>
            <td>${itemsHtml}</td>
            <td>${addressDisplay} <button class="copy-btn" data-action="copy-addr" data-oid="${orderIdx}">Copy</button></td>
            <td>
                <div style="display:flex; align-items:center;">
                    <input type="text" class="tracking-input" placeholder="Paste Tracking" value="${escapeHtml(order.tracking || '')}" data-oid="${orderIdx}">
                    <button class="paste-btn" data-action="paste-track" data-oid="${orderIdx}">📋</button>
                    <button class="reply-btn" data-action="reply-track" data-oid="${orderIdx}" title="Reply to Customer">↩</button>
                </div>
                <input type="text" class="note-input" placeholder="Add note..." value="${escapeHtml(order.note || '')}" data-oid="${orderIdx}">
            </td>
            <td style="text-align:center;"><input type="checkbox" class="partial-check" data-oid="${orderIdx}" ${order.isPartial ? "checked" : ""}></td>
            <td>
                <button class="del-btn" data-action="del-order" data-oid="${orderIdx}">X</button>
                <button class="cancel-btn" data-action="cancel-order" data-oid="${orderIdx}">🚫 Cancel</button>
                <div style="margin-top:5px;">
                    <button class="invoice-btn" data-action="view-inv" data-oid="${orderIdx}">📄</button>
                    <button class="history-btn" data-action="view-history" data-oid="${orderIdx}" title="View Email History">📜</button>
                </div>
            </td>
        `;
        
        tr.querySelector(".tracking-input").addEventListener("change", function() { globalOrders[orderIdx].tracking = this.value; saveOrders(); });
        tr.querySelector(".partial-check").addEventListener("change", function() { globalOrders[orderIdx].isPartial = this.checked; saveOrders(); });
        tr.querySelector(".note-input").addEventListener("change", function() { globalOrders[orderIdx].note = this.value; saveOrders(); });
        
        tr.querySelectorAll(".qty-input").forEach(input => {
            input.addEventListener("change", function() {
                let oid = this.dataset.oid;
                let iid = this.dataset.iid;
                let val = parseInt(this.value);
                if (val < 1) val = 1;
                globalOrders[oid].items[iid].qty = val;
                saveOrders();
            });
        });

        tbody.appendChild(tr);
    });
}

// --- MASTER EVENT HANDLER ---

function handleTableClick(e) {
    if (e.target.classList.contains("name-link")) {
        e.preventDefault();
        browser.runtime.sendMessage({ action: "open_message", id: parseInt(e.target.dataset.msgid) });
        return;
    }

    let target = e.target.closest("[data-action]");
    if (!target) return;

    let action = target.dataset.action;
    let oid = parseInt(target.dataset.oid);
    let iid = parseInt(target.dataset.iid);

    if (action === "resolve") openResolver(oid, iid);
    if (action === "remove-item") removeItemFromOrder(oid, iid);
    if (action === "add-item") addItemToOrder(oid);
    if (action === "del-order") deleteRow(oid);
    if (action === "cancel-order") cancelOrder(oid);
    
    if (action === "open-external") {
        let url = target.dataset.url;
        if(url) window.open(url, '_blank');
        return;
    }

    if (action === "view-history") openHistoryModal(oid);
    
    if (action === "copy-addr") {
        let order = globalOrders[oid];
        let raw = (order.addressLines || []).join("\n");
        copyToClip(encodeURIComponent(raw), target);
    }
    
    if (action === "paste-track") {
        let input = target.previousElementSibling;
        navigator.clipboard.readText().then(text => { 
            if(text) { 
                input.value = text.trim(); 
                input.dispatchEvent(new Event('change')); 
            } 
        });
    }

    if (action === "reply-track") {
        let order = globalOrders[oid];
        let track = target.parentElement.querySelector(".tracking-input").value;
        
        if (order.messageId && track) {
            
            let includeInv = confirm("Attach the current Inventory Status to this email?");

            getOriginalHtml(order.messageId).then(originalHtml => {
                
                let custName = "Customer";
                if (order.addressLines && order.addressLines.length > 0) {
                    let fullName = order.addressLines[0];
                    custName = fullName.split(" ")[0] || "Customer";
                }

                let itemRows = order.items.map(i => {
                    let q = i.qty || 1;
                    return `<li>${q}x ${escapeHtml(i.name)}</li>`;
                }).join("");
                
                let orderLinkHtml = order.orderLink ? `<p><a href="${order.orderLink}" style="color: #0078d4; text-decoration: none;">View Order Details</a></p>` : "";
                let noteHtml = order.note ? `<p><strong>Note to Customer:</strong> ${escapeHtml(order.note)}</p>` : "";
                
                let inventoryHtml = "";
                if (includeInv) {
                    inventoryHtml = `<br><hr><h3>Current Inventory Status</h3>${generateInventoryHTML(true)}<br>`;
                }

                // SMART TRACKING
                let trackInfo = getTrackingLink(track);
                
                // SMART SIGNATURE
                let signature = getStoreSignature(order.sender);

                let htmlBody = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
                        <p>Hello ${escapeHtml(custName)},</p>
                        <p>Great news! Your order has been shipped.</p>
                        
                        <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <strong>Tracking Number (${trackInfo.name}):</strong> <a href="${trackInfo.url}">${track}</a>
                        </div>
                        
                        ${noteHtml}

                        <p><strong>Items Included:</strong></p>
                        <ul>${itemRows}</ul>

                        ${orderLinkHtml}

                        <p><br>
                        ${escapeHtml(signature).replace(/\n/g, '<br>')}</p>
                        
                        ${inventoryHtml}

                        <br>
                        <hr style="border:0; border-top:1px solid #ccc;">
                        <br>
                        ${originalHtml} 
                    </div>
                `;
                
                browser.compose.beginReply(order.messageId, { body: htmlBody, isPlainText: false });
            });

        } else { 
            alert("Please enter a Tracking Number first!"); 
        }
    }

    if (action === "view-inv") {
        let row = target.closest("tr");
        let safeOrder = globalOrders[oid];
        
        let isDark = document.documentElement.getAttribute("data-theme") === "dark";
        let darkCss = isDark ? `
            body { background: #121212; color: #e0e0e0; } 
            table, th, td { border-color: #333; } 
            th { background: #2d2d2d; }
        ` : `
            body { background: #fff; color: #000; }
            table, th, td { border-color: #ccc; }
        `;

        let invoiceHtml = `
            <html>
            <head>
                <title>Invoice - ${safeOrder.order}</title>
                <style>
                    body { font-family: sans-serif; padding: 40px; }
                    h1 { border-bottom: 2px solid #ccc; padding-bottom: 10px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
                    ${darkCss}
                    @media print { body { background: #fff; color: #000; } }
                </style>
            </head>
            <body>
                <h1>Packing Slip / Invoice</h1>
                <p><strong>Order:</strong> ${safeOrder.order}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                
                <h3>Items</h3>
                <table>
                    <thead>
                        <tr><th>Qty</th><th>Product</th><th>Variant</th><th>Note</th></tr>
                    </thead>
                    <tbody>
                        ${safeOrder.items.map(i => {
                            let q = i.qty || 1;
                            return `<tr><td>${q}</td><td>${escapeHtml(i.name)}</td><td>-</td><td></td></tr>`;
                        }).join("")}
                    </tbody>
                </table>

                <h3>Shipping To</h3>
                <pre style="font-family: sans-serif; font-size: 14px;">${safeOrder.addressLines.join("\n")}</pre>
                
                <script>window.print();</script>
            </body>
            </html>
        `;

        let win = window.open("", "Invoice", "width=800,height=800");
        win.document.write(invoiceHtml);
    }
}

function emailOpenOrders() {
    let openOrders = globalOrders.filter(o => !o.tracking && o.status !== "cancelled");
    if (openOrders.length === 0) { alert("No open orders to forward."); return; }
    let rows = openOrders.map(o => {
        let items = o.items.map(i => { return `${i.qty || 1}x ${i.name}`; }).join(", ");
        let addr = (o.addressLines || []).join(", ");
        return `<tr><td style="padding:10px; border-bottom:1px solid #ccc;">${escapeHtml(o.order)}</td><td style="padding:10px; border-bottom:1px solid #ccc;"><strong>${escapeHtml(items)}</strong></td><td style="padding:10px; border-bottom:1px solid #ccc;">${escapeHtml(addr)}</td></tr>`;
    }).join("");
    let html = `<html><body style="font-family: sans-serif; padding: 20px;"><h2>Open Orders for Inventory Picking</h2><table style="width:100%; border-collapse: collapse; text-align: left;"><tr style="background:#eee;"><th style="padding:10px;">Order #</th><th style="padding:10px;">Items to Pick</th><th style="padding:10px;">Address</th></tr>${rows}</table></body></html>`;
    browser.runtime.sendMessage({ action: "compose_report", to: "bionootropics.shipping@gmail.com", subject: "Open Orders List (Tablet View)", html: html });
}

function cancelOrder(orderIdx) {
    let order = globalOrders[orderIdx];
    if(!confirm(`Cancel Order ${order.order}? This will mark it as cancelled.`)) return;
    if(confirm("Do you want to restock items from this order back to inventory?")) {
        order.items.forEach(item => {
            let qty = item.qty || 1;
            let match = findInventoryMatch(item.name);
            if (match) {
                match.variant.count += qty;
                recordStockChange(match.family.id, match.variant.name, qty, `Cancelled Order ${order.order}`);
            }
        });
        alert("Items restocked.");
    }
    order.status = "cancelled";
    saveOrders();
    saveInventory();
    renderOrderTable();
}

function addItemToOrder(orderIdx) {
    globalOrders[orderIdx].items.push({ name: "New Item", qty: 1 });
    saveOrders();
    renderOrderTable();
}

function removeItemFromOrder(orderIdx, itemIdx) {
    if (globalOrders[orderIdx].items.length > 1) {
        globalOrders[orderIdx].items.splice(itemIdx, 1);
    } else {
        if(confirm("Delete the whole order?")) {
            globalOrders.splice(orderIdx, 1);
        }
    }
    saveOrders();
    renderOrderTable();
}

function deleteRow(index) {
    if (confirm("Permanently delete this order record?")) {
        globalOrders.splice(index, 1);
        saveOrders();
        renderOrderTable();
    }
}

function saveOrders() {
    browser.storage.local.set({ "reportData": globalOrders });
}

function findInventoryMatch(productName) {
    if (!productName) return null;
    let lowerName = productName.toLowerCase();
    for (let item of globalInventory) {
        if (item.aliases && item.aliases[lowerName]) {
            let targetVarName = item.aliases[lowerName];
            let targetVar = item.variants.find(v => v.name === targetVarName);
            if (targetVar) { return { family: item, variant: targetVar }; }
        }
    }
    let bestFamily = null, bestVariant = null, maxScore = 0;
    globalInventory.forEach(function(family) {
        let familyScore = 0;
        if (lowerName.includes(family.id.toLowerCase())) familyScore += 10;
        if (Array.isArray(family.keywords)) {
            family.keywords.forEach(w => { if (lowerName.includes(w)) familyScore += 5; });
        }
        if (familyScore > 0) {
            family.variants.forEach(v => {
                let currentScore = familyScore;
                if (lowerName.includes(v.name.toLowerCase())) currentScore += 5;
                if (currentScore > maxScore) {
                    maxScore = currentScore;
                    bestFamily = family;
                    bestVariant = v;
                }
            });
            if (maxScore === familyScore && familyScore > 0 && family.variants.length > 0 && !bestVariant) {
                 bestFamily = family; bestVariant = family.variants[0];
            }
        }
    });
    return (bestFamily && bestVariant) ? { family: bestFamily, variant: bestVariant } : null;
}

function exportInventoryCSV() {
    let csvContent = "ID,Store,Product,Stock,Note\n";
    globalInventory.forEach(item => {
        let stockStr = item.variants.map(v => `${v.name}: ${v.count}`).join(" | ");
        let safeName = `"${item.name.replace(/"/g, '""')}"`;
        let safeStore = `"${(item.store || "General").replace(/"/g, '""')}"`;
        let safeNote = `"${(item.note || "").replace(/"/g, '""')}"`;
        let safeStock = `"${stockStr.replace(/"/g, '""')}"`;
        csvContent += `${item.id},${safeStore},${safeName},${safeStock},${safeNote}\n`;
    });
    let csvFile = new File([csvContent], "inventory_full.csv", { type: "text/csv" });
    browser.compose.beginNew({
        to: "bionootropics.shipping@gmail.com",
        subject: `Inventory Backup - ${new Date().toLocaleDateString()}`,
        body: "Attached is the full inventory CSV export (Excel/Sheets compatible).",
        isPlainText: true,
        attachments: [{ file: csvFile }]
    });
}

function commitAndEmail() {
    let emailData = [];
    let changesMade = false;
    globalOrders.forEach(order => {
        if(order.status === "cancelled") return;
        let orderProductDesc = [];
        order.items.forEach(item => {
            let qty = item.qty || 1;
            let match = findInventoryMatch(item.name);
            if (match) {
                match.variant.count -= qty; 
                changesMade = true;
                orderProductDesc.push(`${qty}x ${match.family.name} (${match.variant.name})`);
                recordStockChange(match.family.id, match.variant.name, -qty, `Order ${order.order}`);
            } else {
                orderProductDesc.push(`${qty}x ${item.name} [UNKNOWN]`);
            }
        });
        emailData.push({
            order: order.order,
            orderLink: order.orderLink, 
            product: orderProductDesc.join(", ") + (order.isPartial ? " **(PARTIAL)**" : ""),
            tracking: order.tracking,
            name: order.addressLines ? order.addressLines[0] : "Customer",
            fullAddr: (order.addressLines || []).join(", "),
            email: order.email || "", 
            phone: order.phone || ""
        });
    });
    let csvContent = "ID,Store,Product,Stock,Note\n";
    globalInventory.forEach(item => {
        let stockStr = item.variants.map(v => `${v.name}: ${v.count}`).join(" | ");
        let safeName = `"${item.name.replace(/"/g, '""')}"`;
        let safeStore = `"${(item.store || "General").replace(/"/g, '""')}"`;
        let safeNote = `"${(item.note || "").replace(/"/g, '""')}"`;
        let safeStock = `"${stockStr.replace(/"/g, '""')}"`;
        csvContent += `${item.id},${safeStore},${safeName},${safeStock},${safeNote}\n`;
    });
    let csvFile = new File([csvContent], "inventory_full.csv", { type: "text/csv" });
    let html = ['<html><head><style>'];
    html.push('@keyframes blink { 50% { opacity: 0; } }');
    html.push('.blink { animation: blink 1s linear infinite; color: red; font-weight: bold; }');
    html.push('</style></head><body style="font-family: Arial; color: #333;">');
    html.push('<h3>Shipping Report</h3><table border="1" cellpadding="5" style="border-collapse:collapse; width:100%;">');
    html.push('<tr style="background:#eee;"><th>Order</th><th>Customer</th><th>Items</th><th>Tracking</th></tr>');
    emailData.forEach(d => {
        let orderCell = d.orderLink ? `<a href="${d.orderLink}" style="text-decoration:none; color:#0078d4;">${d.order}</a>` : d.order;
        html.push(`<tr><td>${orderCell}</td><td>${d.name}</td><td>${d.product}</td><td><b>${d.tracking || "pending"}</b></td></tr>`);
    });
    html.push('</table>');
    html.push('<h3>Remaining Inventory</h3>');
    html.push(generateInventoryHTML(true)); 
    html.push('<br><p>Attached: Inventory CSV</p></body></html>');
    let savePromise = changesMade ? browser.storage.local.set({ "inventory": globalInventory }) : Promise.resolve();
    browser.compose.beginNew({
        to: "bionootropics.shipping@gmail.com",
        subject: `Orders for Processing - ${new Date().toLocaleDateString()}`,
        body: html.join(""),
        isPlainText: false, 
        attachments: [{ file: csvFile }]
    });
    savePromise.then(() => { setTimeout(() => location.reload(), 2000); });
}

function copyToClip(text, btn) {
    navigator.clipboard.writeText(decodeURIComponent(text));
    let orig = btn.textContent; btn.textContent = "✓"; setTimeout(() => btn.textContent = orig, 1000);
}

function addManualOrder() {
    globalOrders.push({ order: "Manual", product: "Manual", items: [{ name: "New Item", qty: 1 }], addressLines: ["Manual Entry"], tracking: "", isPartial: false });
    saveOrders();
    renderOrderTable();
}

document.addEventListener("DOMContentLoaded", function() {
    initTheme();
    loadStoreConfig().then(() => loadInventory()).then(() => {
        document.getElementById("reload-btn").addEventListener("click", () => location.reload());
        document.getElementById("toggle-inv-btn").addEventListener("click", () => {
            let p = document.getElementById("inventory-panel");
            document.getElementById("store-config-panel").style.display = "none";
            p.style.display = (p.style.display === "none") ? "block" : "none";
        });
        
        // STORE CONFIG LISTENERS
        document.getElementById("toggle-store-btn").addEventListener("click", () => {
            let s = document.getElementById("store-config-panel");
            document.getElementById("inventory-panel").style.display = "none";
            s.style.display = (s.style.display === "none") ? "block" : "none";
        });
        document.getElementById("add-store-btn").addEventListener("click", () => {
            globalStores.push({ name: "New Store", email: "", signature: "" });
            renderStoreConfig();
        });
        document.getElementById("save-stores-btn").addEventListener("click", saveStoreConfig);
        document.getElementById("close-stores-btn").addEventListener("click", () => document.getElementById("store-config-panel").style.display = "none");

        document.getElementById("save-inv-btn").addEventListener("click", saveInventory);
        document.getElementById("save-inv-btn-bottom").addEventListener("click", saveInventory); 
        document.getElementById("add-product-btn").addEventListener("click", () => addInventoryRow());
        document.getElementById("email-btn").addEventListener("click", commitAndEmail);
        document.getElementById("add-manual-order-btn").addEventListener("click", addManualOrder);
        document.getElementById("import-inv-btn").addEventListener("click", () => document.getElementById("inv-file-input").click());
        document.getElementById("history-btn").addEventListener("click", showStockHistory);
        document.getElementById("bulk-move-btn").addEventListener("click", bulkMoveItems); 
        
        document.getElementById("debug-btn").addEventListener("click", () => {
            console.log("Global Orders:", globalOrders);
            console.log("Global Inventory:", globalInventory);
            console.log("Global Stores:", globalStores);
            alert(`Debug Info:\nOrders: ${globalOrders.length}\nInventory Items: ${globalInventory.length}\nHistory Log: ${stockHistory.length} entries`);
        });
        
        document.getElementById("email-list-btn").addEventListener("click", emailOpenOrders);
        document.getElementById("export-btn").addEventListener("click", exportInventoryCSV);

        document.getElementById("inv-store-filter").addEventListener("change", function() { 
            filterStore = this.value; 
            renderInventoryPanel(); 
        });
        document.getElementById("order-search").addEventListener("input", function() { filterSearch = this.value; renderOrderTable(); });
        
        // DATE FILTER
        document.getElementById("filter-date-start").addEventListener("input", function() { filterDate = this.value; renderOrderTable(); });

        document.getElementById("filter-partial").addEventListener("change", function() { filterPartialOnly = this.checked; renderOrderTable(); });
        document.getElementById("filter-oos").addEventListener("change", function() { filterInvOOS = this.checked; renderInventoryPanel(); });
        document.getElementById("filter-neg").addEventListener("change", function() { filterInvNeg = this.checked; renderInventoryPanel(); });
        
        // Default: HIDE SHIPPED
        let shipFilter = document.getElementById("filter-shipped");
        if(shipFilter) {
            shipFilter.checked = true; // Set checkbox visual state
            filterShipped = true; // Set logic state
            shipFilter.addEventListener("change", function() { filterShipped = this.checked; renderOrderTable(); });
        }

        document.querySelector("#orderTable tbody").addEventListener("click", handleTableClick);

        browser.storage.local.get("reportData").then(storage => {
            globalOrders = storage.reportData || [];
            renderOrderTable();
        });
    });
});
