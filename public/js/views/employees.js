/* === Employees View === */

const _teamColors = [
  { bg: 'rgba(196,164,78,0.15)', text: '#c4a44e', border: 'rgba(196,164,78,0.3)' },
  { bg: 'rgba(46,204,113,0.15)', text: '#2ecc71', border: 'rgba(46,204,113,0.3)' },
  { bg: 'rgba(52,152,219,0.15)', text: '#3498db', border: 'rgba(52,152,219,0.3)' },
  { bg: 'rgba(155,89,182,0.15)', text: '#9b59b6', border: 'rgba(155,89,182,0.3)' },
  { bg: 'rgba(230,126,34,0.15)', text: '#e67e22', border: 'rgba(230,126,34,0.3)' },
];

function getTeamColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return _teamColors[Math.abs(hash) % _teamColors.length];
}

async function render_employees(el) {
  el.innerHTML = `
    <p class="section-label">Manage</p>
    <h1 class="section-title">Team</h1>
    <div id="empList"></div>
  `;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+';
  fab.title = 'Add Team Member';
  fab.onclick = () => openEmployeeForm();
  document.body.appendChild(fab);

  loadEmployees();
}

async function loadEmployees() {
  try {
    const employees = await api('/employees');
    const container = document.getElementById('empList');
    if (!employees.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🐕</div><div class="empty-text">No team members yet</div></div>';
      return;
    }
    container.innerHTML = '<div class="team-grid">' + employees.map(e => {
      const fullName = (e.first_name || '') + ' ' + (e.last_name || '');
      const initials = ((e.first_name || '')[0] || '') + ((e.last_name || '')[0] || '');
      const color = getTeamColor(fullName);
      const isCore = e.crew_type === 'core';
      const crewTag = isCore
        ? '<div class="crew-tag crew-core" title="Founding crew that built this. Informal/cash, not 1099.">⚒️ Original Crew</div>'
        : '<div class="crew-tag crew-1099" title="Background-checked, signed contractor agreement. Issued a 1099 if paid $600+ in a year.">📄 1099 Contractor</div>';

      // Contractors: show progress toward the $600 IRS 1099-NEC reporting threshold.
      let irsBlock = '';
      if (!isCore) {
        const paid = e.ytd_paid || 0;
        const pct = Math.min(100, Math.round((paid / 600) * 100));
        const over = e.over_1099_threshold;
        irsBlock = `
          <div class="irs-block ${over ? 'irs-over' : ''}">
            <div class="irs-line"><span>${e.ytd_visits || 0} visits · $${paid} YTD</span><span>$600</span></div>
            <div class="irs-bar"><div class="irs-fill" style="width:${pct}%"></div></div>
            <div class="irs-note">${over ? '🚩 Over $600 — issue a 1099-NEC for this year' : `$${600 - paid} until 1099 reporting`}</div>
          </div>`;
      }

      return `
        <div class="team-card${!e.active ? ' inactive' : ''}">
          <div class="team-avatar" style="background:${color.bg};color:${color.text};border-color:${color.border}">${esc(initials.toUpperCase())}</div>
          <div class="team-name">${esc(e.first_name)} ${esc(e.last_name)}</div>
          <div class="team-contact">${fmtPhone(e.phone) || e.email || 'No contact info'}</div>
          ${crewTag}
          ${e.has_w9 ? '<div class="crew-tag" style="background:#e7f3ec;color:#14613a" title="W-9 on file">📄 W-9 on file ✓</div>' : ''}
          ${e.pay_method ? `<div class="crew-tag" style="background:#eef2fb;color:#3b5bb0" title="Preferred payout method for the $20-per-visit pay">💸 Pays via ${esc(e.pay_method)}</div>` : ''}
          ${irsBlock}
          ${(() => {
            if (isCore) return ''; // profitability tracking is 1099-contractor-only
            const p = e.pnl || { money_made: 0, onboarding_cost: 0, visits: 0, paid_off: false };
            const made = p.money_made || 0;
            const cost = p.onboarding_cost || 0;
            const paidOff = !!p.paid_off;
            const $ = (n) => '$' + Math.round(n).toLocaleString();
            if (!paidOff) {
              // Phase 1: paying off the onboarding cost. Bar fills as money-made approaches the cost.
              const pct = cost > 0 ? Math.max(0, Math.min(100, Math.round((Math.max(0, made) / cost) * 100))) : 0;
              return `
          <div class="pnl-block pnl-red">
            <div class="pnl-line"><span>🔴 Paying off cost</span><span>${$(Math.max(0, made))} of ${$(cost)}</span></div>
            <div class="pnl-bar"><div class="pnl-fill" style="width:${pct}%"></div></div>
            <div class="pnl-note">${p.visits} walk${p.visits === 1 ? '' : 's'} · ${$(Math.max(0, cost - made))} left to clear her cost</div>
          </div>`;
            }
            // Phase 2: paid off — now a profitable asset. Show total money made, growing toward the next milestone.
            const milestone = Math.max(100, Math.ceil((made + 1) / 100) * 100);
            const pct = Math.max(3, Math.round((made / milestone) * 100));
            return `
          <div class="pnl-block pnl-green">
            <div class="pnl-line"><span>💰 Money made</span><span class="pnl-big">${$(made)}</span></div>
            <div class="pnl-bar"><div class="pnl-fill" style="width:${pct}%"></div></div>
            <div class="pnl-note">Paid off ✓ · ${p.visits} walks · climbing to ${$(milestone)}</div>
          </div>`;
          })()}
          <div class="team-status ${e.active ? 'active' : 'inactive'}">${e.active ? 'Active' : 'Inactive'}</div>
          <div class="team-actions">
            <button class="btn btn-outline btn-sm" onclick="openWalkerDocs(${e.id}, '${esc((e.first_name||'') + ' ' + (e.last_name||'')).replace(/'/g, "\\'")}')">📁 Documents</button>
            <button class="btn btn-outline btn-sm" onclick="openEmployeeForm(${e.id})">Edit</button>
            ${e.active ? `<button class="btn btn-danger btn-sm" onclick="deactivateEmployee(${e.id})">Deactivate</button>` : ''}
          </div>
        </div>
      `;
    }).join('') + '</div>';
  } catch (e) { toast(e.message, 'err'); }
}

