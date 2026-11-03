/* Frame.io V4 review client. Provider credentials stay on the server. */
(() => {
  'use strict';
  const BASE = '/api/frameio';
  const initialOpenTask = openTask;
  const fio = {
    epoch: 0, mode: null, taskId: null, status: null, csrf: '', accountId: '', projectId: '',
    projects: [], accounts: [], items: [], folders: [], nextCursor: null, data: null,
    fileId: '', draft: '', draftTime: 0, posting: false, uncertain: false, poll: null,
    eventCursor: '', eventPending: false, seenEvents: new Set(), request: 0, mediaTime: 0, frameRate: 25, fpsSource: 'default', cooldownUntil: 0, readCooldownUntil: 0, lastRefresh: 0, pollFailures: 0, versionStackId: '', accountsNextCursor: null, projectsNextCursor: null
  };
  const html = value => esc(value);
  const safeHttps = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  };
  const frameLink = value => safeFrame(value) || '';
  const currentTask = () => tasks.find(task => task.id === fio.taskId);
  const root = () => document.querySelector('[data-fio-root]');
  const active = (epoch = fio.epoch) => epoch === fio.epoch && Boolean(root());
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const timecode = (seconds, fps = 25) => {
    const value = Math.max(0, finite(seconds));
    const suppliedRate = Math.max(1, Math.min(120, finite(fps, 25)));
    const rate = Math.abs(suppliedRate - 23.976) < .001 ? 24000 / 1001 : Math.abs(suppliedRate - 29.97) < .001 ? 30000 / 1001 : Math.abs(suppliedRate - 59.94) < .001 ? 60000 / 1001 : suppliedRate;
    const nominal = Math.round(rate), totalFrames = Math.floor(value * rate + 0.000001);
    const whole = Math.floor(totalFrames / nominal), frames = totalFrames % nominal;
    return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, frames].map(x => String(x).padStart(2, '0')).join(':');
  };
  const displayTime = seconds => {
    if (fio.fpsSource !== 'default') return timecode(seconds, fio.frameRate);
    const whole = Math.floor(Math.max(0, finite(seconds)));
    return [Math.floor(whole / 60), whole % 60].map(x => String(x).padStart(2, '0')).join(':');
  };
  const fractional = rate => Math.abs(rate - Math.round(rate)) > .001;
  const drafts = new Map();
  try { const stored = JSON.parse(sessionStorage.getItem('gws-frameio-drafts-v1') || '[]'); if (Array.isArray(stored)) stored.slice(-50).forEach(([key, value]) => { if (typeof key === 'string' && value && typeof value.text === 'string' && value.text.length <= 5000) drafts.set(key, value); }); } catch {}
  function saveDrafts() { try { sessionStorage.setItem('gws-frameio-drafts-v1', JSON.stringify([...drafts].slice(-50))); } catch {} }
  function rememberDraft() {
    if (fio.mode !== 'review' || !fio.accountId || !fio.fileId) return;
    captureDraft();
    const key = fio.accountId + ':' + fio.fileId;
    if (fio.draft) drafts.set(key, { text: fio.draft, time: fio.draftTime, uncertain: fio.uncertain, frameRate: fio.frameRate, fpsSource: fio.fpsSource });
    else drafts.delete(key);
    saveDrafts();
  }
  const endpoint = (path, params = {}) => {
    const url = new URL(BASE + path, location.origin);
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value); });
    return url.pathname + url.search;
  };
  class FrameError extends Error {
    constructor(message, options = {}) { super(message); Object.assign(this, options); }
  }
  async function api(path, options = {}) {
    if (location.protocol === 'file:') throw new FrameError('Für die Frame.io-Anbindung muss GWS Studio über den mitgelieferten Server geöffnet werden.', { code: 'server_required' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const method = options.method || 'GET';
    const mutation = method !== 'GET';
    try {
      const response = await fetch(BASE + path, {
        method, credentials: 'same-origin', signal: controller.signal, cache: 'no-store',
        headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json', 'X-CSRF-Token': fio.csrf } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new FrameError('Der Frame.io-Server ist hier noch nicht verfügbar. Öffne die Serverversion von GWS Studio.', { code: 'server_required', uncertain: mutation });
      const data = await response.json();
      if (!response.ok || data.error) {
        const error = data.error || {};
        const retryAfter = Number(data.retryAfter || response.headers.get('retry-after')) || 0;
        let message = error.message || 'Die Anfrage an Frame.io konnte nicht abgeschlossen werden.';
        if (response.status === 429) message = `Frame.io ist gerade ausgelastet. ${retryAfter ? `Bitte in ${retryAfter} Sekunden erneut versuchen.` : 'Bitte später erneut versuchen.'}`;
        if (response.status === 401) message = error.message || 'Die Verbindung ist abgelaufen. Bitte erneut anmelden.';
        throw new FrameError(message, { code: error.code, status: response.status, retryAfter, uncertain: mutation && (response.status >= 500 || error.code === 'write_uncertain' || error.code === 'operation_in_progress') });
      }
      if (data.csrfToken) fio.csrf = data.csrfToken;
      return data;
    } catch (error) {
      if (error instanceof FrameError) throw error;
      throw new FrameError(error.name === 'AbortError' ? 'Die Anfrage dauert zu lange.' : 'Der Frame.io-Server ist nicht erreichbar.', { code: 'network_error', uncertain: mutation });
    } finally { clearTimeout(timer); }
  }
  function stopPolling() { if (fio.poll) clearInterval(fio.poll); fio.poll = null; fio.eventPending = false; }
  function begin(mode, taskId = null) {
    rememberDraft(); stopPolling(); fio.epoch++; fio.mode = mode; fio.taskId = taskId; fio.posting = false;
    fio.data = null; fio.draft = ''; fio.uncertain = false; drafts.delete(fio.accountId + ':' + fio.fileId); saveDrafts(); fio.mediaTime = 0; fio.frameRate = 25; fio.fpsSource = 'default'; fio.versionStackId = ''; fio.request++;
    return fio.epoch;
  }
  function show(title, body, footer = '', wide = false) {
    openModal(title, `<div class="fio-root" data-fio-root>${body}</div>`, footer, wide);
    document.querySelector('.modal')?.classList.add('fio-modal');
  }
  function loading(message) { return `<div class="fio-loading" role="status"><span class="fio-spinner"></span>${html(message)}</div>`; }
  function markLive() { return '<span class="fio-badge fio-badge-live"><span></span>Frame.io verbunden</span>'; }
  function note(message, kind = 'info') { return `<div class="fio-notice fio-notice-${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${html(message)}</div>`; }
  function setupDetails(missing = []) {
    const keys = missing.length ? missing : ['FRAMEIO_CLIENT_ID', 'FRAMEIO_CLIENT_SECRET', 'APP_ORIGIN', 'SESSION_SECRET'];
    return `<details class="fio-setup"><summary>Einrichtung für Administratoren</summary><p>Adobe-OAuth in der Serverkonfiguration einrichten. Zugangsdaten gehören ausschließlich in die Server-Umgebung, nicht in dieses Fenster.</p><p>Benötigte Konfiguration: <code>${keys.map(html).join('</code>, <code>')}</code>.</p><p>Die Callback-Adresse lautet <code>${html(location.protocol === 'file:' ? 'https://deine-domain/api/frameio/callback' : location.origin + '/api/frameio/callback')}</code>. Die Schritte stehen in der mitgelieferten Einrichtungsanleitung.</p></details>`;
  }
  function reconnectLink(error) { return ['connection_expired', 'not_connected'].includes(error.code) ? `<a class="btn primary small" href="${BASE}/connect" target="_top">Mit Adobe erneut verbinden ${icon('arrow')}</a>` : ''; }
  function statusError(error, taskId = fio.taskId) {
    const epoch = fio.epoch;
    show('Frame.io verbinden', `<div class="fio-intro"><span class="fio-brand">f/</span><h3>Dein Review beginnt hier.</h3><p>Videos, Versionen und Feedback direkt in deiner Aufgabe.</p></div>${note(error.message, error.status === 401 ? 'info' : 'error')}${reconnectLink(error)}${error.code === 'server_required' || error.code === 'network_error' ? setupDetails() : ''}`, `<button class="btn" data-action="close-modal">Schließen</button><button class="btn primary" data-fio-action="reconnect-status" data-task="${html(taskId || '')}">Erneut prüfen</button>`);
    return epoch;
  }
  async function connectScreen(taskId = null) {
    const epoch = begin('status', taskId);
    show('Frame.io', loading('Verbindung prüfen …'));
    try {
      const status = await api('/status');
      if (!active(epoch)) return;
      fio.status = status;
      if (status.connected) { fio.csrf = status.csrfToken || fio.csrf; return libraryScreen(taskId); }
      if (!status.configured) {
        show('Frame.io einrichten', `<div class="fio-intro"><span class="fio-brand">f/</span><h3>Alles für den nächsten Feinschliff.</h3><p>Die API-Anbindung ist vorbereitet. Diese Installation benötigt noch die Adobe-Konfiguration.</p></div>${note('Noch nicht verbunden · Es werden keine Frame.io-Daten geladen.')}${setupDetails(status.missing || [])}`, '<button class="btn" data-action="close-modal">Schließen</button><button class="btn primary" data-fio-action="reconnect-status">Konfiguration erneut prüfen</button>');
      } else {
        show('Frame.io verbinden', `<div class="fio-intro"><span class="fio-brand">f/</span><h3>Dein Schnitt. Dein Feedback. Ein Ort.</h3><p>Melde dich mit deinem Adobe-Konto an, um Dateien auszuwählen und Reviews direkt in GWS Studio zu bearbeiten.</p></div><div class="fio-feature-list"><span>${icon('film')}Video & Versionen</span><span>${icon('chat')}Zeitbezogenes Feedback</span><span>${icon('circlecheck')}Kommentare erledigen</span></div>${note('Die Verbindung verwendet dein angemeldetes Frame.io-Konto. Die lokale Rollenansicht ersetzt keine Frame.io-Berechtigungen.')}`, `<button class="btn" data-action="close-modal">Schließen</button><a class="btn primary" href="${BASE}/connect" target="_top">Mit Adobe verbinden ${icon('arrow')}</a>`);
      }
    } catch (error) { if (active(epoch)) statusError(error, taskId); }
  }
  const accountOptions = () => fio.accounts.map(account => `<option value="${html(account.id)}" ${account.id === fio.accountId ? 'selected' : ''}>${html(account.name || account.id)}</option>`).join('');
  const taskOptions = () => `<option value="">Aufgabe auswählen …</option>${tasks.filter(t => t.area === 'editing' && allowed(t.area)).map(t => `<option value="${html(t.id)}" ${t.id === fio.taskId ? 'selected' : ''}>${html(t.title)}</option>`).join('')}`;
  function libraryMarkup() {
    return `<div class="fio-library"><div class="fio-toolbar"><div><span class="fio-eyebrow">DEIN MEDIA WORKSPACE</span><h3>Das richtige Video für deine Aufgabe.</h3></div>${markLive()}</div><div id="fio-library-alert" aria-live="polite"></div><div class="fio-fields"><div class="form-field"><label for="fio-account">Frame.io-Konto</label><select id="fio-account">${accountOptions()}</select><div id="fio-accounts-more">${fio.accountsNextCursor ? '<button type="button" class="fio-text-button" data-fio-action="more-accounts">Weitere Konten laden</button>' : ''}</div></div><div class="form-field"><label for="fio-task">Mit Editing-Aufgabe verknüpfen</label><select id="fio-task">${taskOptions()}</select></div></div><div class="form-field"><label for="fio-project">Projekt</label><select id="fio-project"><option value="">Projekt auswählen …</option></select><div id="fio-projects-more"></div></div><div id="fio-folders" class="fio-breadcrumb"></div><div id="fio-files" class="fio-files" aria-live="polite">${loading('Projekte laden …')}</div><div id="fio-more"></div><details class="fio-direct"><summary>Datei über ihre ID öffnen</summary><form id="fio-direct-form"><label for="fio-file-id">Frame.io-Datei-ID</label><div class="fio-inline"><input id="fio-file-id" name="fileId" required maxlength="180" placeholder="Datei-ID aus Frame.io"><button class="btn small primary" type="submit">Verknüpfen</button></div><p>Die Datei wird mit dem oben ausgewählten Konto und der Editing-Aufgabe verknüpft. Ein Share-Link ist keine Datei-ID.</p></form></details><p class="fio-local-note">Die Zuordnung zur Aufgabe wird in diesem Browser gespeichert. Video und Kommentare bleiben in Frame.io.</p></div>`;
  }
  async function libraryScreen(taskId = fio.taskId) {
    const epoch = begin('library', taskId);
    show('Frame.io · Medien auswählen', loading('Deine Konten laden …'), '', true);
    try {
      const accounts = await api('/accounts');
      if (!active(epoch)) return;
      fio.accounts = Array.isArray(accounts.items) ? accounts.items : []; fio.accountsNextCursor = accounts.nextCursor || null;
      if (!fio.accounts.length) {
        show('Frame.io · Keine Konten', note('Für diese Anmeldung sind keine Frame.io-Konten verfügbar. Prüfe die Kontozuordnung und Berechtigungen in Adobe.'), '<button class="btn" data-action="close-modal">Schließen</button><button class="btn" data-fio-action="disconnect">Verbindung trennen</button>');
        return;
      }
      const linked = currentTask()?.frameio;
      fio.accountId = fio.accounts.some(a => a.id === linked?.accountId) ? linked.accountId : fio.accounts.some(a => a.id === config.frameioAccountId) ? config.frameioAccountId : fio.accounts[0].id;
      fio.projects = []; fio.folders = []; fio.items = []; fio.projectId = '';
      show('Frame.io · Medien auswählen', libraryMarkup(), '<button class="btn" data-fio-action="disconnect">Verbindung trennen</button><button class="btn" data-action="close-modal">Schließen</button>', true);
      await loadProjects(epoch);
    } catch (error) { if (active(epoch)) statusError(error, taskId); }
  }
  async function loadProjects(epoch = fio.epoch, append = false) {
    const requestId = ++fio.request;
    const files = document.querySelector('#fio-files');
    if (files && !append) files.innerHTML = loading('Projekte laden …');
    try {
      const data = await api('/projects?' + new URLSearchParams({ accountId: fio.accountId, ...(append && fio.projectsNextCursor ? { after: fio.projectsNextCursor } : {}) }));
      if (!active(epoch) || requestId !== fio.request) return;
      const items = Array.isArray(data.items) ? data.items : [];
      fio.projects = append ? [...fio.projects, ...items.filter(p => !fio.projects.some(old => old.id === p.id))] : items;
      fio.projectsNextCursor = data.nextCursor || null;
      document.querySelector('#fio-project').innerHTML = '<option value="">Projekt auswählen …</option>' + fio.projects.map(p => `<option value="${html(p.id)}" ${p.id === fio.projectId ? 'selected' : ''}>${html(p.name || p.id)}</option>`).join('');
      document.querySelector('#fio-projects-more').innerHTML = fio.projectsNextCursor ? '<button type="button" class="fio-text-button" data-fio-action="more-projects">Weitere Projekte laden</button>' : '';
      if (!append) document.querySelector('#fio-files').innerHTML = `<div class="fio-empty">${icon('film')}<strong>${fio.projects.length ? 'Wähle ein Projekt.' : 'Keine Projekte gefunden.'}</strong><p>${fio.projects.length ? 'Öffne anschließend einen Ordner und wähle dein Video aus.' : 'Du kannst eine Datei über ihre ID verknüpfen oder die Projektberechtigungen prüfen.'}</p></div>`;
    } catch (error) { if (active(epoch) && requestId === fio.request) libraryError(error); }
  }
  async function moreAccounts(button) {
    if (!fio.accountsNextCursor || button.disabled) return;
    const epoch = fio.epoch;
    button.disabled = true;
    try {
      const data = await api('/accounts?' + new URLSearchParams({ after: fio.accountsNextCursor }));
      if (!active(epoch)) return;
      fio.accounts = [...fio.accounts, ...(data.items || []).filter(a => !fio.accounts.some(old => old.id === a.id))];
      fio.accountsNextCursor = data.nextCursor || null;
      document.querySelector('#fio-account').innerHTML = accountOptions();
      document.querySelector('#fio-accounts-more').innerHTML = fio.accountsNextCursor ? '<button type="button" class="fio-text-button" data-fio-action="more-accounts">Weitere Konten laden</button>' : '';
    } catch (error) { if (active(epoch)) { libraryError(error); button.disabled = false; } }
  }
  function libraryError(error) {
    const alert = document.querySelector('#fio-library-alert');
    if (alert) alert.innerHTML = note(error.message, 'error') + reconnectLink(error);
    const files = document.querySelector('#fio-files');
    if (files && files.querySelector('.fio-loading')) files.innerHTML = '<div class="fio-empty"><p>Dateien konnten nicht geladen werden.</p><button class="btn small" data-fio-action="retry-files">Erneut laden</button></div>';
  }
  async function loadFiles({ append = false } = {}) {
    const epoch = fio.epoch, requestId = ++fio.request;
    const folder = fio.folders.at(-1);
    if (!folder) return;
    const alert = document.querySelector('#fio-library-alert');
    if (alert) alert.innerHTML = '';
    const more = document.querySelector('#fio-more');
    if (more) more.innerHTML = '';
    if (!append) document.querySelector('#fio-files').innerHTML = loading('Dateien laden …');
    const cursor = append ? fio.nextCursor : '';
    try {
      const data = await api('/files?' + new URLSearchParams({ accountId: fio.accountId, folderId: folder.id, ...(cursor ? { after: cursor } : {}) }));
      if (!active(epoch) || requestId !== fio.request) return;
      const items = Array.isArray(data.items) ? data.items : [];
      fio.items = append ? [...fio.items, ...items.filter(item => !fio.items.some(existing => existing.id === item.id))] : items;
      fio.nextCursor = data.nextCursor || null;
      drawFiles();
    } catch (error) { if (active(epoch) && requestId === fio.request) libraryError(error); }
  }
  function drawFiles() {
    document.querySelector('#fio-folders').innerHTML = fio.folders.map((folder, index) => `<button type="button" data-fio-action="breadcrumb" data-index="${index}" ${index === fio.folders.length - 1 ? 'aria-current="page"' : ''}>${html(folder.name)}</button>`).join('<span>/</span>');
    document.querySelector('#fio-files').innerHTML = fio.items.length ? fio.items.map(item => {
      const folder = item.type === 'folder', thumbnail = safeHttps(item.thumbnailUrl);
      return `<button class="fio-file ${folder ? 'fio-folder' : ''}" data-fio-action="${folder ? 'folder' : 'choose-file'}" data-id="${html(item.id)}"><span class="fio-file-thumb">${thumbnail && !folder ? `<img src="${html(thumbnail)}" alt="" loading="lazy">` : icon(folder ? 'library' : 'film')}</span><span class="fio-file-name"><strong>${html(item.name || 'Unbenannte Datei')}</strong><small>${folder ? 'Ordner öffnen' : 'Video für Review verknüpfen'}</small></span>${icon(folder ? 'chevron' : 'plus')}</button>`;
    }).join('') : '<div class="fio-empty"><strong>Dieser Ordner ist noch leer.</strong><p>Wechsle den Ordner oder verknüpfe eine Datei über ihre ID.</p></div>';
    document.querySelector('#fio-more').innerHTML = fio.nextCursor ? '<button class="btn small" data-fio-action="more-files">Weitere Dateien laden</button>' : '';
  }
  async function selectFile(fileId) {
    if (!fio.taskId) { document.querySelector('#fio-task')?.focus(); libraryError(new FrameError('Bitte wähle zuerst die Editing-Aufgabe für dieses Video aus.')); return; }
    if (!String(fileId).trim() || String(fileId).length > 180) return;
    const task = currentTask();
    if (!task || !allowed(task.area)) return;
    const epoch = fio.epoch, accountId = fio.accountId;
    try {
      const data = await getReview(String(fileId).trim());
      if (!active(epoch) || accountId !== fio.accountId) return;
      task.frameio = { accountId, fileId: String(fileId).trim() };
      config.frameioAccountId = accountId;
      persist();
      await reviewScreen(task.id, data);
    } catch (error) { if (active(epoch)) libraryError(error); }
  }
  async function reviewScreen(taskId, preloaded = null) {
    const task = tasks.find(item => item.id === taskId);
    if (!task?.frameio || !allowed(task.area)) return false;
    const epoch = begin('review', taskId);
    fio.accountId = task.frameio.accountId;
    fio.fileId = task.frameio.fileId;
    const draft = drafts.get(fio.accountId + ':' + fio.fileId);
    if (draft) { fio.draft = draft.text; fio.draftTime = draft.time; fio.uncertain = draft.uncertain; fio.frameRate = draft.frameRate; fio.fpsSource = draft.fpsSource; }
    fio.eventCursor = ''; fio.seenEvents.clear();
    show('Frame.io · Review', loading('Video, Versionen und Kommentare laden …'), '<button class="btn" data-action="task" data-id="' + html(taskId) + '">Zurück zur Aufgabe</button>', true);
    try {
      const data = preloaded || await getReview(fio.fileId);
      if (!active(epoch)) return false;
      fio.data = data; fio.lastRefresh = Date.now(); fio.pollFailures = 0; fio.fileId = data.file.id; fio.versionStackId = data.versionStackId || '';
      const resolvedDraft = drafts.get(fio.accountId + ':' + fio.fileId);
      if (resolvedDraft) { fio.draft = resolvedDraft.text; fio.draftTime = resolvedDraft.time; fio.uncertain = resolvedDraft.uncertain; fio.frameRate = resolvedDraft.frameRate; fio.fpsSource = resolvedDraft.fpsSource; }
      drawReview(); startPolling(); return true;
    } catch (error) {
      if (!active(epoch)) return false;
      show('Frame.io · Review', `${note(error.message, 'error')}${reconnectLink(error)}<p class="fio-local-note">Die Datei ist weiterhin mit dieser Aufgabe verknüpft. Es wurden keine Beispieldaten geladen.</p>`, `<button class="btn" data-action="task" data-id="${html(taskId)}">Zurück zur Aufgabe</button><button class="btn" data-fio-action="choose-another">Andere Datei wählen</button><button class="btn primary" data-fio-action="retry-review">Erneut laden</button>`, true);
      return false;
    }
  }
  function getReview(fileId) { return api('/review?' + new URLSearchParams({ accountId: fio.accountId, fileId, ...(fio.versionStackId ? {versionStackId: fio.versionStackId} : {}), ...(fio.fpsSource === 'user' ? {frameRate: String(fio.frameRate)} : {}) })); }
  function drawReview() {
    const data = fio.data, task = currentTask();
    if (!data?.file || !task) return;
    const file = data.file;
    if (finite(file.frameRate) > 0 && fio.fpsSource !== 'user') { fio.frameRate = finite(file.frameRate); fio.fpsSource = 'provider'; }
    const mediaUrl = safeHttps(file.mediaUrl), thumbnail = safeHttps(file.thumbnailUrl), viewUrl = frameLink(file.viewUrl);
    fio.csrf = data.csrfToken || fio.csrf;
    const versions = (Array.isArray(data.versions) ? data.versions : []).slice();
    if (!versions.some(version => version.id === fio.fileId)) versions.unshift({ id: fio.fileId, name: file.name, label: 'Ausgewählte Version' });
    show('Frame.io · Review', `<div class="fio-review"><div class="fio-toolbar"><div class="fio-title"><span class="fio-eyebrow">${html(task.id)} · ${html(task.title)}</span><h3>${html(file.name || 'Video-Review')}</h3></div>${markLive()}</div><div id="fio-review-alert" aria-live="polite"></div><div class="fio-review-grid"><div class="fio-viewer"><div class="fio-video-shell">${mediaUrl ? `<video id="fio-video" controls playsinline preload="metadata" ${thumbnail ? `poster="${html(thumbnail)}"` : ''}><source src="${html(mediaUrl)}">Dein Browser unterstützt diesen Videoplayer nicht.</video>` : `<div class="fio-media-unavailable">${icon('film')}<strong>Video noch nicht verfügbar</strong><p>Die Datei wird möglicherweise noch verarbeitet oder ist für diesen Player nicht abspielbar. Aktualisiere das Review oder öffne die Datei in Frame.io.</p></div>`}</div><div class="fio-playerbar"><div class="fio-time"><span id="fio-playhead">${displayTime(0)}</span><span class="fio-time-label">Aktuelle Zeitmarke</span></div><div class="fio-version"><label for="fio-version">Version</label><select id="fio-version">${versions.map(version => `<option value="${html(version.id)}" ${version.id === fio.fileId ? 'selected' : ''}>${html(version.label || version.name || version.id)}</option>`).join('')}</select></div><button class="icon-btn" data-fio-action="refresh-review" aria-label="Review aktualisieren" title="Review aktualisieren">${icon('clock')}</button></div><div class="fio-fps"><label for="fio-fps">Bildrate</label><select id="fio-fps" aria-label="Bildrate für Zeitmarken bestätigen">${[23.976,24,25,29.97,30,50,59.94,60].map(rate => `<option value="${rate}" ${Math.abs(rate - fio.frameRate) < .01 ? 'selected' : ''}>${rate} FPS${fractional(rate) ? ' (NDF)' : ''}</option>`).join('')}</select><button type="button" class="fio-text-button" data-fio-action="confirm-fps">Bestätigen</button><small id="fio-fps-note" class="${fio.fpsSource === 'default' ? 'fio-fps-pending' : ''}">${fio.fpsSource === 'default' ? 'FPS bestätigen: keine Bildrate von Frame.io übermittelt.' : fio.fpsSource === 'user' ? 'Bildrate von dir bestätigt.' + (fractional(fio.frameRate) ? ' Zeitcode: Non-Drop-Frame.' : '') : 'Bildrate aus Frame.io.'}</small></div><div class="fio-viewer-note">${icon('lock')}Video bleibt in Frame.io · Feedback gilt für die ausgewählte Version.</div></div><aside class="fio-feedback" aria-label="Frame.io-Kommentare"><div class="fio-feedback-head"><h4>Feedback <span id="fio-comment-count">${(data.comments || []).length}</span></h4><label><input id="fio-show-completed" type="checkbox" checked> Erledigte zeigen</label></div><div id="fio-comment-list" class="fio-comment-list"></div><form id="fio-comment-form" class="fio-comment-form"><label for="fio-comment-text">Dein Feedback <span id="fio-anchor-time">bei ${displayTime(fio.draft ? fio.draftTime : 0)}</span></label><textarea id="fio-comment-text" name="text" required maxlength="5000" placeholder="Was kann noch besser werden?" ${mediaUrl ? '' : 'disabled'}>${html(fio.draft)}</textarea><div class="fio-compose-bottom"><span>Wird in Frame.io gespeichert</span><button class="btn primary small" type="submit" ${mediaUrl || fio.draft ? '' : 'disabled'}>${icon('send')}Senden</button></div><div id="fio-comment-error" aria-live="polite"></div></form></aside></div></div>`, `<button class="btn" data-action="task" data-id="${html(task.id)}">Zurück zur Aufgabe</button><button class="btn" data-fio-action="choose-another">Video wechseln</button>${viewUrl ? `<a class="btn" href="${html(viewUrl)}" target="_blank" rel="noopener noreferrer">In Frame.io öffnen ${icon('external')}</a>` : ''}`, true);
    drawComments();
    const submit = document.querySelector('#fio-comment-form button[type="submit"]');
    if (submit) submit.disabled = !mediaUrl || fio.uncertain || Date.now() < fio.cooldownUntil;
    if (fio.uncertain) document.querySelector('#fio-comment-error').innerHTML = note('Der letzte Versandstatus ist unklar. Dein Entwurf bleibt in diesem Tab gespeichert. Prüfe zuerst die Kommentare, bevor du erneut sendest.', 'error') + '<button type="button" class="fio-text-button" data-fio-action="refresh-review">Kommentare prüfen</button>';
    const video = document.querySelector('#fio-video');
    if (video) {
      const updateTime = () => { fio.mediaTime = finite(video.currentTime); document.querySelector('#fio-playhead').textContent = displayTime(fio.mediaTime); if (!fio.draft) document.querySelector('#fio-anchor-time').textContent = 'bei ' + displayTime(fio.mediaTime); };
      video.addEventListener('timeupdate', updateTime);
      video.addEventListener('loadedmetadata', () => { if (fio.mediaTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(fio.mediaTime, video.duration); });
      video.addEventListener('error', () => { const alert = document.querySelector('#fio-review-alert'); if (alert) alert.innerHTML = note('Das Video konnte nicht abgespielt werden. Aktualisiere die Medien-URL oder öffne die Datei in Frame.io.', 'error'); });
    }
  }
  function drawComments() {
    const list = document.querySelector('#fio-comment-list');
    if (!list) return;
    const showCompleted = document.querySelector('#fio-show-completed')?.checked !== false;
    const comments = (fio.data?.comments || []).filter(comment => showCompleted || !comment.completed);
    list.innerHTML = comments.length ? comments.map(comment => {
      const hasTime = typeof comment.timestampSeconds === 'number' && Number.isFinite(comment.timestampSeconds);
      const seconds = hasTime ? Math.max(0, comment.timestampSeconds) : 0;
      const author = typeof comment.author === 'object' ? comment.author?.name || 'Frame.io-Nutzer' : comment.author || 'Frame.io-Nutzer';
      return `<article class="fio-comment ${comment.completed ? 'fio-comment-completed' : ''}"><div class="fio-comment-meta"><strong>${html(author)}</strong><button class="fio-comment-time" type="button" data-fio-action="seek" data-seconds="${seconds}" ${hasTime ? '' : 'disabled'} aria-label="Zu Zeitmarke ${html(displayTime(seconds))} springen">${html(hasTime ? ((fio.fpsSource !== 'default' && comment.timecode) || displayTime(seconds)) : comment.timecode || 'Ohne Zeitmarke')}</button></div><p>${html(comment.text)}</p><button class="fio-complete" type="button" data-fio-action="complete-comment" data-id="${html(comment.id)}" aria-pressed="${Boolean(comment.completed)}">${icon('circlecheck')}${comment.completed ? 'Erledigt · wieder öffnen' : 'Als erledigt markieren'}</button></article>`;
    }).join('') : '<div class="fio-empty"><span>✦</span><strong>Noch kein Feedback.</strong><p>Starte mit einem Kommentar an der passenden Zeitmarke.</p></div>';
    if (fio.data?.commentsNextCursor) list.insertAdjacentHTML('beforeend', '<div class="fio-comments-more"><button type="button" class="btn small" data-fio-action="more-comments">Weitere Kommentare laden</button></div>');
    const count = document.querySelector('#fio-comment-count'); if (count) count.textContent = String((fio.data?.comments || []).length) + (fio.data?.commentsNextCursor ? '+' : '');
  }
  function captureDraft() {
    const input = document.querySelector('#fio-comment-text');
    if (input) fio.draft = input.value;
  }
  async function refreshReview({ manual = true } = {}) {
    if (fio.mode !== 'review' || fio.posting) return false;
    if (Date.now() < fio.readCooldownUntil) { if (manual) { const alert = document.querySelector('#fio-review-alert'); if (alert) alert.innerHTML = note('Bitte warte kurz, bevor du Frame.io erneut aktualisierst. Der letzte Stand bleibt sichtbar.'); } return false; }
    const epoch = fio.epoch, fileId = fio.fileId;
    const requestId = ++fio.request;
    captureDraft();
    const button = document.querySelector('[data-fio-action="refresh-review"]');
    if (button) button.disabled = true;
    try {
      const data = await getReview(fileId);
      if (!active(epoch) || fileId !== fio.fileId || requestId !== fio.request) return;
      const priorMedia = fio.data?.file?.mediaUrl;
      fio.data = data; fio.lastRefresh = Date.now(); fio.pollFailures = 0;
      if (data.csrfToken) fio.csrf = data.csrfToken;
      const video = document.querySelector('#fio-video');
      if (video && safeHttps(data.file?.mediaUrl) && data.file.mediaUrl !== priorMedia) {
        const wasPaused = video.paused, position = video.currentTime;
        video.querySelector('source').src = safeHttps(data.file.mediaUrl);
        video.load();
        video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(position, Number.isFinite(video.duration) ? video.duration : position); if (!wasPaused) video.play().catch(() => {}); }, { once: true });
      } else if (!video && data.file?.mediaUrl) {
        drawReview();
      }
      const versions = Array.isArray(data.versions) ? data.versions : [];
      const selector = document.querySelector('#fio-version');
      if (!versions.some(version => version.id === fio.fileId)) versions.unshift({ id: fio.fileId, name: data.file?.name, label: 'Ausgewählte Version' });
      if (selector && versions.length) selector.innerHTML = versions.map(v => `<option value="${html(v.id)}" ${v.id === fio.fileId ? 'selected' : ''}>${html(v.label || v.name || v.id)}</option>`).join('');
      drawComments();
      const alert = document.querySelector('#fio-review-alert');
      if (alert) alert.innerHTML = manual ? note('Review aktualisiert.') : note('Neues Feedback aus Frame.io geladen.');
      if (fio.uncertain) {
        const text = fio.draft.trim();
        const found = (data.comments || []).some(c => c.text?.trim() === text && Math.abs(finite(c.timestampSeconds) - fio.draftTime) < 1);
        const error = document.querySelector('#fio-comment-error');
        if (found) {
          fio.draft = ''; fio.uncertain = false; drafts.delete(fio.accountId + ':' + fio.fileId); saveDrafts();
          const input = document.querySelector('#fio-comment-text'); if (input) input.value = '';
          if (error) error.innerHTML = note('Dein Kommentar ist in Frame.io angekommen.');
        } else if (error) error.innerHTML = note('Der Versandstatus ist noch unklar. Der Entwurf bleibt erhalten. Prüfe den Kommentarverlauf in Frame.io, bevor du den Entwurf erneut freigibst.', 'error') + '<button type="button" class="fio-text-button" data-fio-action="confirm-retry">Ich habe geprüft – Entwurf erneut freigeben</button>';
        const submit = document.querySelector('#fio-comment-form button[type="submit"]'); if (submit) submit.disabled = fio.uncertain || Date.now() < fio.cooldownUntil;
      }
      return true;
    } catch (error) { if (active(epoch)) { readBackoff(error); const alert = document.querySelector('#fio-review-alert'); if (alert) alert.innerHTML = note(error.message + ' Der zuletzt geladene Stand bleibt sichtbar.', 'error') + reconnectLink(error); } return false; }
    finally { if (active(epoch)) { const current = document.querySelector('[data-fio-action="refresh-review"]'); if (current) current.disabled = false; } }
  }
  function readBackoff(error) {
    fio.pollFailures = Math.min(fio.pollFailures + 1, 5);
    const delay = error.retryAfter ? Math.min(error.retryAfter, 3600) * 1000 : Math.min(300000, 15000 * 2 ** (fio.pollFailures - 1));
    fio.readCooldownUntil = Date.now() + delay;
    if (error.status === 401) stopPolling();
  }
  function startPolling() {
    stopPolling();
    const epoch = fio.epoch;
    fio.poll = setInterval(async () => {
      if (!active(epoch) || fio.mode !== 'review') { stopPolling(); return; }
      if (document.hidden || fio.eventPending || fio.posting || fio.draft.trim() || Date.now() < Math.max(fio.readCooldownUntil, fio.cooldownUntil)) return;
      fio.eventPending = true;
      try {
        // A bounded baseline refresh also catches deleted comments and installations without webhooks.
        if (Date.now() - fio.lastRefresh >= 60000) {
          await refreshReview({ manual: false });
          return;
        }
        const data = await api('/events?' + new URLSearchParams({ accountId: fio.accountId, fileId: fio.fileId, ...(fio.eventCursor ? { since: fio.eventCursor } : {}) }));
        if (!active(epoch)) return;
        fio.eventCursor = data.cursor || fio.eventCursor;
        const events = (data.events || []).filter(event => !fio.seenEvents.has(event.id || JSON.stringify(event)));
        events.forEach(event => fio.seenEvents.add(event.id || JSON.stringify(event)));
        if (events.length) await refreshReview({ manual: false });
        if (fio.seenEvents.size > 200) fio.seenEvents = new Set([...fio.seenEvents].slice(-100));
      } catch (error) {
        if (active(epoch)) {
          readBackoff(error);
          const alert = document.querySelector('#fio-review-alert');
          if (alert) alert.innerHTML = note(error.status === 401 ? 'Die Verbindung ist abgelaufen. Dein Entwurf bleibt erhalten.' : 'Automatische Aktualisierung wartet nach einem Verbindungsfehler. Der letzte Stand bleibt sichtbar.', 'info') + reconnectLink(error);
        }
      } finally { fio.eventPending = false; }
    }, 20000);
  }
  async function sendComment(form) {
    if (fio.posting || fio.uncertain || !fio.data || Date.now() < fio.cooldownUntil) return;
    if (fio.fpsSource === 'default') { document.querySelector('#fio-comment-error').innerHTML = note('Bitte bestätige zuerst die Bildrate deines Videos, damit die Zeitmarke korrekt in Frame.io ankommt.'); document.querySelector('#fio-fps')?.focus(); return; }
    const text = form.elements.text.value.trim();
    if (!text) return;
    const epoch = fio.epoch, fileId = fio.fileId;
    fio.posting = true; fio.draft = form.elements.text.value;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    const errors = document.querySelector('#fio-comment-error'); errors.innerHTML = '';
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const data = await api('/comments', { method: 'POST', body: { accountId: fio.accountId, fileId, text, timestampSeconds: fio.draftTime, frameRate: fio.frameRate, idempotencyKey } });
      if (!active(epoch) || fileId !== fio.fileId) return;
      if (data.comment) fio.data.comments = [...(fio.data.comments || []).filter(c => c.id !== data.comment.id), data.comment];
      fio.draft = ''; drafts.delete(fio.accountId + ':' + fio.fileId); saveDrafts(); form.elements.text.value = ''; drawComments();
      if (!data.comment) await refreshReview({ manual: true });
      toast('Feedback in Frame.io gespeichert');
    } catch (error) {
      if (!active(epoch)) return;
      fio.uncertain = Boolean(error.uncertain); rememberDraft();
      errors.innerHTML = note(error.uncertain ? 'Der Versandstatus ist unklar. Dein Entwurf bleibt erhalten. Aktualisiere zuerst die Kommentare; der Versand wird nicht automatisch wiederholt.' : error.message, 'error') + (error.uncertain ? '<button type="button" class="fio-text-button" data-fio-action="refresh-review">Kommentare prüfen</button>' : '') + reconnectLink(error);
      if (error.retryAfter) {
        fio.cooldownUntil = Date.now() + Math.min(error.retryAfter, 3600) * 1000;
        button.disabled = true;
        setTimeout(() => { if (active(epoch) && !fio.uncertain) button.disabled = false; }, Math.min(error.retryAfter, 3600) * 1000);
      }
    } finally { fio.posting = false; if (active(epoch)) button.disabled = fio.uncertain || Date.now() < fio.cooldownUntil; }
  }
  async function moreComments(button) {
    if (!fio.data?.commentsNextCursor || button.disabled) return;
    const epoch = fio.epoch, fileId = fio.fileId;
    button.disabled = true;
    try {
      const data = await api('/comments?' + new URLSearchParams({ accountId: fio.accountId, fileId, cursor: fio.data.commentsNextCursor, ...(fio.fpsSource !== 'default' ? { frameRate: String(fio.frameRate) } : {}) }));
      if (!active(epoch) || fileId !== fio.fileId) return;
      fio.data.comments = [...(fio.data.comments || []), ...(data.items || []).filter(c => !(fio.data.comments || []).some(old => old.id === c.id))];
      fio.data.commentsNextCursor = data.nextCursor || null;
      drawComments();
    } catch (error) { if (active(epoch)) { document.querySelector('#fio-review-alert').innerHTML = note(error.message, 'error'); button.disabled = false; } }
  }
  async function completeComment(button) {
    if (button.disabled) return;
    const comment = fio.data?.comments?.find(c => c.id === button.dataset.id);
    if (!comment) return;
    const epoch = fio.epoch;
    button.disabled = true;
    try {
      await api('/comments/' + encodeURIComponent(comment.id), { method: 'PATCH', body: { accountId: fio.accountId, fileId: fio.fileId, completed: !comment.completed } });
      if (active(epoch)) { comment.completed = !comment.completed; drawComments(); }
    } catch (error) {
      if (active(epoch)) document.querySelector('#fio-review-alert').innerHTML = note(error.message + (error.uncertain ? ' Bitte zuerst aktualisieren, bevor du den Status erneut änderst.' : ''), 'error');
    } finally { if (button.isConnected) button.disabled = false; }
  }
  async function disconnect(button) {
    button.disabled = true;
    const epoch = fio.epoch;
    try { await api('/disconnect', { method: 'POST', body: {} }); if (active(epoch)) { toast('Frame.io-Verbindung getrennt'); connectScreen(fio.taskId); } }
    catch (error) { if (active(epoch)) { const target = document.querySelector('#fio-library-alert') || root(); target.insertAdjacentHTML('afterbegin', note(error.message, 'error')); button.disabled = false; } }
  }
  openFrame = () => connectScreen();
  reviewTask = async id => {
    const task = tasks.find(t => t.id === id);
    if (!task || !allowed(task.area)) return;
    if (document.querySelector('#detail-title') && !saveDetail(id, false)) return;
    if (task.frameio?.accountId && task.frameio?.fileId) return reviewScreen(id);
    return connectScreen(id);
  };
  openTask = id => {
    initialOpenTask(id);
    const task = tasks.find(t => t.id === id);
    if (!task || task.area !== 'editing' || !allowed(task.area)) return;
    const box = document.querySelector('.modal .review-box');
    if (box) box.innerHTML = `<div class="fio-task-head"><strong><span class="frame-symbol">f/</span> Frame.io Review</strong>${task.frameio ? '<span class="fio-badge">Datei verknüpft</span>' : ''}</div><p>${task.frameio ? 'Öffne Video, Versionen und Kommentare direkt in dieser Aufgabe.' : 'Verknüpfe eine Frame.io-Datei für Video-Review und Feedback mit Zeitmarken.'}</p><button class="btn small" data-action="review" data-id="${html(id)}">${icon(task.frameio ? 'play' : 'plus')}${task.frameio ? 'Review öffnen' : 'Video verknüpfen'}</button>${task.frameio ? `<button class="btn small ghost" data-fio-action="unlink" data-task="${html(id)}">Verknüpfung entfernen</button>` : ''}`;
  };
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-fio-action]');
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.fioAction;
    if (action === 'confirm-fps') { const select = document.querySelector('#fio-fps'); select.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (action === 'reconnect-status') return connectScreen(button.dataset.task || fio.taskId);
    if (action === 'disconnect') return disconnect(button);
    if (action === 'folder') {
      const folder = fio.items.find(item => item.id === button.dataset.id && item.type === 'folder');
      if (folder) { fio.folders.push({ id: folder.id, name: folder.name }); await loadFiles(); }
    } else if (action === 'breadcrumb') { fio.folders = fio.folders.slice(0, Number(button.dataset.index) + 1); await loadFiles(); }
    else if (action === 'more-accounts') await moreAccounts(button);
    else if (action === 'more-projects') { button.disabled = true; await loadProjects(fio.epoch, true); if (button.isConnected) button.disabled = false; }
    else if (action === 'more-files') { button.disabled = true; await loadFiles({ append: true }); }
    else if (action === 'retry-files') { if (fio.folders.length) await loadFiles(); else await loadProjects(); }
    else if (action === 'choose-file') { button.disabled = true; await selectFile(button.dataset.id); if (button.isConnected) button.disabled = false; }
    else if (action === 'choose-another') await connectScreen(fio.taskId);
    else if (action === 'retry-review') await reviewScreen(fio.taskId);
    else if (action === 'refresh-review') await refreshReview();
    else if (action === 'seek') { const video = document.querySelector('#fio-video'); if (video) { video.currentTime = Math.max(0, finite(button.dataset.seconds)); video.focus(); } }
    else if (action === 'complete-comment') await completeComment(button);
    else if (action === 'more-comments') await moreComments(button);
    else if (action === 'confirm-retry') { fio.uncertain = false; document.querySelector('#fio-comment-error').innerHTML = note('Entwurf freigegeben. Prüfe Text und Zeitmarke vor dem erneuten Senden.'); const submit = document.querySelector('#fio-comment-form button[type="submit"]'); if (submit) submit.disabled = false; }
    else if (action === 'unlink') {
      const task = tasks.find(item => item.id === button.dataset.task);
      if (task && allowed(task.area)) { delete task.frameio; persist(); openTask(task.id); toast('Video-Verknüpfung entfernt'); }
    }
  });
  document.addEventListener('change', async event => {
    const target = event.target;
    if (target.id === 'fio-account') {
      fio.accountId = target.value; config.frameioAccountId = target.value; persist(); fio.folders = []; fio.items = []; fio.projectId = '';
      document.querySelector('#fio-folders').innerHTML = ''; document.querySelector('#fio-more').innerHTML = ''; await loadProjects();
    } else if (target.id === 'fio-project') {
      const project = fio.projects.find(item => item.id === target.value);
      fio.projectId = target.value; fio.folders = [];
      if (project?.rootFolderId) { fio.folders.push({ id: project.rootFolderId, name: project.name }); await loadFiles(); }
      else document.querySelector('#fio-files').innerHTML = '<div class="fio-empty"><p>Für dieses Projekt ist kein Hauptordner verfügbar. Du kannst eine Datei über ihre ID öffnen.</p></div>';
    } else if (target.id === 'fio-task') fio.taskId = target.value || null;
    else if (target.id === 'fio-show-completed') drawComments();
    else if (target.id === 'fio-fps') { fio.frameRate = Number(target.value); fio.fpsSource = 'user'; document.querySelector('#fio-fps-note').textContent = 'Bildrate von dir bestätigt.' + (fractional(fio.frameRate) ? ' Zeitcode: Non-Drop-Frame.' : ''); document.querySelector('#fio-fps-note').className = ''; document.querySelector('#fio-playhead').textContent = displayTime(fio.mediaTime); document.querySelector('#fio-anchor-time').textContent = 'bei ' + displayTime(fio.draft ? fio.draftTime : fio.mediaTime); drawComments(); await refreshReview({manual: false}); }
    else if (target.id === 'fio-version') {
      if (fio.posting) { target.value = fio.fileId; return; }
      captureDraft();
      if (fio.draft.trim()) { target.value = fio.fileId; document.querySelector('#fio-comment-error').innerHTML = note('Sende oder leere zuerst deinen Kommentarentwurf, bevor du die Version wechselst.'); return; }
      const epoch = fio.epoch, fileId = target.value;
      target.disabled = true; stopPolling();
      try { const data = await getReview(fileId); if (active(epoch)) { fio.fileId = data.file.id; fio.versionStackId = data.versionStackId || fio.versionStackId; fio.data = data; fio.mediaTime = 0; fio.uncertain = false; fio.eventCursor = ''; fio.seenEvents.clear(); drawReview(); startPolling(); } }
      catch (error) { if (active(epoch)) { target.value = fio.fileId; target.disabled = false; document.querySelector('#fio-review-alert').innerHTML = note(error.message, 'error'); startPolling(); } }
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'fio-comment-text') return;
    if (!fio.draft) {
      const video = document.querySelector('#fio-video'); if (video) video.pause();
      fio.draftTime = finite(video?.currentTime);
      document.querySelector('#fio-anchor-time').textContent = 'bei ' + displayTime(fio.draftTime);
    }
    fio.draft = event.target.value; rememberDraft();
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'fio-comment-form') { event.preventDefault(); sendComment(event.target); }
    else if (event.target.id === 'fio-direct-form') { event.preventDefault(); selectFile(event.target.elements.fileId.value); }
  });
  const observer = new MutationObserver(() => {
    if (fio.mode && !root()) { rememberDraft(); stopPolling(); fio.epoch++; fio.mode = null; fio.request++; }
  });
  observer.observe(document.querySelector('#modal-root'), { childList: true });
  const query = new URLSearchParams(location.search);
  if (query.has('frameio')) {
    const result = query.get('frameio');
    query.delete('frameio');
    history.replaceState(null, '', location.pathname + (query.size ? '?' + query.toString() : '') + location.hash);
    if (result === 'connected') { toast('Frame.io verbunden'); setTimeout(() => connectScreen(), 100); }
    else if (result === 'error') { setTimeout(() => connectScreen(), 100); }
  }
})();
