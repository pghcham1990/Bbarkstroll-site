// Job staffing panel — rendered into #jobPanelMount on the customer card.
// Uses global helpers api(), toast(), esc() from app.js.
let _jobState = { customerId: null, documentId: null, view: null, employees: [] };

async function openJobPanel(customerId, documentId) {
  _jobState.customerId = customerId;
  _jobState.documentId = documentId;
  try {
    if (!_jobState.employees.length) _jobState.employees = await api('/employees');
    let view = await api('/jobs/by-document/' + documentId);
    if (!view) {
      view = await api('/jobs', { method: 'POST', body: { customer_id: customerId, document_id: documentId } });
    }
    _jobState.view = view;
    renderJobPanel();
    const mount = document.getElementById('jobPanelMount');
    if (mount) mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast('Could not open job: ' + e.message, 'err'); }
}

function jobWalkerOptions(selected) {
  const opts = ['<option value="">— open —</option>'];
  for (const e of _jobState.employees.filter(e => e.active)) {
    const name = esc(e.first_name + ' ' + e.last_name);
    opts.push(`<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${name}</option>`);
  }
  return opts.join('');
}

function fmtJobDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderJobPanel() {
  const mount = document.getElementById('jobPanelMount');
  if (!mount || !_jobState.view) return;
  const { job, assignments, fill } = _jobState.view;
  const posted = job.status === 'posted';

  const rows = assignments.map(a => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #eee">
      <div style="width:120px;font-weight:600">${esc(fmtJobDate(a.date))}</div>
      <div style="flex:1;color:#666;font-size:13px">${esc((a.times || []).join(' · '))}</div>
      <div>
        ${posted
          ? `<span>${esc(a.employee_name || '—')}</span>`
          : `<select onchange="assignJobDay('${esc(a.date)}', this.value)" style="padding:4px">${jobWalkerOptions(a.employee_id)}</select>`}
      </div>
      <div style="width:24px;text-align:center" title="${a.conflict ? 'This walker has another visit that day' : ''}">
        ${a.employee_id ? (a.conflict ? '⚠️' : '✓') : ''}
      </div>
    </div>
  `).join('');

  const bulk = posted ? '' : `
    <div style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-size:13px;color:#666">Assign all open days to:</span>
      <select id="bulkJobWalker" style="padding:4px">${jobWalkerOptions(null)}</select>
      <button class="btn btn-outline btn-sm" onclick="assignJobAllOpen()">Apply</button>
    </div>`;

  const footer = posted
    ? `<p style="margin-top:10px;color:#3a5c3a;font-size:13px">✓ Appointments created. Google Calendar sync pending (push via connector).</p>`
    : `<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
         <span style="font-size:13px;color:#666">${fill.open ? fill.open + ' day(s) still open' : 'All days staffed — ready to post'}</span>
         <button class="btn btn-primary btn-sm" onclick="postJobNow()" ${fill.complete ? '' : 'disabled'}>Post job →</button>
       </div>`;

  mount.innerHTML = `
    <div class="detail-section" style="margin-top:14px;border:1px solid #e2ddd5;border-radius:6px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="detail-section-title">🗂 Job — ${posted ? 'Posted ✓' : 'Staffing'}</span>
        <span style="font-size:13px;color:${fill.complete ? '#3a5c3a' : '#a06b00'}">${fill.filled} of ${fill.total} days · ${fill.percent}%</span>
      </div>
      <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${fill.percent}%;background:${fill.complete ? '#3a5c3a' : '#c8a84b'}"></div>
      </div>
      ${bulk}
      ${rows}
      ${footer}
      <div id="jobSummaryMount"></div>
    </div>`;
}

async function assignJobDay(date, value) {
  try {
    _jobState.view = await api('/jobs/' + _jobState.view.job.id + '/assignments', {
      method: 'PATCH', body: { date, employee_id: value ? Number(value) : null },
    });
    renderJobPanel();
  } catch (e) { toast('Assign failed: ' + e.message, 'err'); }
}

async function assignJobAllOpen() {
  const el = document.getElementById('bulkJobWalker');
  const v = el && el.value;
  if (!v) { toast('Pick a walker first', 'err'); return; }
  try {
    _jobState.view = await api('/jobs/' + _jobState.view.job.id + '/assign-all', { method: 'POST', body: { employee_id: Number(v) } });
    renderJobPanel();
  } catch (e) { toast('Assign-all failed: ' + e.message, 'err'); }
}

async function postJobNow() {
  if (!confirm('Post this job? This creates the appointments. Walkers will be summarized for you to text.')) return;
  try {
    const result = await api('/jobs/' + _jobState.view.job.id + '/post', { method: 'POST', body: {} });
    _jobState.view = await api('/jobs/' + _jobState.view.job.id);
    renderJobPanel();
    showWalkerSummary(result.walkerSummary);
    toast('Job posted — appointments created');
  } catch (e) { toast('Post failed: ' + e.message, 'err'); }
}

function showWalkerSummary(summary) {
  const lines = (summary || []).map(w => {
    const days = w.days.map(d => `  ${fmtJobDate(d.date)}: ${d.times.join(', ')}`).join('\n');
    return `${w.employee_name}:\n${days}`;
  }).join('\n\n');
  const text = `Bark & Stroll — walker assignments\n\n${lines}`;
  const host = document.getElementById('jobSummaryMount');
  if (!host) return;
  // Build with safe DOM nodes (no untrusted innerHTML).
  host.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'detail-section';
  box.style = 'margin-top:10px;border:1px solid #c8a84b;border-radius:6px;padding:12px';
  const title = document.createElement('div');
  title.className = 'detail-section-title';
  title.textContent = '📋 Walker summary (copy & text to each walker)';
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.style = 'width:100%;height:160px;margin-top:8px;font-family:monospace;font-size:12px';
  ta.value = text;
  box.appendChild(title);
  box.appendChild(ta);
  host.appendChild(box);
}
