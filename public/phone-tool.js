// phone-tool.js — shared, framework-free Phone tool. Host calls:
//   mountPhoneTool(containerEl, adapter)
// adapter = {
//   listCalls():        Promise<row[]>
//   listNeedsYou():     Promise<row[]>
//   dial(number, name): Promise<{ok,sid}|{error}>
//   setOutcome(id, {outcome,note}): Promise<{ok}|{error}>
// }
// row = call_log shape (direction, counterparty_number/name, status, duration_sec,
//        voicemail_transcript, outcome, started_at, id).
(function () {
  function esc(s){ const d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
  function fmtNum(s){ const d=String(s||'').replace(/\D/g,'').slice(-10); return d.length===10?`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`:(s||'unknown'); }
  function fmtDur(n){ n=parseInt(n,10)||0; return n>=60?`${Math.floor(n/60)}m ${n%60}s`:`${n}s`; }
  function fmtTime(s){ try{ return new Date((s||'').replace(' ','T')+'Z').toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(_){ return s||''; } }
  function dirIcon(d){ return d==='outbound' ? '↗' : '↘'; }

  function toast(msg){
    let t=document.querySelector('.pt-toast');
    if(!t){ t=document.createElement('div'); t.className='pt-toast'; document.body.appendChild(t); }
    t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200);
  }

  function rowHtml(r){
    const st=(r.status||'initiated');
    return `<div class="pt-row" data-id="${r.id}">
      <span class="pt-dir ${r.direction==='outbound'?'pt-out':''}">${dirIcon(r.direction)}</span>
      <div class="pt-rmeta">
        <div class="pt-rwho">${esc(r.counterparty_name || fmtNum(r.counterparty_number))}</div>
        <div class="pt-rsub">${esc(r.counterparty_name?fmtNum(r.counterparty_number):'')}${r.duration_sec?` · ${fmtDur(r.duration_sec)}`:''}${r.outcome?` · ${esc(r.outcome)}`:''}</div>
      </div>
      <span class="pt-badge pt-b-${esc(st)}">${esc(st)}</span>
      <span class="pt-rtime">${esc(fmtTime(r.started_at))}</span>
    </div>`;
  }

  function mountPhoneTool(container, adapter){
    container.innerHTML = `
      <div class="pt-wrap">
        <div class="pt-card pt-needs" id="ptNeeds"></div>
        <div class="pt-card pt-dialpad">
          <input class="pt-display" id="ptDisplay" placeholder="Enter a number" inputmode="tel">
          <input class="pt-name" id="ptName" placeholder="Name (optional, for the log)">
          <div class="pt-keys">${['1','2','3','4','5','6','7','8','9','*','0','#'].map(k=>`<button class="pt-key" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="pt-actions">
            <button class="pt-back" id="ptBack" title="delete">⌫</button>
            <button class="pt-call" id="ptCall">Call</button>
          </div>
        </div>
        <div class="pt-card pt-log"><h3>Call log</h3><div id="ptLog">Loading…</div></div>
      </div>`;

    const display = container.querySelector('#ptDisplay');
    const nameEl = container.querySelector('#ptName');
    container.querySelectorAll('.pt-key').forEach(b => b.addEventListener('click', () => { display.value += b.dataset.k; }));
    container.querySelector('#ptBack').addEventListener('click', () => { display.value = display.value.slice(0, -1); });

    const callBtn = container.querySelector('#ptCall');
    callBtn.addEventListener('click', async () => {
      const num = display.value.trim();
      if (String(num).replace(/\D/g,'').length < 10) { toast('Enter a 10-digit number'); return; }
      callBtn.disabled = true; callBtn.textContent = 'Ringing…';
      try {
        const r = await adapter.dial(num, nameEl.value.trim());
        if (r && r.ok) { toast('Your phone is ringing — pick up to connect'); display.value=''; nameEl.value=''; setTimeout(refreshLog, 1500); }
        else { toast((r && r.error) || 'Call failed'); }
      } catch (_) { toast('Call service unavailable'); }
      finally { callBtn.disabled = false; callBtn.textContent = 'Call'; }
    });

    async function refreshNeeds(){
      const el = container.querySelector('#ptNeeds');
      let rows = []; try { rows = await adapter.listNeedsYou() || []; } catch(_) {}
      if (!rows.length) { el.innerHTML = `<h3>Needs you</h3><div class="pt-needs-empty"><span class="pt-tick">✓</span> All clear — no missed calls or voicemails to handle.</div>`; return; }
      el.innerHTML = `<h3>Needs you <span class="pt-pill">${rows.length}</span></h3>` + rows.map(r => `
        <div class="pt-needs-row" data-needs="${r.id}">
          <span class="pt-dir">${dirIcon(r.direction)}</span>
          <div class="pt-rmeta">
            <div class="pt-rwho">${esc(r.counterparty_name || fmtNum(r.counterparty_number))}</div>
            <div class="pt-rsub">${esc(r.status)}${r.voicemail_transcript?` · "${esc(r.voicemail_transcript.slice(0,80))}"`:''}</div>
          </div>
          <button class="pt-mark" data-handled="${r.id}">Mark handled</button>
        </div>`).join('');
      el.querySelectorAll('[data-handled]').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        await adapter.setOutcome(b.dataset.handled, { outcome: 'handled' });
        refreshNeeds(); refreshLog();
      }));
    }

    async function refreshLog(){
      const el = container.querySelector('#ptLog');
      let rows = []; try { rows = await adapter.listCalls() || []; } catch(_) {}
      if (!rows.length) { el.innerHTML = '<div class="pt-needs-empty">No calls logged yet.</div>'; return; }
      el.innerHTML = rows.map(rowHtml).join('');
      el.querySelectorAll('.pt-row').forEach(rowEl => rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id; const r = rows.find(x => String(x.id) === id);
        let ex = rowEl.nextElementSibling;
        if (ex && ex.classList.contains('pt-expand')) { ex.remove(); return; }
        ex = document.createElement('div'); ex.className = 'pt-expand';
        ex.innerHTML = `${r.voicemail_transcript?`<div class="pt-vm"><b>Voicemail:</b> ${esc(r.voicemail_transcript)}</div>`:''}
          <textarea placeholder="Outcome / note…">${esc(r.outcome||'')}</textarea>
          <button class="pt-save">Save outcome</button>`;
        ex.querySelector('.pt-save').addEventListener('click', async () => {
          await adapter.setOutcome(id, { outcome: ex.querySelector('textarea').value.trim() });
          toast('Saved'); ex.remove(); refreshLog(); refreshNeeds();
        });
        rowEl.after(ex);
      }));
    }

    refreshNeeds(); refreshLog();
    const timer = setInterval(() => { if (document.body.contains(container)) { refreshNeeds(); refreshLog(); } else { clearInterval(timer); } }, 20000);
    return { refresh: () => { refreshNeeds(); refreshLog(); } };
  }

  window.mountPhoneTool = mountPhoneTool;
})();
