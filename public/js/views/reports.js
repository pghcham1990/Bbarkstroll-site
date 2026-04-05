/* ── Reports View ─────────────────────────────────────────────── */

async function render_reports(el) {
  const currentYear = new Date().getFullYear();

  el.innerHTML = `
    <p class="section-label">Financial</p>
    <h1 class="section-title">Reports</h1>
    <div id="reportsList" class="reports-list"></div>
  `;

  let templates = [];
  try {
    templates = await api('/reports/templates?source=barkstroll');
  } catch (e) {
    el.querySelector('#reportsList').innerHTML = '<div class="empty"><div class="empty-text">Failed to load reports</div></div>';
    return;
  }

  if (!templates.length) {
    el.querySelector('#reportsList').innerHTML = '<div class="empty"><div class="empty-text">No reports available</div></div>';
    return;
  }

  const container = el.querySelector('#reportsList');
  container.innerHTML = templates.map(t => {
    const params = JSON.parse(t.parameters || '[]');
    const hasYear = params.some(p => p.name === 'year');

    return `
    <div class="glass-panel" style="margin-bottom:16px;">
      <div class="glass-panel-header">
        <h3 class="glass-panel-title">${esc(t.name)}</h3>
      </div>
      <div class="glass-panel-body">
        <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;">${esc(t.description || '')}</p>
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
          ${hasYear ? `
          <div>
            <label style="font-size:12px;color:var(--text-soft);display:block;margin-bottom:4px;">Year</label>
            <select id="reportYear_${t.slug}" style="padding:8px 12px;border-radius:var(--radius-sm);border:1px solid rgba(20,97,58,0.15);font-size:14px;background:#fff;">
              ${buildYearOptions(currentYear)}
            </select>
          </div>` : ''}
          <div>
            <label style="font-size:12px;color:var(--text-soft);display:block;margin-bottom:4px;">Send To</label>
            <input type="text" id="reportRecipients_${t.slug}" value="scott.rocca.pa@gmail.com"
              style="padding:8px 12px;border-radius:var(--radius-sm);border:1px solid rgba(20,97,58,0.15);font-size:13px;width:260px;">
          </div>
          <button onclick="runReport('${t.slug}')"
            style="padding:10px 24px;background:var(--forest);color:#fff;border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">
            Run Report
          </button>
        </div>
        <div id="reportProgress_${t.slug}" style="margin-top:16px;display:none;"></div>
        <div id="reportResult_${t.slug}" style="margin-top:12px;display:none;"></div>
      </div>
    </div>`;
  }).join('');
}

function buildYearOptions(current) {
  let opts = '';
  for (let y = current; y >= current - 3; y--) {
    opts += `<option value="${y}"${y === current ? ' selected' : ''}>${y}</option>`;
  }
  return opts;
}

async function runReport(slug) {
  const yearEl = document.getElementById('reportYear_' + slug);
  const recipEl = document.getElementById('reportRecipients_' + slug);
  const progressEl = document.getElementById('reportProgress_' + slug);
  const resultEl = document.getElementById('reportResult_' + slug);

  const year = yearEl ? parseInt(yearEl.value) : new Date().getFullYear();
  const recipients = recipEl.value.split(',').map(s => s.trim()).filter(Boolean);

  progressEl.style.display = 'block';
  progressEl.innerHTML = '<div class="report-log" style="background:#1a1a18;color:#c8c8c0;border-radius:var(--radius-sm);padding:12px 16px;font-family:monospace;font-size:12px;max-height:250px;overflow-y:auto;line-height:1.8;"></div>';
  resultEl.style.display = 'none';
  const logEl = progressEl.querySelector('.report-log');

  function appendLog(text, color) {
    const line = document.createElement('div');
    line.style.color = color || '#c8c8c0';
    line.textContent = '> ' + text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  appendLog('Starting report generation...', '#8fbc8f');

  try {
    const response = await fetch('/admin/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: slug,
        parameters: { year },
        recipients
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));

          if (evt.step === 'error') {
            appendLog('ERROR: ' + evt.message, '#e74c3c');
          } else if (evt.step === 'complete') {
            appendLog('Report generated successfully!', '#8fbc8f');
            let meta;
            try { meta = JSON.parse(evt.message); } catch(e) { meta = null; }
            if (meta && meta.previewUrl) {
              const preview = '/admin' + meta.previewUrl;
              const pdf = '/admin' + meta.pdfUrl;
              resultEl.style.display = 'block';
              resultEl.innerHTML = `
                <div style="display:flex;gap:12px;">
                  <a href="${preview}" target="_blank" style="padding:8px 16px;background:var(--forest);color:#fff;border-radius:var(--radius-sm);text-decoration:none;font-size:13px;font-weight:600;">View Report</a>
                  <a href="${pdf}" target="_blank" style="padding:8px 16px;background:var(--gold);color:#fff;border-radius:var(--radius-sm);text-decoration:none;font-size:13px;font-weight:600;">Download PDF</a>
                </div>`;
            }
          } else if (evt.step === 'emailed') {
            appendLog(evt.message, '#d4a843');
          } else {
            appendLog(evt.message, '#c8c8c0');
          }
        } catch (e) { /* skip malformed lines */ }
      }
    }
  } catch (err) {
    appendLog('Connection error: ' + err.message, '#e74c3c');
  }
}
