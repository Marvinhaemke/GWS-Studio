import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../public/frameio.js', import.meta.url), 'utf8');
function setup() {
  const nodes = new Map(), events = {}, requests = [], queue = [], intervals = new Set();
  let opened = false, modal = { title: '', body: '', footer: '' }, observer;
  const node = () => ({ innerHTML: '', value: '', checked: true, disabled: false, isConnected: true, style: {}, dataset: {}, textContent: '', className: '', classList: { add() {} }, addEventListener() {}, focus() {}, querySelector() { return null; }, insertAdjacentHTML(where, html) { this.innerHTML = where === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html; } });
  const document = {
    hidden: false,
    querySelector(selector) {
      if (selector === '#detail-title') return null;
      if (selector === '[data-fio-root]') return opened ? node() : null;
      if (selector === '#fio-video' && !modal.body.includes('id="fio-video"')) return null;
      if (!nodes.has(selector)) {
        const item = node();
        if (selector === '#fio-video') Object.assign(item, { currentTime: 0, duration: 60, paused: true, pause() {}, load() {}, play() { return Promise.resolve(); }, querySelector() { return { src: '' }; } });
        nodes.set(selector, item);
      }
      return nodes.get(selector);
    },
    addEventListener(type, callback) { (events[type] ||= []).push(callback); }
  };
  const state = {
    tasks: [{ id: 'ED-101', title: 'Testaufgabe', area: 'editing', frameio: { accountId: 'account', fileId: 'stack' } }],
    config: {}, document, URL, URLSearchParams, AbortController, crypto: webcrypto, Date,
    location: { protocol: 'https:', origin: 'https://studio.example', pathname: '/', search: '', hash: '' },
    history: { replaceState() {} },
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(callback) { intervals.add(callback); return callback; }, clearInterval(callback) { intervals.delete(callback); },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    icon(name) { return `<svg data-icon="${name}"></svg>`; },
    safeFrame(value) { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'f.io' || url.hostname === 'frame.io' || url.hostname.endsWith('.frame.io')) ? url.href : null; } catch { return null; } },
    allowed() { return true; }, persist() {}, renderWorkspace() {}, closeModal() { opened = false; observer?.(); }, toast() {}, saveDetail() { return true; },
    openTask() {}, openFrame() {}, reviewTask() {},
    openModal(title, body, footer) { opened = true; nodes.clear(); modal = { title, body, footer }; },
    async fetch(url, options) {
      requests.push({ url, options });
      const next = queue.shift();
      assert.ok(next, `Unexpected request: ${url}`);
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: { 'Content-Type': 'application/json', ...next.headers } });
    }
  };
  const context = vm.createContext(state);
  const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.__fioTest = { fio, timecode, displayTime, api, moreComments, sendComment, refreshReview };})();');
  vm.runInContext(exposed, context);
  return { context, nodes, requests, queue, intervals, test: context.__fioTest, get modal() { return modal; } };
}
function review(overrides = {}) {
  return { file: { id: 'actual-file', name: 'Founder Reel', mediaUrl: 'https://media.frame.io/video.mp4', viewUrl: 'https://next.frame.io/player/actual-file', frameRate: null }, versions: [{ id: 'actual-file', label: 'V2' }], versionStackId: 'stack', comments: [], csrfToken: 'csrf', ...overrides };
}
function commentForm(client, value) {
  const button = { disabled: false, isConnected: true };
  client.context.document.querySelector('#fio-comment-text').value = value;
  return { elements: { text: { value } }, querySelector() { return button; }, button };
}

test('unconfigured installation stays disconnected and exposes no credential fields', async () => {
  const client = setup();
  client.queue.push({ body: { configured: false, connected: false, missing: ['FRAMEIO_CLIENT_ID'] } });
  await client.context.openFrame();
  assert.match(client.modal.body, /Noch nicht verbunden/);
  assert.match(client.modal.body, /FRAMEIO_CLIENT_ID/);
  assert.doesNotMatch(client.modal.body, /type="password"|Frame.io verbunden/);
  assert.equal(client.requests.length, 1);
});

test('version-stack review targets actual head file and escapes provider comments', async () => {
  const client = setup();
  client.queue.push({ body: review({ comments: [{ id: 'c1', text: '<img src=x onerror=alert(1)>', author: '<script>bad()</script>', timestampSeconds: null, timestampUnsupported: true, completed: false }] }) });
  await client.context.reviewTask('ED-101');
  assert.equal(client.test.fio.fileId, 'actual-file');
  assert.equal(client.context.tasks[0].frameio.fileId, 'stack', 'task retains stack linkage');
  const comments = client.nodes.get('#fio-comment-list').innerHTML;
  assert.match(comments, /&lt;img/);
  assert.match(comments, /&lt;script/);
  assert.match(comments, /disabled/);
  assert.match(comments, /Ohne Zeitmarke/);
  assert.doesNotMatch(comments, /<img|<script/);
  assert.equal(client.intervals.size, 1);
  client.context.closeModal();
  assert.equal(client.intervals.size, 0, 'closing review stops polling');
});

test('confirmed fractional timecode uses canonical total-frame NDF conversion', () => {
  const client = setup();
  assert.equal(client.test.displayTime(61.2), '01:01', 'unknown FPS uses elapsed time');
  assert.equal(client.test.timecode(3600, 29.97), '00:59:56:12');
  assert.equal(client.test.timecode(3600, 23.976), '00:59:56:09');
  client.test.fio.fpsSource = 'user'; client.test.fio.frameRate = 29.97;
  assert.equal(client.test.displayTime(3600), '00:59:56:12', 'confirmed formatter does not recurse');
});

