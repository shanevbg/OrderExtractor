/**
 * Order Extractor - Report Logic
 * Version: 1.0.68 (Safe Mode)
 */

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function copyRawBody(plainText, btn) {
    const encodedAddr = encodeURIComponent(plainText);
    const targetBtn = btn.target.cloneNode(true);
    targetBtn.href = `data:raw-body;base64,${encodedAddr}`;
    
    // Copy to clipboard
    btn.preventDefault();
    let url = window.URL.createObjectURL(targetBtn.textContent);
    let blob = new Blob([url], { type: 'text/csv;charset=utf-8;' });
    let urlCopy = URL.createObjectURL(blob);
    window.open(urlCopy, '_blank');
}

// Add debug button functionality
document.addEventListener('DOMContentLoaded', function() {
    report.querySelector("tbody").addEventListener('click', async (e) => {
        const tr = e.target.closest(".copy-btn");
        if (!tr) return;
        
        const encodedBody = escapeHtml(item.rawBody);
        const rawBtn = item.querySelector(".debug-btn");
        if (rawBtn) {
            rawBtn.textContent = 'Debug';
            rawBtn.addEventListener('click', async () => copyRawBody(encodedBody, rawBtn));
        }
    });
});
