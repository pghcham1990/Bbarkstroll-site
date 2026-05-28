/* ── Gallery View ─────────────────────────────────────────────── */

async function render_gallery(el) {
  const setHTML = (node, html) => { node.innerHTML = html; };

  setHTML(el, `
    <p class="section-label">Public Site</p>
    <h1 class="section-title">Gallery</h1>

    <div class="glass-panel" style="margin-bottom:24px;">
      <div class="glass-panel-header">
        <h3 class="glass-panel-title">Add a photo</h3>
      </div>
      <div class="glass-panel-body">
        <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;line-height:1.55;">
          Upload a photo of a real Bark &amp; Stroll client to feature on the public site.
          Pick the client to link the photo to their profile and use it as their avatar. Photos are optimized for the web.
        </p>

        <form id="galleryUploadForm" class="gallery-upload-form">
          <label for="galleryFile" class="gallery-dropzone" id="galleryDropzone">
            <input type="file" id="galleryFile" name="photo" accept="image/*" required hidden>
            <div class="gallery-dropzone-inner">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--forest);opacity:.6;margin-bottom:8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <div class="gallery-dropzone-title" id="galleryDropzoneTitle">Tap to choose or take a photo</div>
              <div class="gallery-dropzone-hint">JPEG, PNG, WebP, or HEIC &middot; up to 15MB</div>
            </div>
          </label>

          <div id="galleryPreviewWrap" style="display:none;margin-top:14px;">
            <img id="galleryPreview" alt="" style="max-width:100%;max-height:280px;border-radius:12px;border:1px solid rgba(20,97,58,.15);background:var(--cream);">
          </div>

          <div class="form-group">
            <label for="galleryClient">Client <span style="color:var(--text-soft);font-weight:400;">(links photo &amp; sets their avatar)</span></label>
            <select id="galleryClient" name="customer_id">
              <option value="">— No client —</option>
            </select>
          </div>

          <div class="gallery-fields">
            <div class="form-group">
              <label for="galleryDogName">Dog's name <span style="color:var(--text-soft);font-weight:400;">(optional)</span></label>
              <input type="text" id="galleryDogName" name="dog_name" maxlength="60" placeholder="e.g. Bella">
            </div>
            <div class="form-group">
              <label for="galleryCaption">Caption <span style="color:var(--text-soft);font-weight:400;">(optional)</span></label>
              <input type="text" id="galleryCaption" name="caption" maxlength="120" placeholder="e.g. Bella loves her morning loop">
            </div>
          </div>

          <div class="gallery-upload-actions">
            <button type="submit" class="btn btn-primary" id="galleryUploadBtn" disabled>Upload to Gallery</button>
            <div id="galleryUploadStatus" class="gallery-status" aria-live="polite"></div>
          </div>
        </form>
      </div>
    </div>

    <div class="glass-panel">
      <div class="glass-panel-header">
        <h3 class="glass-panel-title">Photos on barkstroll.com</h3>
        <span id="galleryCount" class="glass-panel-meta"></span>
      </div>
      <div class="glass-panel-body">
        <div id="galleryGrid" class="gallery-admin-grid">
          <div class="empty"><div class="empty-text">Loading...</div></div>
        </div>
      </div>
    </div>

    <style>
      .gallery-dropzone{display:block;border:2px dashed rgba(20,97,58,.25);border-radius:14px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(20,97,58,.02);}
      .gallery-dropzone:hover,.gallery-dropzone.is-drag{border-color:var(--forest);background:rgba(20,97,58,.06);}
      .gallery-dropzone-title{font-weight:600;color:var(--text);margin-bottom:4px;}
      .gallery-dropzone-hint{font-size:12px;color:var(--text-soft);}
      .gallery-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;}
      @media(max-width:640px){.gallery-fields{grid-template-columns:1fr;}}
      .gallery-consent{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:12px;border:1px solid rgba(20,97,58,.12);border-radius:10px;background:rgba(20,97,58,.03);font-size:13px;line-height:1.5;cursor:pointer;}
      .gallery-consent input{margin-top:2px;flex-shrink:0;}
      .gallery-upload-actions{display:flex;align-items:center;gap:14px;margin-top:16px;flex-wrap:wrap;}
      .gallery-status{font-size:13px;color:var(--text-soft);min-height:1em;}
      .gallery-status.ok{color:var(--forest);font-weight:600;}
      .gallery-status.err{color:#c0392b;font-weight:600;}
      .gallery-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;}
      .gallery-tile{position:relative;border-radius:10px;overflow:hidden;background:var(--cream);border:1px solid rgba(20,97,58,.12);aspect-ratio:1/1;}
      .gallery-tile-img{position:absolute;inset:0;background-size:cover;background-position:center;}
      .gallery-tile-meta{position:absolute;left:0;right:0;bottom:0;padding:8px 10px;background:linear-gradient(0deg,rgba(0,0,0,.65),transparent);color:#fff;font-size:12px;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.4);}
      .gallery-tile-actions{position:absolute;top:6px;right:6px;display:flex;gap:6px;opacity:0;transition:opacity .15s;}
      .gallery-tile:hover .gallery-tile-actions,.gallery-tile.is-touched .gallery-tile-actions{opacity:1;}
      .gallery-tile-btn{background:rgba(255,255,255,.92);border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--forest-deep);box-shadow:0 2px 6px rgba(0,0,0,.18);}
      .gallery-tile-btn:hover{background:#fff;}
      .gallery-tile-btn.danger{color:#c0392b;}
      .gallery-tile.is-unpublished{opacity:.55;}
      .gallery-tile.is-unpublished::before{content:'Hidden';position:absolute;top:6px;left:6px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:6px;text-transform:uppercase;z-index:1;}
      .glass-panel-meta{font-size:12px;color:var(--text-soft);}
    </style>
  `);

  const fileInput = el.querySelector('#galleryFile');
  const dropzone = el.querySelector('#galleryDropzone');
  const dropzoneTitle = el.querySelector('#galleryDropzoneTitle');
  const previewWrap = el.querySelector('#galleryPreviewWrap');
  const preview = el.querySelector('#galleryPreview');
  const uploadBtn = el.querySelector('#galleryUploadBtn');
  const status = el.querySelector('#galleryUploadStatus');
  const form = el.querySelector('#galleryUploadForm');
  const clientSelect = el.querySelector('#galleryClient');

  // Populate the client dropdown with active clients (skip prospects + internal rows).
  fetch('/admin/api/customers')
    .then(r => r.json())
    .then(list => {
      (list || [])
        .filter(c => c.status !== 'prospect' && c.status !== 'internal')
        .forEach(c => {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = (c.last_name || '') + ', ' + (c.first_name || '');
          clientSelect.appendChild(o);
        });
    })
    .catch(() => {});

  // Pick a client → auto-fill the dog name(s) from their profile (no retyping).
  clientSelect.addEventListener('change', () => {
    const id = clientSelect.value;
    if (!id) return;
    fetch('/admin/api/customers/' + id)
      .then(r => r.json())
      .then(c => {
        const names = (c.dogs || []).map(d => d.name).filter(Boolean);
        if (names.length) el.querySelector('#galleryDogName').value = names.join(' & ');
      })
      .catch(() => {});
  });

  function refreshCanSubmit() {
    uploadBtn.disabled = !(fileInput.files && fileInput.files[0]);
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) {
      dropzoneTitle.textContent = f.name;
      preview.src = URL.createObjectURL(f);
      previewWrap.style.display = '';
    } else {
      dropzoneTitle.textContent = 'Tap to choose or take a photo';
      previewWrap.style.display = 'none';
    }
    refreshCanSubmit();
  });

  ['dragenter','dragover'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('is-drag'); })
  );
  ['dragleave','drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('is-drag'); })
  );
  dropzone.addEventListener('drop', e => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;

    const fd = new FormData();
    fd.append('photo', f);
    fd.append('caption', el.querySelector('#galleryCaption').value);
    fd.append('dog_name', el.querySelector('#galleryDogName').value);
    fd.append('customer_id', clientSelect.value);
    fd.append('consent', 'true');

    uploadBtn.disabled = true;
    status.className = 'gallery-status';
    status.textContent = 'Uploading and processing...';

    try {
      const r = await fetch('/admin/api/gallery', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      status.className = 'gallery-status ok';
      status.textContent = 'Uploaded. Photo is now live on barkstroll.com.';
      form.reset();
      previewWrap.style.display = 'none';
      dropzoneTitle.textContent = 'Tap to choose or take a photo';
      refreshCanSubmit();
      await loadPhotos();
    } catch (err) {
      status.className = 'gallery-status err';
      status.textContent = err.message;
      uploadBtn.disabled = false;
    }
  });

  function tileHTML(p) {
    const cap = p.caption || '';
    const dog = p.dog_name || '';
    const label = dog && cap ? esc(dog) + ' &middot; ' + esc(cap) : esc(dog || cap);
    const eyeOpen = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeOff = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y1="1" y2="23"/></svg>';
    const trash = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    return '<div class="gallery-tile ' + (p.is_published ? '' : 'is-unpublished') + '" data-id="' + p.id + '">' +
      '<div class="gallery-tile-img" style="background-image:url(\'' + p.thumb_url + '\')"></div>' +
      (label ? '<div class="gallery-tile-meta">' + label + '</div>' : '') +
      '<div class="gallery-tile-actions">' +
        '<button class="gallery-tile-btn" data-action="toggle" title="' + (p.is_published ? 'Hide from site' : 'Show on site') + '">' +
          (p.is_published ? eyeOff : eyeOpen) +
        '</button>' +
        '<button class="gallery-tile-btn danger" data-action="delete" title="Delete">' + trash + '</button>' +
      '</div>' +
    '</div>';
  }

  async function loadPhotos() {
    const grid = el.querySelector('#galleryGrid');
    const counter = el.querySelector('#galleryCount');
    try {
      const r = await fetch('/admin/api/gallery');
      const photos = await r.json();
      counter.textContent = photos.length + (photos.length === 1 ? ' photo' : ' photos');

      if (!photos.length) {
        setHTML(grid, '<div class="empty"><div class="empty-text">No photos yet. Add the first one above.</div></div>');
        return;
      }

      setHTML(grid, photos.map(tileHTML).join(''));

      grid.querySelectorAll('.gallery-tile').forEach(tile => {
        const id = tile.dataset.id;
        tile.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
          const wasPublished = !tile.classList.contains('is-unpublished');
          try {
            const r = await fetch('/admin/api/gallery/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_published: !wasPublished })
            });
            if (!r.ok) throw new Error((await r.json()).error || 'Update failed');
            await loadPhotos();
          } catch (err) {
            toast(err.message, 'err');
          }
        });
        tile.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          if (!confirm('Delete this photo from the site?')) return;
          try {
            const r = await fetch('/admin/api/gallery/' + id, { method: 'DELETE' });
            if (!r.ok) throw new Error((await r.json()).error || 'Delete failed');
            await loadPhotos();
            toast('Photo deleted', 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        });
        tile.addEventListener('touchstart', () => tile.classList.add('is-touched'), { passive: true });
      });
    } catch (err) {
      setHTML(grid, '<div class="empty"><div class="empty-text">Failed to load photos: ' + esc(err.message) + '</div></div>');
    }
  }

  await loadPhotos();
}