test('comment requires confirmed FPS and rate-limit cooldown blocks duplicate sends', async () => {
  const client = setup();
  client.queue.push({ body: review() });
  await client.context.reviewTask('ED-101');
  const form = commentForm(client, 'Bitte das Logo länger stehen lassen.');
  await client.test.sendComment(form);
  assert.equal(client.requests.length, 1, 'unknown FPS must not issue a write');
  client.test.fio.fpsSource = 'user'; client.test.fio.frameRate = 25;
  client.queue.push({ status: 429, body: { error: { code: 'rate_limited', message: 'Langsamer' }, retryAfter: 30 } });
  await client.test.sendComment(form);
  assert.equal(form.button.disabled, true, 'finally must preserve cooldown');
  assert.equal(client.test.fio.draft, form.elements.text.value);
  await client.test.sendComment(form);
  assert.equal(client.requests.filter(r => r.options.method === 'POST').length, 1);
  const request = client.requests.find(r => r.options.method === 'POST');
  assert.equal(request.options.headers['X-CSRF-Token'], 'csrf');
  assert.equal(JSON.parse(request.options.body).fileId, 'actual-file');
});

test('uncertain write retains draft and cannot replay before explicit review check', async () => {
  const client = setup();
  client.queue.push({ body: review() });
  await client.context.reviewTask('ED-101');
  const form = commentForm(client, 'Feinschnitt prüfen');
  client.test.fio.fpsSource = 'user'; client.test.fio.frameRate = 25; client.test.fio.draftTime = 12;
  client.queue.push(new TypeError('network disconnected'));
  await client.test.sendComment(form);
  assert.equal(client.test.fio.uncertain, true);
  assert.equal(client.test.fio.draft, 'Feinschnitt prüfen');
  assert.equal(form.button.disabled, true);
  await client.test.sendComment(form);
  assert.equal(client.requests.filter(r => r.options.method === 'POST').length, 1);
  client.queue.push({ body: review({ comments: [{ id: 'arrived', text: 'Feinschnitt prüfen', timestampSeconds: 12, author: 'Editor', completed: false }] }) });
  await client.test.refreshReview();
  assert.equal(client.test.fio.uncertain, false);
  assert.equal(client.test.fio.draft, '');
  assert.equal(client.requests.filter(r => r.options.method === 'POST').length, 1, 'refresh never replays write');
});

test('comment pagination preserves existing entries and passes the server cursor', async () => {
  const client = setup();
  client.queue.push({ body: review({ comments: [{ id: 'c1', text: 'Erstes Feedback', timestampSeconds: 0, author: 'Editor' }], commentsNextCursor: 'next-page' }) });
  await client.context.reviewTask('ED-101');
  client.queue.push({ body: { items: [{ id: 'c1', text: 'Duplikat' }, { id: 'c2', text: 'Weiteres Feedback', timestampSeconds: 2, author: 'Editor' }], nextCursor: null } });
  await client.test.moreComments({ disabled: false });
  assert.equal(client.test.fio.data.comments.length, 2);
  assert.match(client.requests.at(-1).url, /cursor=next-page/);
  assert.match(client.nodes.get('#fio-comment-list').innerHTML, /Erstes Feedback/);
  assert.match(client.nodes.get('#fio-comment-list').innerHTML, /Weiteres Feedback/);
});

test('revoked Adobe authorization offers top-level reconnect instead of a status retry loop', async () => {
  const client = setup();
  client.queue.push({ status: 401, body: { error: { code: 'connection_expired', message: 'Bitte erneut verbinden.' } } });
  await client.context.reviewTask('ED-101');
  assert.match(client.modal.body, /href="\/api\/frameio\/connect" target="_top"/);
  assert.match(client.modal.body, /Mit Adobe erneut verbinden/);
  assert.equal(client.requests.length, 1, 'failure never redirects or retries automatically');
});


test('baseline sync refreshes without webhooks and skips drafts, hidden tabs and backoff', async () => {
  const client = setup();
  client.queue.push({ body: review() });
  await client.context.reviewTask('ED-101');
  const poll = [...client.intervals][0];
  client.test.fio.lastRefresh = Date.now() - 61000;
  client.test.fio.draft = 'Noch nicht senden';
  await poll();
  assert.equal(client.requests.length, 1, 'draft suppresses automatic refresh');
  client.test.fio.draft = '';
  client.context.document.hidden = true;
  await poll();
  assert.equal(client.requests.length, 1, 'hidden tab suppresses polling');
  client.context.document.hidden = false;
  client.queue.push({ body: review({ comments: [{ id: 'new', text: 'Externes Feedback', timestampSeconds: 2, author: 'Editor' }] }) });
  await poll();
  assert.match(client.requests.at(-1).url, /\/review\?/);
  assert.equal(client.test.fio.data.comments[0].id, 'new');
  client.test.fio.lastRefresh = Date.now() - 61000;
  client.queue.push({ status: 429, body: { error: { code: 'rate_limited', message: 'Warten' }, retryAfter: 60 } });
  await poll();
  const count = client.requests.length;
  await poll();
  assert.equal(client.requests.length, count, 'Retry-After prevents another poll');
  assert.ok(client.test.fio.readCooldownUntil > Date.now());
});
