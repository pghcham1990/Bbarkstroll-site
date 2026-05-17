/* === Applicants View === */

const APPLICANT_STATUS_LABELS = {
  new: 'New',
  reviewed: 'Reviewed',
  finalist: 'Finalist',
  bgcheck_sent: 'Background check sent',
  hired: 'Hired',
  rejected: 'Rejected'
};

const APPLICANT_STATUS_COLORS = {
  new: '#c9a55b',
  reviewed: '#5a8fc4',
  finalist: '#14613a',
  bgcheck_sent: '#a070c0',
  hired: '#2a7d3f',
  rejected: '#888'
};

function fmtRelDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function render_applicants(container) {
  container.innerHTML = '<div class="view-header"><h2 style="margin:0;font-size:20px">Applicants</h2><p style="margin:4px 0 18px;color:#888;font-size:13px">Walker applications from the public /join page.</p></div><div id="applicants-list">Loading...</div>';

  try {
    const data = await api('/applicants');
    const apps = data.applicants || [];
    const list = document.getElementById('applicants-list');
    if (!apps.length) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No applications yet.</div></div>';
      return;
    }
    list.innerHTML = '<div class="applicants-grid" style="display:grid;gap:10px">' +
      apps.map(a => renderApplicantCard(a)).join('') +
      '</div>';
    apps.forEach(a => {
      const el = document.getElementById('app-card-' + a.id);
      if (el) el.onclick = () => openApplicantModal(a.id);
    });
  } catch (e) {
    document.getElementById('applicants-list').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}

function renderApplicantCard(a) {
  const color = APPLICANT_STATUS_COLORS[a.status] || '#888';
  const label = APPLICANT_STATUS_LABELS[a.status] || a.status;
  return `
    <div class="card" id="app-card-${a.id}" style="cursor:pointer;background:#fff;border:1px solid #e8e8e5;border-radius:8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:14px">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:15px;color:#222">${esc(a.full_name)}${a.preferred_name ? ' <span style="color:#888;font-weight:400">(' + esc(a.preferred_name) + ')</span>' : ''}</div>
        <div style="color:#888;font-size:12px;margin-top:2px">${esc(a.closest_area || '')} · ${esc(a.hours_hoping || '')} hrs/wk · ${fmtRelDate(a.created_at)}</div>
      </div>
      <div style="display:inline-block;padding:3px 10px;border-radius:60px;background:${color};color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;flex-shrink:0">${esc(label)}</div>
    </div>
  `;
}

