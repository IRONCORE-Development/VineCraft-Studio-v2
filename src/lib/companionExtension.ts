import JSZip from 'jszip';

export function buildSafePopupHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VineCraft Safe-Zone Companion</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 390px;
      padding: 14px;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
    }
    .hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; }
    .brand { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
    .badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 6px;
      background: #052e16;
      border: 1px solid #166534;
      color: #86efac;
    }
    .safe-box {
      background: #052e16;
      border: 1px solid #166534;
      color: #bbf7d0;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      margin-bottom: 10px;
      line-height: 1.4;
    }
    .meta {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      color: #cbd5e1;
      margin-bottom: 10px;
      word-break: break-all;
    }
    .row { display: flex; gap: 6px; margin-bottom: 10px; }
    button {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid transparent;
      font: 600 11.5px/1.2 inherit;
      cursor: pointer;
      text-decoration: none;
    }
    .primary { background: #2563eb; color: #fff; }
    .primary:hover { background: #1d4ed8; }
    .emerald { background: #047857; color: #fff; }
    .emerald:hover { background: #065f46; }
    .secondary { background: #1e293b; color: #f8fafc; border-color: #475569; }
    .secondary:hover { background: #334155; }
    .list { max-height: 330px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px;
    }
    .card-asin { font-family: ui-monospace, monospace; font-size: 11px; color: #93c5fd; }
    .card-title { font-weight: 600; font-size: 12px; color: #f8fafc; margin: 2px 0 6px; }
    .card-actions { display: flex; gap: 6px; margin-top: 6px; }
    .empty { font-size: 11.5px; color: #94a3b8; text-align: center; padding: 14px 8px; background: #1e293b; border-radius: 8px; }
    .status {
      margin-top: 8px;
      font-size: 11px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #1e293b;
      color: #86efac;
      display: none;
    }
    .status.err { color: #fca5a5; background: #450a0a; }
  </style>
</head>
<body>
  <div class="hdr">
    <span class="brand">VineCraft Companion</span>
    <span class="badge">Zero Amazon Scripts</span>
  </div>
  <div class="safe-box">
    <strong>Local Safe-Zone:</strong> Zero Firebase traffic, zero content scripts, and zero DOM scraping on Amazon. Direct ASIN URL launch in active Vine tab + clipboard copy only.
  </div>
  <div class="meta">
    <div><strong>Local Server:</strong> <span id="studio-origin">—</span></div>
    <div><strong>Bridge Key:</strong> <span id="bridge-key">—</span></div>
  </div>
  <div class="row">
    <button id="refresh-btn" class="primary">Sync Drafts</button>
    <button id="local-studio-btn" class="emerald">Local Studio Tab</button>
    <button id="open-btn" class="secondary">Web Studio</button>
  </div>
  <div id="drafts-list" class="list"></div>
  <div id="status" class="status"></div>
  <script src="popup.js"></script>
</body>
</html>
`;
}

export function buildSafePopupScript(studioOrigin: string, bridgeKey: string): string {
  return `(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const DEFAULT_ORIGIN = ${JSON.stringify(studioOrigin.replace(/\/+$/, '') || 'http://127.0.0.1:7413')};
  const DEFAULT_KEY = ${JSON.stringify(bridgeKey || 'local')};

  const originEl = document.getElementById('studio-origin');
  const keyEl = document.getElementById('bridge-key');
  const listEl = document.getElementById('drafts-list');
  const statusEl = document.getElementById('status');
  const refreshBtn = document.getElementById('refresh-btn');
  const localStudioBtn = document.getElementById('local-studio-btn');
  const openBtn = document.getElementById('open-btn');

  let activeOrigin = DEFAULT_ORIGIN;
  let activeKey = DEFAULT_KEY;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.className = isError ? 'status err' : 'status';
    statusEl.textContent = msg;
  }

  function buildReviewUrl(d) {
    const mp = (d && d.marketplace) || 'amazon.com';
    const raw = String((d && d.reviewUrl) || '').split('#')[0].trim();
    if (raw && /^https?:\\/\\/[^/]*amazon\\./i.test(raw)) {
      return raw;
    }
    return 'https://www.' + mp + '/review/create-review?encoding=UTF&asin=' + encodeURIComponent(d.asin || '');
  }

  async function openInActiveVineTab(targetUrl, asin) {
    try {
      const allTabs = await api.tabs.query({});
      const vineTab =
        allTabs.find((t) => typeof t.url === 'string' && /amazon\\.[^/]+\\/vine/i.test(t.url)) ||
        allTabs.find((t) => typeof t.url === 'string' && /amazon\\.[^/]+\\/review/i.test(t.url)) ||
        allTabs.find((t) => typeof t.url === 'string' && /https?:\\/\\/[^/]*amazon\\./i.test(t.url));

      if (vineTab && vineTab.id !== undefined) {
        await api.tabs.update(vineTab.id, { url: targetUrl, active: true });
        setStatus('Opened ASIN ' + asin + ' directly in your active Amazon tab.');
      } else {
        await api.tabs.create({ url: targetUrl, active: true });
        setStatus('Opened clean Amazon review tab for ' + asin + '.');
      }
    } catch {
      await api.tabs.create({ url: targetUrl, active: true });
    }
  }

  openBtn?.addEventListener('click', () => {
    api.tabs.create({ url: activeOrigin });
  });

  localStudioBtn?.addEventListener('click', () => {
    api.tabs.create({ url: api.runtime.getURL('studio.html') });
  });

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied ' + label + ' — paste naturally into Amazon.');
    } catch {
      setStatus('Clipboard write failed — copy from Local Studio.', true);
    }
  }

  function renderDrafts(drafts) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!drafts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No staged Strong drafts yet. Click "Sync to Popup" on any review in Studio or open Local Studio Tab.';
      listEl.appendChild(empty);
      return;
    }
    drafts.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'card';

      const asin = document.createElement('div');
      asin.className = 'card-asin';
      asin.textContent = d.asin + ' · ' + (d.rating || 5) + '/5 stars';
      card.appendChild(asin);

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = d.draftTitle || d.productTitle || d.asin;
      card.appendChild(title);

      const row = document.createElement('div');
      row.className = 'card-actions';

      const copyHead = document.createElement('button');
      copyHead.className = 'secondary';
      copyHead.textContent = 'Copy Headline';
      copyHead.onclick = () => copyText(d.draftTitle || '', d.asin + ' headline');
      row.appendChild(copyHead);

      const copyBody = document.createElement('button');
      copyBody.className = 'primary';
      copyBody.textContent = 'Copy Body';
      copyBody.onclick = () => copyText(d.draftBody || '', d.asin + ' body');
      row.appendChild(copyBody);

      card.appendChild(row);

      const launchRow = document.createElement('div');
      launchRow.className = 'card-actions';

      const launchBtn = document.createElement('button');
      launchBtn.className = 'emerald';
      launchBtn.textContent = 'Copy Body & Open Review Page (Active Vine Tab)';
      launchBtn.onclick = async () => {
        if (d.draftBody) {
          try { await navigator.clipboard.writeText(d.draftBody); } catch {}
        }
        await openInActiveVineTab(buildReviewUrl(d), d.asin);
      };
      launchRow.appendChild(launchBtn);
      card.appendChild(launchRow);

      listEl.appendChild(card);
    });
  }

  async function loadStagedDrafts() {
    const stored = await api.storage.local.get(['vc_origin', 'vc_bridge_key', 'vc_local_drafts']);
    activeOrigin = (stored.vc_origin || DEFAULT_ORIGIN).replace(/\\/+$/, '');
    activeKey = stored.vc_bridge_key || DEFAULT_KEY;
    if (originEl) originEl.textContent = activeOrigin;
    if (keyEl) keyEl.textContent = activeKey;

    const localDrafts = Array.isArray(stored.vc_local_drafts)
      ? stored.vc_local_drafts.filter((d) => d && d.status !== 'posted' && d.draftBody)
      : [];

    setStatus('Loading staged drafts...');
    try {
      const res = await fetch(activeOrigin + '/api/bridge/staged?bridgeKey=' + encodeURIComponent(activeKey));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const serverDrafts = Array.isArray(data.drafts) ? data.drafts : [];
      const seen = new Set(serverDrafts.map((d) => d.asin));
      const merged = [...serverDrafts, ...localDrafts.filter((d) => !seen.has(d.asin))];
      renderDrafts(merged);
      setStatus('Loaded ' + merged.length + ' ready draft(s) (0 Amazon scripts).');
    } catch {
      renderDrafts(localDrafts);
      if (localDrafts.length) {
        setStatus('Loaded ' + localDrafts.length + ' local extension draft(s) (offline mode).');
      } else {
        setStatus('Studio server offline — click Local Studio Tab to draft directly in Firefox.', true);
      }
    }
  }

  refreshBtn?.addEventListener('click', loadStagedDrafts);
  loadStagedDrafts();
})();
`;
}

export function buildStandaloneExtensionStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VineCraft Studio — Local Firefox Extension</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    .topbar {
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
    .pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 6px;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }
    .shell { display: grid; grid-template-columns: 290px 1fr; min-height: calc(100vh - 54px); }
    .sidebar { background: #ffffff; border-right: 1px solid #e2e8f0; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .main { padding: 24px 28px; max-width: 980px; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
    h2 { margin: 0 0 6px; font-size: 15px; }
    .muted { color: #64748b; font-size: 12px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid3 { display: grid; grid-template-columns: 160px 1fr 160px; gap: 12px; }
    label { display: block; font-size: 11.5px; font-weight: 600; color: #334155; margin-bottom: 4px; }
    input, select, textarea {
      width: 100%;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      border-radius: 8px;
      padding: 8px 10px;
      font: inherit;
      font-size: 12.5px;
      color: #0f172a;
    }
    textarea { resize: vertical; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button {
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 8px 13px;
      font: 600 12px/1.2 inherit;
      cursor: pointer;
    }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-dark { background: #0f172a; color: #fff; }
    .btn-dark:hover { background: #1e293b; }
    .btn-emerald { background: #047857; color: #fff; }
    .btn-emerald:hover { background: #065f46; }
    .btn-ghost { background: #fff; border-color: #cbd5e1; color: #334155; }
    .btn-ghost:hover { background: #f1f5f9; }
    .q-item {
      width: 100%;
      text-align: left;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 6px;
    }
    .q-item.active { border-color: #2563eb; background: #eff6ff; }
    .notice {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 12px;
      margin-bottom: 14px;
      display: none;
    }
    .notice.ok { display: block; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
    .notice.err { display: block; background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span>VineCraft Studio</span>
      <span class="pill">Standalone .xpi Mode · 0 Firebase · 0 Amazon Scripts</span>
    </div>
    <div class="row">
      <button id="export-json-btn" class="btn-ghost">Export Local DB</button>
      <button id="new-item-btn" class="btn-dark">+ New Review</button>
    </div>
  </header>

  <div class="shell">
    <aside class="sidebar">
      <div>
        <label>Local HTTPd Server Origin</label>
        <input id="cfg-origin" type="url" placeholder="http://127.0.0.1:7413" />
      </div>
      <div>
        <label>AI Route (Dual-Agent / Custom)</label>
        <select id="cfg-provider">
          <option value="anthropic">Dual-Agent Default (Sonnet + Haiku / Cloud Fallback)</option>
          <option value="custom_openrouter">Custom Route: OpenRouter</option>
          <option value="custom_anthropic">Custom Route: Anthropic</option>
          <option value="custom_gemini">Custom Route: Gemini</option>
          <option value="custom_endpoint">Custom Cloud OpenAI-Compatible Endpoint</option>
          <option value="gemini">Gemini Cloud</option>
        </select>
      </div>
      <div>
        <label>Custom Cloud Endpoint URL (OpenRouter / HTTPS)</label>
        <input id="cfg-endpoint" type="url" placeholder="https://openrouter.ai/api/v1/chat/completions" />
      </div>
      <div class="grid2">
        <div>
          <label>Gen Model</label>
          <input id="cfg-gen-model" type="text" placeholder="claude-3-5-sonnet-latest" />
        </div>
        <div>
          <label>Quality Model</label>
          <input id="cfg-qual-model" type="text" placeholder="claude-3-5-haiku-latest" />
        </div>
      </div>
      <button id="save-cfg-btn" class="btn-ghost">Save Local Settings</button>
      <hr style="border:none;border-top:1px solid #e2e8f0;width:100%" />
      <div style="font-weight:700;font-size:12px;">Local Review Queue (<span id="queue-count">0</span>)</div>
      <div id="queue-list" style="overflow-y:auto;flex:1;"></div>
    </aside>

    <main class="main">
      <div id="notice" class="notice"></div>

      <section class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:12px;">
          <div>
            <h2>Product & Experience</h2>
            <div class="muted">Stored strictly in Firefox browser.storage.local — never sent to Google/Firebase.</div>
          </div>
          <button id="generate-btn" class="btn-primary">Generate & Auto-Inspect</button>
        </div>

        <div class="grid3" style="margin-bottom:12px;">
          <div>
            <label>Amazon ASIN</label>
            <input id="f-asin" type="text" placeholder="B0C1234567" />
          </div>
          <div>
            <label>Product Title</label>
            <input id="f-title" type="text" placeholder="Product title..." />
          </div>
          <div>
            <label>Marketplace</label>
            <select id="f-mp">
              <option value="amazon.com">amazon.com</option>
              <option value="amazon.ca">amazon.ca</option>
              <option value="amazon.co.uk">amazon.co.uk</option>
              <option value="amazon.de">amazon.de</option>
              <option value="amazon.fr">amazon.fr</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <label>Listing Specifications (Optional)</label>
          <textarea id="f-desc" rows="2"></textarea>
        </div>

        <div class="grid2">
          <div>
            <label>What I Liked</label>
            <input id="f-liked" type="text" />
          </div>
          <div>
            <label>What I Disliked</label>
            <input id="f-disliked" type="text" />
          </div>
          <div>
            <label>How I Used It</label>
            <input id="f-usage" type="text" />
          </div>
          <div>
            <label>Rating (1-5)</label>
            <input id="f-rating" type="number" min="1" max="5" value="5" />
          </div>
        </div>
      </section>

      <section class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:12px;">
          <div>
            <h2>Review Draft & Direct ASIN Launch</h2>
            <div class="muted" id="quality-badge">Not inspected yet</div>
          </div>
          <div class="row">
            <button id="save-draft-btn" class="btn-ghost">Save Local Draft</button>
            <button id="sync-popup-btn" class="btn-dark">Sync to Popup</button>
            <button id="launch-amazon-btn" class="btn-emerald">Copy & Open Review Page (Active Vine Tab)</button>
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label>Headline</label>
          <input id="d-title" type="text" placeholder="Review headline..." />
        </div>
        <div>
          <label>Review Body</label>
          <textarea id="d-body" rows="8" placeholder="Generated review body..."></textarea>
        </div>
      </section>
    </main>
  </div>
  <script src="studio.js"></script>
</body>
</html>
`;
}

export function buildStandaloneExtensionStudioScript(studioOrigin: string, bridgeKey: string): string {
  return `(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const DEFAULT_ORIGIN = ${JSON.stringify(studioOrigin.replace(/\/+$/, '') || 'http://127.0.0.1:7413')};
  const DEFAULT_KEY = ${JSON.stringify(bridgeKey || 'local')};

  const $ = (id) => document.getElementById(id);
  const noticeEl = $('notice');
  let drafts = [];
  let activeId = null;

  function showNotice(msg, isErr) {
    if (!noticeEl) return;
    noticeEl.textContent = msg;
    noticeEl.className = isErr ? 'notice err' : 'notice ok';
  }

  function cleanAsin(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  }

  function buildReviewUrl(asin, marketplace) {
    return 'https://www.' + (marketplace || 'amazon.com') + '/review/create-review?encoding=UTF&asin=' + encodeURIComponent(cleanAsin(asin));
  }

  async function saveState() {
    await api.storage.local.set({ vc_local_drafts: drafts });
  }

  function renderQueue() {
    const list = $('queue-list');
    const count = $('queue-count');
    if (count) count.textContent = String(drafts.length);
    if (!list) return;
    list.innerHTML = '';
    drafts.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'q-item' + (item.id === activeId ? ' active' : '');
      btn.innerHTML = '<div style="font-family:monospace;font-size:11px;color:#2563eb;">' + item.asin + ' · ' + (item.qualityBand || 'draft') + '</div><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (item.productTitle || item.asin) + '</div>';
      btn.onclick = () => loadItem(item);
      list.appendChild(btn);
    });
  }

  function loadItem(item) {
    activeId = item.id;
    $('f-asin').value = item.asin || '';
    $('f-title').value = item.productTitle || '';
    $('f-mp').value = item.marketplace || 'amazon.com';
    $('f-desc').value = item.productDescription || '';
    $('f-liked').value = item.liked || '';
    $('f-disliked').value = item.disliked || '';
    $('f-usage').value = item.usage || '';
    $('f-rating').value = String(item.rating || 5);
    $('d-title').value = item.draftTitle || '';
    $('d-body').value = item.draftBody || '';
    $('quality-badge').textContent = item.qualitySummary ? ('Band: ' + item.qualityBand + ' — ' + item.qualitySummary) : 'Draft loaded from browser.storage.local';
    renderQueue();
  }

  function collectCurrent() {
    const asin = cleanAsin($('f-asin').value);
    const id = activeId || ('loc_' + Date.now());
    activeId = id;
    return {
      id,
      asin,
      productTitle: $('f-title').value.trim() || ('Amazon Item ' + asin),
      marketplace: $('f-mp').value || 'amazon.com',
      productDescription: $('f-desc').value.trim(),
      liked: $('f-liked').value.trim(),
      disliked: $('f-disliked').value.trim(),
      usage: $('f-usage').value.trim(),
      rating: Math.min(5, Math.max(1, Number($('f-rating').value || 5))),
      draftTitle: $('d-title').value.trim(),
      draftBody: $('d-body').value.trim(),
      reviewUrl: buildReviewUrl(asin, $('f-mp').value),
      qualityBand: 'strong',
      status: 'ready_to_post',
    };
  }

  async function syncToOriginPopup(item) {
    const origin = ($('cfg-origin').value || DEFAULT_ORIGIN).replace(/\\/+$/, '');
    const readyList = drafts.filter((d) => d.draftBody);
    try {
      await fetch(origin + '/api/bridge/staged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeKey: DEFAULT_KEY, drafts: readyList.length ? readyList : [item] }),
      });
    } catch {
      // Local storage remains available even when server is offline
    }
  }

  $('save-cfg-btn').onclick = async () => {
    await api.storage.local.set({
      vc_origin: $('cfg-origin').value.trim() || DEFAULT_ORIGIN,
      vc_provider: $('cfg-provider').value,
      vc_endpoint: $('cfg-endpoint').value.trim(),
      vc_gen_model: $('cfg-gen-model').value.trim(),
      vc_qual_model: $('cfg-qual-model').value.trim(),
    });
    showNotice('Saved local extension settings.');
  };

  $('new-item-btn').onclick = () => {
    activeId = null;
    ['f-asin','f-title','f-desc','f-liked','f-disliked','f-usage','d-title','d-body'].forEach((k) => { $(k).value = ''; });
    $('f-rating').value = '5';
    $('quality-badge').textContent = 'New local review';
    renderQueue();
  };

  $('save-draft-btn').onclick = async () => {
    const item = collectCurrent();
    if (!item.asin) { showNotice('Enter an ASIN first.', true); return; }
    const idx = drafts.findIndex((d) => d.id === item.id || d.asin === item.asin);
    if (idx >= 0) drafts[idx] = item;
    else drafts.unshift(item);
    await saveState();
    renderQueue();
    showNotice('Saved ' + item.asin + ' locally in Firefox extension storage.');
  };

  $('sync-popup-btn').onclick = async () => {
    const item = collectCurrent();
    if (!item.asin || !item.draftBody) { showNotice('Enter an ASIN and review body before syncing.', true); return; }
    const idx = drafts.findIndex((d) => d.id === item.id || d.asin === item.asin);
    if (idx >= 0) drafts[idx] = item;
    else drafts.unshift(item);
    await saveState();
    await syncToOriginPopup(item);
    renderQueue();
    showNotice('Synced ' + item.asin + ' to Firefox toolbar popup.');
  };

  $('launch-amazon-btn').onclick = async () => {
    const item = collectCurrent();
    if (!item.asin) { showNotice('Enter an ASIN first.', true); return; }
    if (item.draftBody) {
      try { await navigator.clipboard.writeText(item.draftBody); } catch {}
    }
    const targetUrl = buildReviewUrl(item.asin, item.marketplace);
    const allTabs = await api.tabs.query({});
    const vineTab =
      allTabs.find((t) => typeof t.url === 'string' && /amazon\\.[^/]+\\/vine/i.test(t.url)) ||
      allTabs.find((t) => typeof t.url === 'string' && /https?:\\/\\/[^/]*amazon\\./i.test(t.url));
    if (vineTab && vineTab.id !== undefined) {
      await api.tabs.update(vineTab.id, { url: targetUrl, active: true });
    } else {
      await api.tabs.create({ url: targetUrl, active: true });
    }
    showNotice('Copied review body & navigated active Amazon tab directly to ' + item.asin + ' review page.');
  };

  $('generate-btn').onclick = async () => {
    const asin = cleanAsin($('f-asin').value);
    if (!asin) { showNotice('Enter an ASIN before generating.', true); return; }
    const origin = ($('cfg-origin').value || DEFAULT_ORIGIN).replace(/\\/+$/, '');
    const provider = $('cfg-provider').value;
    const endpointUrl = $('cfg-endpoint').value.trim();
    const model = $('cfg-gen-model').value.trim();
    const qModel = $('cfg-qual-model').value.trim();

    showNotice('Generating & inspecting ' + asin + '...');
    try {
      const genRes = await fetch(origin + '/api/ai/review/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model || undefined,
          endpointUrl: endpointUrl || undefined,
          product: { asin, title: $('f-title').value.trim() || asin, description: $('f-desc').value.trim() },
          context: {
            rating: Number($('f-rating').value || 5),
            liked: $('f-liked').value.trim(),
            disliked: $('f-disliked').value.trim(),
            usage: $('f-usage').value.trim(),
            tone: 'balanced',
            length: 'medium',
          },
        }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'Generation failed');
      $('d-title').value = genData.review.title || '';
      $('d-body').value = genData.review.body || '';

      const qRes = await fetch(origin + '/api/ai/review/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: qModel || undefined,
          endpointUrl: endpointUrl || undefined,
          asin,
          product_title: $('f-title').value.trim(),
          description: $('f-desc').value.trim(),
          rating: Number($('f-rating').value || 5),
          title: $('d-title').value,
          body: $('d-body').value,
        }),
      });
      const qData = await qRes.json();
      const item = collectCurrent();
      item.qualityBand = qData.band || 'good';
      item.qualitySummary = qData.summary || '';
      const idx = drafts.findIndex((d) => d.id === item.id || d.asin === item.asin);
      if (idx >= 0) drafts[idx] = item;
      else drafts.unshift(item);
      await saveState();
      renderQueue();
      $('quality-badge').textContent = 'Band: ' + item.qualityBand + ' — ' + item.qualitySummary;
      showNotice('Generated & inspected ' + asin + ' via ' + (genData.providerUsed || provider) + '.');
    } catch (err) {
      showNotice(err.message || 'Could not reach local HTTPd AI server.', true);
    }
  };

  $('export-json-btn').onclick = () => {
    const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vinecraft-local-db.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  api.storage.local.get(['vc_origin', 'vc_provider', 'vc_endpoint', 'vc_gen_model', 'vc_qual_model', 'vc_local_drafts']).then((st) => {
    $('cfg-origin').value = st.vc_origin || DEFAULT_ORIGIN;
    $('cfg-provider').value = st.vc_provider || 'anthropic';
    $('cfg-endpoint').value = st.vc_endpoint || '';
    $('cfg-gen-model').value = st.vc_gen_model || 'claude-3-5-sonnet-latest';
    $('cfg-qual-model').value = st.vc_qual_model || 'claude-3-5-haiku-latest';
    drafts = Array.isArray(st.vc_local_drafts) ? st.vc_local_drafts : [];
    renderQueue();
  });
})();
`;
}

const COMPANION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#052e16"/>
  <path d="M18 20l14 26 14-26" stroke="#4ade80" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="18" r="4" fill="#93c5fd"/>
</svg>`;

/**
 * Generates a 100% Safe-Zone, Zero-Firebase Firefox Add-on (.xpi or .zip):
 * - ZERO content_scripts on Amazon
 * - ZERO Amazon host permissions
 * - ZERO DOM scraping, click interception, or synthetic form filling
 * - Uses standard `tabs` permission ONLY to locate an open Amazon Vine tab and navigate to the clean ASIN review URL.
 * - Includes full standalone Local Studio (`studio.html`) backed by `browser.storage.local`.
 */
export async function generateCompanionFirefoxZip(
  studioOrigin: string,
  bridgeKey: string,
  mimeType: 'application/zip' | 'application/x-xpinstall' = 'application/zip'
): Promise<Blob> {
  const zip = new JSZip();
  const cleanOrigin = studioOrigin.replace(/\/+$/, '');
  const originPermission = /^https?:\/\//i.test(cleanOrigin) ? [`${cleanOrigin}/*`] : [];

  const manifest = {
    manifest_version: 2,
    name: 'VineCraft Studio Safe-Zone Extension',
    version: '2.1.0',
    description:
      'Local Safe-Zone VineCraft Studio & toolbar popup. Stores drafts in browser.storage.local (no Firebase), opens clean ASIN review URLs in your active Vine tab, and never injects scripts onto Amazon.',
    icons: {
      '48': 'icon.svg',
      '96': 'icon.svg',
    },
    browser_action: {
      default_icon: 'icon.svg',
      default_title: 'VineCraft Safe-Zone Companion',
      default_popup: 'popup.html',
    },
    permissions: [
      'storage',
      'tabs',
      'clipboardWrite',
      'http://127.0.0.1:7413/*',
      'http://localhost:7413/*',
      ...originPermission,
    ],
    browser_specific_settings: {
      gecko: {
        id: 'companion@vinecraft.studio',
        strict_min_version: '109.0',
      },
    },
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('icon.svg', COMPANION_ICON_SVG);
  zip.file('popup.html', buildSafePopupHtml());
  zip.file('popup.js', buildSafePopupScript(cleanOrigin, bridgeKey));
  zip.file('studio.html', buildStandaloneExtensionStudioHtml());
  zip.file('studio.js', buildStandaloneExtensionStudioScript(cleanOrigin, bridgeKey));
  zip.file(
    'README.txt',
    `VineCraft Studio Safe-Zone Firefox Extension (v2.1.0)\n\nSAFE-ZONE & PRIVACY GUARANTEE:\n- ZERO content scripts on Amazon.\n- ZERO Amazon host permissions.\n- ZERO Firebase or Google telemetry inside the extension.\n- Uses browser.storage.local + clean tab navigation to https://www.amazon.<tld>/review/create-review?encoding=UTF&asin=...\n\nInstall options:\n1. Temporary Add-on (Standard Firefox): Extract the .zip, open about:debugging#/runtime/this-firefox -> Load Temporary Add-on... -> select manifest.json.\n2. Permanent .xpi (Firefox Developer Edition / Nightly / ESR with xpinstall.signatures.required=false): Install vinecraft-studio-safe-zone.xpi directly from about:addons.\n`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  return mimeType === 'application/x-xpinstall'
    ? new Blob([blob], { type: 'application/x-xpinstall' })
    : blob;
}
