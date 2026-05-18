/* === Applicants View === */

const APPLICANT_STATUS_LABELS = {
  lead: 'Lead (no form yet)',
  new: 'New',
  reviewed: 'Reviewed',
  finalist: 'Finalist',
  bgcheck_sent: 'Background check sent',
  hired: 'Hired',
  rejected: 'Rejected'
};

const APPLICANT_STATUS_COLORS = {
  lead: '#9a8a6a',
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
  container.innerHTML = `
    <div class="view-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div>
        <h2 style="margin:0;font-size:20px">Applicants</h2>
        <p style="margin:4px 0 18px;color:#888;font-size:13px">Walker applications from /join, plus leads added manually.</p>
      </div>
      <button id="addLeadBtn" type="button" style="padding:8px 14px;background:#14613a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">+ Add lead</button>
    </div>
    <div id="applicants-list">Loading...</div>
  `;

  document.getElementById('addLeadBtn').onclick = openAddLeadModal;

  try {
    const data = await api('/applicants');
    const apps = data.applicants || [];
    const list = document.getElementById('applicants-list');
    if (!apps.length) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No applications or leads yet. Use + Add lead to drop someone in manually.</div></div>';
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

function openAddLeadModal() {
  openModal(`
    <button class="modal-close" type="button">×</button>
    <h2 style="margin:0 0 4px;font-size:20px">Add a lead</h2>
    <p style="color:#888;font-size:12px;margin:0 0 18px">For people you've heard from but who haven't filled out /join yet. When they fill the form, this row auto-fills with their full details.</p>

    <label style="display:block;font-size:12px;color:#666;font-weight:600;margin-bottom:4px">Full name</label>
    <input type="text" id="leadName" style="width:100%;padding:8px 10px;border:1px solid #d8d0bd;border-radius:6px;font-size:14px;margin-bottom:12px">

    <label style="display:block;font-size:12px;color:#666;font-weight:600;margin-bottom:4px">Email</label>
    <input type="email" id="leadEmail" style="width:100%;padding:8px 10px;border:1px solid #d8d0bd;border-radius:6px;font-size:14px;margin-bottom:12px">

    <label style="display:block;font-size:12px;color:#666;font-weight:600;margin-bottom:4px">Phone (optional)</label>
    <input type="tel" id="leadPhone" style="width:100%;padding:8px 10px;border:1px solid #d8d0bd;border-radius:6px;font-size:14px;margin-bottom:12px">

    <label style="display:block;font-size:12px;color:#666;font-weight:600;margin-bottom:4px">Source / notes (optional)</label>
    <textarea id="leadNotes" placeholder="e.g., emailed me from the South Fayette FB group on 5/17, stay-at-home mom" style="width:100%;min-height:70px;padding:8px;border:1px solid #d8d0bd;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical"></textarea>

    <div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end">
      <button id="leadSave" type="button" style="padding:9px 18px;background:#14613a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Save lead</button>
    </div>
  `);

  setTimeout(() => document.getElementById('leadName').focus(), 100);

  document.getElementById('leadSave').onclick = async () => {
    const name = document.getElementById('leadName').value.trim();
    const email = document.getElementById('leadEmail').value.trim();
    const phone = document.getElementById('leadPhone').value.trim();
    const notes = document.getElementById('leadNotes').value.trim();
    if (!name) return toast('Name required', 'err');
    if (!email) return toast('Email required', 'err');
    try {
      await api('/applicants/lead', { method: 'POST', body: { full_name: name, email, phone, scott_notes: notes } });
      toast('Lead added', 'ok');
      closeModal();
      render_applicants(App.content);
    } catch (e) {
      toast('Save failed: ' + e.message, 'err');
    }
  };
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

const PIPELINE = [
  { key: 'new',           label: 'New' },
  { key: 'reviewed',      label: 'Reviewed' },
  { key: 'finalist',      label: 'Finalist' },
  { key: 'bgcheck_sent',  label: 'Bg Check' },
  { key: 'hired',         label: 'Hired' }
];

function pipelineIndex(status) {
  const i = PIPELINE.findIndex(s => s.key === status);
  return i;
}

function renderStepper(status) {
  const cur = pipelineIndex(status);
  const isRejected = status === 'rejected';
  const isLead = status === 'lead';

  const dots = PIPELINE.map((s, i) => {
    let bg = '#dcd6c4', fg = '#fff', ring = 'transparent';
    if (!isRejected && !isLead) {
      if (i < cur)       { bg = '#2a7d3f'; }
      else if (i === cur){ bg = '#c9a55b'; ring = '#f4dfa6'; }
    }
    return `
      <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
        <div style="width:30px;height:30px;border-radius:50%;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;box-shadow:${ring === 'transparent' ? 'none' : '0 0 0 4px ' + ring}">${i < cur && !isRejected && !isLead ? '✓' : (i + 1)}</div>
        <div style="font-size:11px;color:#666;margin-top:5px;text-align:center;white-space:nowrap">${s.label}</div>
      </div>`;
  }).join('<div style="flex:0 0 14px;height:2px;background:#dcd6c4;margin:14px 0 0;align-self:flex-start"></div>');

  let banner = '';
  if (isRejected) banner = `<div style="margin-top:10px;padding:8px 12px;background:#f3f3f3;border-radius:6px;font-size:12px;color:#666;text-align:center">Rejected · pipeline halted</div>`;
  if (isLead)     banner = `<div style="margin-top:10px;padding:8px 12px;background:#fdf4e0;border-radius:6px;font-size:12px;color:#8a6d2a;text-align:center">Lead · waiting for them to fill out /join</div>`;

  return `
    <div style="padding:14px 6px 4px;background:#fafaf6;border-radius:8px;margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;padding:0 8px">${dots}</div>
      ${banner}
    </div>`;
}

function renderActionPanel(a) {
  const s = a.status;
  if (s === 'lead') {
    return {
      title: 'Pre-pipeline · waiting on /join form',
      desc: "They haven't filled out the public application yet. Send them <a href=\"https://barkstroll.com/join\" target=\"_blank\" style=\"color:#14613a\">barkstroll.com/join</a> if you haven't already. When they submit, this row auto-fills and moves to step 1.",
      button: null,
      reject: true
    };
  }
  if (s === 'new') {
    return {
      title: 'Step 1 of 5 · New application',
      desc: "I've read the application and want to keep them in the pipeline for further consideration.",
      button: { label: 'Mark as reviewed', color: '#5a8fc4', action: 'set_status', value: 'reviewed' },
      reject: true
    };
  }
  if (s === 'reviewed') {
    return {
      title: 'Step 2 of 5 · Reviewed',
      desc: "I want to seriously consider hiring them. Moving them to Finalist unlocks the FCRA background-check step.",
      button: { label: 'Move to finalist', color: '#14613a', action: 'set_status', value: 'finalist' },
      reject: true
    };
  }
  if (s === 'finalist') {
    return {
      title: 'Step 3 of 5 · Finalist',
      desc: "Send the FCRA pre-disclosure email to " + esc(a.email) + ". This is a federal requirement before pulling any background report. Stamps the send time and moves them to step 4.",
      button: { label: 'Send FCRA disclosure email', color: '#a070c0', action: 'send_bgcheck' },
      reject: true
    };
  }
  if (s === 'bgcheck_sent') {
    return {
      title: 'Step 4 of 5 · Background check in progress',
      desc: "FCRA disclosure sent " + fmtRelDate(a.bgcheck_sent_at) + ". Once the background report comes back, pick the path that matches the result.",
      fork: [
        { label: 'Report came back clean → Hire', color: '#2a7d3f', action: 'set_status', value: 'hired' },
        { label: 'Report has issues → Start adverse action', color: '#b44a3f', action: 'open_adverse' }
      ],
      reject: true
    };
  }
  if (s === 'hired') {
    return {
      title: 'Step 5 of 5 · Hired ✓',
      desc: "Pipeline complete. Onboarding paperwork lives in their employee record.",
      button: null,
      reject: false
    };
  }
  if (s === 'rejected') {
    return {
      title: 'Rejected',
      desc: "This applicant has been rejected. " + (a.rejected_at ? 'Rejected ' + fmtRelDate(a.rejected_at) + ". " : '') + "Use Manual override below to reinstate if needed.",
      button: null,
      reject: false
    };
  }
  return { title: s, desc: '', button: null, reject: true };
}

function openAdverseActionModal(a) {
  const vendorLine = '[your background check vendor]';
  const preAdverse = `Subject: Notice of preliminary determination - Bark & Stroll application

Dear ${a.full_name},

Bark & Stroll is writing to inform you that we may be unable to proceed with your application for a 1099 dog walker position. Our preliminary decision is based, in whole or in part, on information contained in a consumer report obtained from ${vendorLine}.

A copy of the consumer report is attached to this email, along with a Summary of Your Rights under the Fair Credit Reporting Act (15 U.S.C. § 1681).

You have the right to dispute the accuracy or completeness of any information in the report directly with ${vendorLine}. If you wish to dispute, please do so within five (5) business days of the date of this notice. If we do not hear from you within that period, we may proceed with a final decision based on the report.

If you have questions about this notice, please reply to this email.

Sincerely,
Scott Rocca
Bark & Stroll
scott@barkstroll.com`;

  const adverse = `Subject: Final determination - Bark & Stroll application

Dear ${a.full_name},

We are writing to inform you that Bark & Stroll has made a final decision not to move forward with your application. Our decision was based, in whole or in part, on information contained in a consumer report previously provided to you, which we obtained from ${vendorLine}.

Under the Fair Credit Reporting Act (15 U.S.C. § 1681), you have the following rights:
 • You have the right to obtain a free copy of your consumer report from ${vendorLine} if you request it within 60 days of receiving this notice.
 • You have the right to dispute the accuracy or completeness of any information in the report directly with ${vendorLine}.
 • A copy of the Summary of Your Rights under the FCRA is attached for your reference.

${vendorLine} did not make the hiring decision and is unable to provide the specific reasons for it.

We appreciate your interest in Bark & Stroll and wish you the best.

Sincerely,
Scott Rocca
Bark & Stroll
scott@barkstroll.com`;

  openModal(`
    <button class="modal-close" type="button">×</button>
    <h2 style="margin:0 0 4px;font-size:20px;color:#b44a3f">FCRA Adverse Action Workflow</h2>
    <p style="color:#666;font-size:13px;margin:0 0 16px;line-height:1.5">The background report on <b>${esc(a.full_name)}</b> returned information that may disqualify them. FCRA requires a two-notice process before you can finalize a non-hire decision based on the report. Skipping these steps creates legal exposure ($100-$1,000 per violation plus damages).</p>

    <div style="background:#fafaf6;border-radius:8px;padding:14px;margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;color:#2a7d3f;margin-bottom:4px">✓ Step 1 (already done) — Pre-disclosure</div>
      <div style="font-size:12px;color:#666">FCRA disclosure email sent ${fmtRelDate(a.bgcheck_sent_at)} before the report was pulled.</div>
    </div>

    <div style="background:#fdf4e0;border-radius:8px;padding:14px;margin-bottom:14px;border-left:4px solid #c9a55b">
      <div style="font-weight:700;font-size:13px;color:#8a6d2a;margin-bottom:6px">→ Step 2 (do now) — Pre-adverse action notice</div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">Email this to <b>${esc(a.email)}</b>. Attach a copy of the report and the FTC's "Summary of Your Rights under the FCRA" PDF (free at consumerfinance.gov).</div>
      <textarea readonly style="width:100%;min-height:160px;padding:10px;border:1px solid #d8d0bd;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;background:#fff;resize:vertical">${esc(preAdverse)}</textarea>
      <button id="copyPreAdverse" type="button" style="margin-top:6px;padding:6px 12px;background:#5a8fc4;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Copy pre-adverse template</button>
    </div>

    <div style="background:#f3f3f3;border-radius:8px;padding:14px;margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;color:#666;margin-bottom:4px">→ Step 3 — Wait</div>
      <div style="font-size:12px;color:#666">Give them at least 5 business days to dispute the report before sending the final notice. Best practice is to wait the full 5 days even if they don't respond.</div>
    </div>

    <div style="background:#f3f3f3;border-radius:8px;padding:14px;margin-bottom:14px;border-left:4px solid #b44a3f">
      <div style="font-weight:700;font-size:13px;color:#b44a3f;margin-bottom:6px">→ Step 4 (after the wait) — Adverse action notice + reject</div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">Final notice. Re-attach the report and rights summary. Then click "Mark applicant rejected" below.</div>
      <textarea readonly style="width:100%;min-height:160px;padding:10px;border:1px solid #d8d0bd;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;background:#fff;resize:vertical">${esc(adverse)}</textarea>
      <button id="copyAdverse" type="button" style="margin-top:6px;padding:6px 12px;background:#5a8fc4;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Copy adverse-action template</button>
    </div>

    <div style="margin-top:18px;display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <button id="adverseCancel" type="button" style="padding:9px 14px;background:transparent;color:#666;border:1px solid #d8d0bd;border-radius:6px;font-size:13px;cursor:pointer">Cancel - not ready</button>
      <button id="adverseReject" type="button" style="padding:9px 18px;background:#b44a3f;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Adverse notice sent · Mark applicant rejected</button>
    </div>
  `);

  document.getElementById('copyPreAdverse').onclick = () => { navigator.clipboard.writeText(preAdverse); toast('Pre-adverse template copied', 'ok'); };
  document.getElementById('copyAdverse').onclick   = () => { navigator.clipboard.writeText(adverse);    toast('Adverse template copied', 'ok'); };
  document.getElementById('adverseCancel').onclick = () => { closeModal(); openApplicantModal(a.id); };
  document.getElementById('adverseReject').onclick = async () => {
    if (!confirm('Confirm: the adverse action notice has been sent AND at least 5 business days have passed since the pre-adverse notice. Mark ' + a.full_name + ' as rejected?')) return;
    try {
      await api('/applicants/' + a.id, { method: 'PATCH', body: { status: 'rejected' } });
      toast('Applicant rejected · FCRA workflow complete', 'ok');
      closeModal();
      render_applicants(App.content);
    } catch (e) {
      toast('Failed: ' + e.message, 'err');
    }
  };
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

    const panel = renderActionPanel(a);

    let actionHtml = '';
    if (panel.button) {
      actionHtml = `<button id="primaryAction" type="button" style="width:100%;padding:14px;background:${panel.button.color};color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.02em">NEXT: ${esc(panel.button.label)}</button>`;
    } else if (panel.fork) {
      actionHtml = panel.fork.map((b, i) =>
        `<button id="forkAction_${i}" type="button" style="width:100%;padding:13px;background:${b.color};color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px">${esc(b.label)}</button>`
      ).join('');
    }

    const rejectBtn = panel.reject
      ? `<button id="rejectBtn" type="button" style="padding:8px 14px;background:transparent;color:#b44a3f;border:1px solid #e0b8b3;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Reject applicant</button>`
      : '';

    openModal(`
      <button class="modal-close" type="button">×</button>
      <h2 style="margin:0 0 4px;font-size:20px">${esc(a.full_name)}${a.preferred_name ? ' <span style="color:#888;font-weight:400;font-size:16px">(' + esc(a.preferred_name) + ')</span>' : ''}</h2>
      <p style="color:#888;font-size:12px;margin:0 0 14px">Submitted ${fmtRelDate(a.created_at)} · ID ${a.id}</p>

      ${renderStepper(a.status)}

      <div style="padding:14px;background:#fff;border:1px solid #e8e8e5;border-radius:8px;margin-bottom:18px">
        <div style="font-size:12px;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${esc(panel.title)}</div>
        <div style="font-size:13px;color:#444;line-height:1.55;margin-bottom:14px">${panel.desc}</div>
        ${actionHtml}
        <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          ${rejectBtn}
          <button id="overrideToggle" type="button" style="padding:6px 10px;background:transparent;color:#888;border:none;font-size:12px;cursor:pointer;text-decoration:underline">Manual override ▾</button>
        </div>
        <div id="overridePanel" style="display:none;margin-top:10px;padding:10px;background:#fafaf6;border-radius:6px;font-size:12px">
          <p style="margin:0 0 6px;color:#666">Bypass the guided flow. Only use for corrections (misclicks, etc.). Skipping FCRA steps creates legal exposure.</p>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <select id="applicantStatus" style="padding:6px 10px;border:1px solid #d8d0bd;border-radius:6px;font-size:13px">${statusOptions}</select>
            <button id="overrideSave" type="button" style="padding:7px 12px;background:#666;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">Force change</button>
          </div>
        </div>
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

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="notesSave" type="button" style="padding:9px 18px;background:#14613a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Save notes</button>
      </div>
    `);

    async function doSetStatus(newStatus, successMsg) {
      try {
        await api('/applicants/' + id, { method: 'PATCH', body: { status: newStatus } });
        toast(successMsg || 'Updated', 'ok');
        closeModal();
        render_applicants(App.content);
      } catch (e) {
        toast('Failed: ' + e.message, 'err');
      }
    }

    async function doSendBgcheck() {
      if (!confirm('Send the FCRA background-check disclosure email to ' + a.email + '?\n\nThis is the federally required pre-disclosure before pulling a background report.')) return;
      try {
        await api('/applicants/' + id + '/send-bgcheck', { method: 'POST' });
        toast('FCRA disclosure sent to ' + a.email, 'ok');
        closeModal();
        render_applicants(App.content);
      } catch (e) {
        toast('Send failed: ' + e.message, 'err');
      }
    }

    const primaryBtn = document.getElementById('primaryAction');
    if (primaryBtn && panel.button) {
      primaryBtn.onclick = () => {
        if (panel.button.action === 'set_status') return doSetStatus(panel.button.value, 'Moved to ' + (APPLICANT_STATUS_LABELS[panel.button.value] || panel.button.value));
        if (panel.button.action === 'send_bgcheck') return doSendBgcheck();
      };
    }
    if (panel.fork) {
      panel.fork.forEach((b, i) => {
        const el = document.getElementById('forkAction_' + i);
        if (!el) return;
        el.onclick = () => {
          if (b.action === 'set_status') {
            if (b.value === 'hired' && !confirm('Confirm: the background report came back with no disqualifying issues, and you are hiring ' + a.full_name + '.')) return;
            return doSetStatus(b.value, 'Updated');
          }
          if (b.action === 'open_adverse') {
            closeModal();
            setTimeout(() => openAdverseActionModal(a), 50);
          }
        };
      });
    }

    const rejBtn = document.getElementById('rejectBtn');
    if (rejBtn) {
      rejBtn.onclick = () => {
        if (!confirm('Reject ' + a.full_name + '?\n\nNote: if a background report was already pulled and this rejection is based on that report, you must complete the FCRA adverse-action workflow first.')) return;
        doSetStatus('rejected', 'Rejected');
      };
    }

    const overrideToggle = document.getElementById('overrideToggle');
    overrideToggle.onclick = () => {
      const p = document.getElementById('overridePanel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('overrideSave').onclick = () => {
      const newStatus = document.getElementById('applicantStatus').value;
      if (newStatus === a.status) return toast('No change', 'err');
      if (!confirm('Force status to "' + APPLICANT_STATUS_LABELS[newStatus] + '"? This bypasses the guided flow.')) return;
      doSetStatus(newStatus, 'Status forced');
    };

    document.getElementById('notesSave').onclick = async () => {
      try {
        const newNotes = document.getElementById('applicantNotes').value;
        await api('/applicants/' + id, { method: 'PATCH', body: { scott_notes: newNotes } });
        toast('Notes saved', 'ok');
      } catch (e) {
        toast('Save failed: ' + e.message, 'err');
      }
    };
  } catch (e) {
    toast('Failed to load applicant: ' + e.message, 'err');
  }
}

window.render_applicants = render_applicants;