async function openApplicantModal(id) {
  try {
    const data = await api('/applicants/' + id);
    const a = data.applicant;
    const days = JSON.parse(a.days_available || '[]').join(', ') || '—';
    const times = JSON.parse(a.time_windows || '[]').join(', ') || '—';
    const sizes = JSON.parse(a.sizes_ok || '[]').join(', ') || '—';

    const rows = [
      ['Email', '<a href="mailto:' + esc(a.email) + '">' + esc(a.email) + '</a>'],
      ['Phone', '<a href="tel:' + esc(a.phone) + '">' + esc(fmtPhone(a.phone)) + '</a>'],
      ['ZIP', esc(a.zip)],
      ['Area', esc(a.closest_area)],
      ['Days', esc(days)],
      ['Times', esc(times)],
      ['Hours hoping', esc(a.hours_hoping)],
      ['Transport', a.has_transport ? 'Yes' : 'No'],
      ['Owned dogs', a.owned_dogs ? 'Yes' : 'No'],
      ['Sizes OK', esc(sizes)],
      ['Not comfortable with', esc(a.uncomfortable || '—')],
      ['Allergies', esc(a.allergies || '—')]
    ];

    const refsBlock = a.refs_on_request
      ? '<p style="color:#888;font-style:italic;font-size:13px">Will provide references on request.</p>'
      : `<table style="width:100%;font-size:13px">
          <tr><td style="color:#888;width:120px;padding:4px 0">Ref 1</td><td>${esc(a.ref1_name || '—')} · ${esc(a.ref1_phone || '')} · ${esc(a.ref1_relation || '')}</td></tr>
          <tr><td style="color:#888;padding:4px 0">Ref 2</td><td>${esc(a.ref2_name || '—')} · ${esc(a.ref2_phone || '')} · ${esc(a.ref2_relation || '')}</td></tr>
        </table>`;

    const statusOptions = Object.keys(APPLICANT_STATUS_LABELS).map(s =>
      `<option value="${s}"${s === a.status ? ' selected' : ''}>${APPLICANT_STATUS_LABELS[s]}</option>`
    ).join('');

    const sendBgBtn = (a.status === 'finalist' && !a.bgcheck_sent_at)
      ? '<button id="sendBgcheckBtn" type="button" style="margin-left:8px;padding:7px 14px;background:#a070c0;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Send FCRA disclosure email</button>'
      : (a.bgcheck_sent_at ? '<span style="margin-left:8px;font-size:12px;color:#888">FCRA email sent ' + fmtRelDate(a.bgcheck_sent_at) + '</span>' : '');

    openModal(`
      <button class="modal-close" type="button">×</button>
      <h2 style="margin:0 0 4px;font-size:20px">${esc(a.full_name)}${a.preferred_name ? ' <span style="color:#888;font-weight:400;font-size:16px">(' + esc(a.preferred_name) + ')</span>' : ''}</h2>
      <p style="color:#888;font-size:12px;margin:0 0 18px">Submitted ${fmtRelDate(a.created_at)} · ID ${a.id}</p>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;padding:12px;background:#fafaf6;border-radius:8px;flex-wrap:wrap">
        <label style="font-size:12px;color:#666;font-weight:600">Status:</label>
        <select id="applicantStatus" style="padding:6px 10px;border:1px solid #d8d0bd;border-radius:6px;font-size:13px">${statusOptions}</select>
        ${sendBgBtn}
      </div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:18px">
        ${rows.map(r => `<tr><td style="padding:5px 8px 5px 0;color:#888;width:140px;vertical-align:top">${esc(r[0])}</td><td style="padding:5px 0;color:#222">${r[1]}</td></tr>`).join('')}
      </table>

      <h3 style="font-size:13px;color:#14613a;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">Why interested</h3>
      <p style="margin:0;font-size:14px;line-height:1.6">${esc(a.why_interested || '')}</p>

      <h3 style="font-size:13px;color:#14613a;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">Experience note</h3>
      <p style="margin:0;font-size:14px;line-height:1.6">${esc(a.experience_note || '—')}</p>

      <h3 style="font-size:13px;color:#14613a;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">Tricky situation</h3>
      <p style="margin:0;font-size:14px;line-height:1.6">${esc(a.tricky_situation || '')}</p>

      <h3 style="font-size:13px;color:#14613a;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">References</h3>
      ${refsBlock}

      <h3 style="font-size:13px;color:#14613a;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">Scott's notes</h3>
      <textarea id="applicantNotes" style="width:100%;min-height:80px;padding:8px;border:1px solid #d8d0bd;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical">${esc(a.scott_notes || '')}</textarea>

      <div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end">
        <button id="applicantSave" type="button" style="padding:9px 18px;background:#14613a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Save changes</button>
      </div>
    `);

    document.getElementById('applicantSave').onclick = async () => {
      try {
        const newStatus = document.getElementById('applicantStatus').value;
        const newNotes = document.getElementById('applicantNotes').value;
        await api('/applicants/' + id, { method: 'PATCH', body: { status: newStatus, scott_notes: newNotes } });
        toast('Saved', 'ok');
        closeModal();
        render_applicants(App.content);
      } catch (e) {
        toast('Save failed: ' + e.message, 'err');
      }
    };

    const bgBtn = document.getElementById('sendBgcheckBtn');
    if (bgBtn) {
      bgBtn.onclick = async () => {
        if (!confirm('Send the FCRA background-check disclosure email to ' + a.email + '?')) return;
        bgBtn.disabled = true;
        bgBtn.textContent = 'Sending...';
        try {
          await api('/applicants/' + id + '/send-bgcheck', { method: 'POST' });
          toast('FCRA disclosure sent to ' + a.email, 'ok');
          closeModal();
          render_applicants(App.content);
        } catch (e) {
          toast('Send failed: ' + e.message, 'err');
          bgBtn.disabled = false;
          bgBtn.textContent = 'Send FCRA disclosure email';
        }
      };
    }
  } catch (e) {
    toast('Failed to load applicant: ' + e.message, 'err');
  }
}

window.render_applicants = render_applicants;