function openEmployeeForm(id) {
  const isEdit = !!id;
  const load = isEdit ? api('/employees/' + id) : Promise.resolve({});
  load.then(e => {
    openModal(`
      <div class="modal-header"><h2>${isEdit ? 'Edit' : 'New'} Team Member</h2><button class="modal-close">&times;</button></div>
      <form id="empForm">
        <div class="form-row">
          <div class="form-group"><label>First Name *</label><input name="first_name" value="${esc(e.first_name || '')}" required></div>
          <div class="form-group"><label>Last Name *</label><input name="last_name" value="${esc(e.last_name || '')}" required></div>
        </div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(e.email || '')}"></div>
        <div class="form-group"><label>Phone</label><input name="phone" type="tel" value="${esc(e.phone || '')}"></div>
        <div class="form-group">
          <label>Classification</label>
          <select name="crew_type">
            <option value="contractor" ${e.crew_type !== 'core' ? 'selected' : ''}>1099 Contractor (background check + signed agreement)</option>
            <option value="core" ${e.crew_type === 'core' ? 'selected' : ''}>Original Crew (founding, informal)</option>
          </select>
          <small style="color:var(--text-soft);font-size:.68rem;display:block;margin-top:.25rem">New hires are 1099 contractors. 1099-NEC issued if paid $600+ in a year.</small>
        </div>
        <div class="form-group"><label>Onboarding cost ($)</label><input name="onboarding_cost" type="number" step="0.01" min="0" value="${e.onboarding_cost != null ? e.onboarding_cost : ''}" placeholder="e.g. 75 for background check"><small style="color:var(--text-soft);font-size:.68rem;display:block;margin-top:.25rem">What this hire cost you up front (background check, etc). They show a red bar until their walks earn it back, then flip green.</small></div>
        <div class="form-group">
          <label>Preferred payout method</label>
          <select name="pay_method">
            ${(() => {
              const opts = ['', 'Venmo', 'Zelle', 'PayPal', 'Cash App', 'Cash', 'Direct deposit', 'Check'];
              const cur = e.pay_method || '';
              if (cur && !opts.includes(cur)) opts.push(cur);
              return opts.map(o => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${o === '' ? '— none set —' : esc(o)}</option>`).join('');
            })()}
          </select>
          <small style="color:var(--text-soft);font-size:.68rem;display:block;margin-top:.25rem">How they want their $20-per-visit pay sent. Shows as a badge on their card.</small>
        </div>
        ${isEdit ? `<div class="form-group"><label>Status</label><select name="active"><option value="1" ${e.active ? 'selected' : ''}>Active</option><option value="0" ${!e.active ? 'selected' : ''}>Inactive</option></select></div>` : ''}
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Member'}</button>
        </div>
      </form>
    `);
    document.getElementById('empForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd);
      try {
        if (isEdit) await api('/employees/' + id, { method: 'PUT', body });
        else await api('/employees', { method: 'POST', body });
        closeModal();
        toast(isEdit ? 'Team member updated' : 'Team member added');
        loadEmployees();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function deactivateEmployee(id) {
  if (!await confirmDialog('Deactivate this team member?')) return;
  try {
    await api('/employees/' + id, { method: 'DELETE' });
    toast('Team member deactivated');
    loadEmployees();
  } catch (e) { toast(e.message, 'err'); }
}

async function openWalkerDocs(id, name) {
  openModal(`
    <div class="modal-header"><h2>Documents — ${esc(name)}</h2><button class="modal-close">&times;</button></div>
    <div id="walkerDocsList">Loading...</div>
    <form id="walkerDocForm" style="margin-top:1rem;border-top:1px solid var(--border,#e2ddd5);padding-top:1rem">
      <div class="form-group">
        <label>Upload W-9 (PDF, JPG, or PNG)</label>
        <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required>
        <small style="display:block;color:var(--text-soft);font-size:.68rem;margin-top:.25rem">Stored encrypted. Only visible when you are logged in.</small>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Upload W-9</button>
      </div>
    </form>
  `);
  refreshWalkerDocs(id);
  document.getElementById('walkerDocForm').onsubmit = (ev) => uploadWalkerDoc(ev, id);
}

async function refreshWalkerDocs(id) {
  const el = document.getElementById('walkerDocsList');
  try {
    const docs = await api('/employees/' + id + '/documents');
    if (!docs.length) { el.innerHTML = '<p style="color:var(--text-soft)">No documents yet.</p>'; return; }
    el.innerHTML = docs.map(d => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--border,#eee)">
        <div>
          <span class="crew-tag" style="background:#e7f3ec;color:#14613a">📄 W-9</span>
          <span style="margin-left:.4rem">${esc(d.original_name)}</span>
          <small style="display:block;color:var(--text-soft)">${esc(d.uploaded_at)}</small>
        </div>
        <div style="display:flex;gap:.35rem">
          <a class="btn btn-outline btn-sm" href="/admin/api/employees/${id}/documents/${d.id}/file?disposition=inline" target="_blank" rel="noopener">View</a>
          <a class="btn btn-outline btn-sm" href="/admin/api/employees/${id}/documents/${d.id}/file?disposition=attachment">Download</a>
          <button class="btn btn-danger btn-sm" onclick="deleteWalkerDoc(${id}, ${d.id})">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = '<p style="color:#b04848">' + esc(e.message) + '</p>'; }
}

async function uploadWalkerDoc(ev, id) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    const res = await fetch('/admin/api/employees/' + id + '/documents', { method: 'POST', body: fd });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Upload failed'); }
    ev.target.reset();
    toast('W-9 uploaded');
    refreshWalkerDocs(id);
    loadEmployees();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteWalkerDoc(id, docId) {
  if (!await confirmDialog('Delete this document?')) return;
  try {
    await api('/employees/' + id + '/documents/' + docId, { method: 'DELETE' });
    toast('Document deleted');
    refreshWalkerDocs(id);
    loadEmployees();
  } catch (e) { toast(e.message, 'err'); }
}
