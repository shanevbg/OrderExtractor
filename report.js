/** Order Report UI | 1.0.93 */
document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("report-body");
    const countDisplay = document.getElementById("package-count");
    const render = async () => {
        const { reportData } = await browser.storage.local.get("reportData") || { reportData: [] };
        container.innerHTML = "";
        if (countDisplay) countDisplay.textContent = `Packages: ${reportData.length}`;
        if (reportData.length === 0) { container.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Log is empty.</td></tr>"; return; }
        reportData.forEach((item, index) => {
            const tr = document.createElement("tr");
            const orderLink = item.source === "ebay" ? `https://www.ebay.com/sh/ord/details?orderid=${item.order}` : `https://${item.domain}/wp-admin/post.php?post=${item.order}&action=edit`;
            tr.innerHTML = `<td><a href="${orderLink}" target="_blank">${item.order}</a></td><td>${item.product}</td><td>${item.addressLines.join("<br>")}<div class="debug-area"><details><summary>Debug Raw Body</summary><pre>${item.rawBody}</pre><button class="copy-raw-btn" style="margin-top:5px; background:#444; color:#fff;">Copy Raw</button></details></div></td><td>${item.notes}</td><td>${item.dateStr}</td><td class="actions"></td>`;
            const actionCell = tr.querySelector(".actions");
            const openBtn = Object.assign(document.createElement("button"), { textContent: "Open Email", className: "open-btn", style: "margin-right: 5px;" });
            openBtn.onclick = () => { browser.runtime.sendMessage({ action: "open_message", id: item.messageId }); };
            const copyBtn = Object.assign(document.createElement("button"), { textContent: "Copy Addr", className: "copy-btn", style: "margin-right: 5px;" });
            copyBtn.onclick = () => { navigator.clipboard.writeText(item.addressLines.join("\n")); copyBtn.textContent = "✓"; setTimeout(() => copyBtn.textContent = "Copy Addr", 1000); };
            const delBtn = Object.assign(document.createElement("button"), { textContent: "X", className: "delete-btn" });
            delBtn.onclick = async () => { const { reportData: currentData } = await browser.storage.local.get("reportData"); currentData.splice(index, 1); await browser.storage.local.set({ "reportData": currentData }); render(); };
            actionCell.append(openBtn, copyBtn, delBtn);
            container.appendChild(tr);
            tr.querySelector(".copy-raw-btn").onclick = () => { navigator.clipboard.writeText(item.rawBody); tr.querySelector(".copy-raw-btn").textContent = "Copied!"; setTimeout(() => tr.querySelector(".copy-raw-btn").textContent = "Copy Raw", 1000); };
        });
    };
    document.getElementById('btn-export').onclick = async () => { const { reportData } = await browser.storage.local.get("reportData"); const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(reportData)))); const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([encoded], { type: "text/plain" })), download: `Archive_${new Date().toISOString().split('T')[0]}.txt` }); a.click(); };
    document.getElementById('btn-import').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = (e) => { const reader = new FileReader(); reader.onload = async (ev) => { const decoded = JSON.parse(decodeURIComponent(escape(atob(ev.target.result)))); await browser.storage.local.set({ "reportData": decoded }); location.reload(); }; reader.readAsText(e.target.files[0]); };
    document.getElementById('btn-email').onclick = async () => { const tableClone = document.querySelector('table').cloneNode(true); tableClone.querySelectorAll('.actions, .debug-area').forEach(el => el.remove()); const emailHtml = `<style>table { border-collapse: collapse; width: 100%; font-family: sans-serif; } th, td { border: 1px solid #ccc; padding: 8px; text-align: left; } th { background-color: #f2f2f2; } a { color: #0078d4; text-decoration: none; font-weight: bold; }</style><h2>Shipping Request: ${new Date().toLocaleDateString()}</h2>${tableClone.outerHTML}`; browser.runtime.sendMessage({ action: "compose_report", html: emailHtml }); };
    document.getElementById('btn-clear').onclick = async () => { if (confirm("Clear all orders?")) { await browser.storage.local.set({ "reportData": [] }); render(); } };
    render();
});
