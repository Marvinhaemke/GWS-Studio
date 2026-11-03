/* GWS Studio login: server-owned sessions, no browser token or password persistence. */
(() => {
  'use strict';
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const submit = document.querySelector('#login-submit');
  const submitText = document.querySelector('#login-submit-text');
  const errorBox = document.querySelector('#login-error');
  const status = document.querySelector('#login-status');
  const setup = document.querySelector('#login-setup');
  const retry = document.querySelector('#login-retry');
  let busy = false;
  let ready = false;
  let retryUntil = 0;
  let retryTimer = null;
  const setError = message => { errorBox.textContent = message; errorBox.hidden = !message; };
  function formState() {
    const limited = Date.now() < retryUntil;
    email.disabled = busy || !ready;
    password.disabled = busy || !ready;
    submit.disabled = busy || !ready || limited;
    submitText.textContent = busy ? 'Anmeldung wird geprüft …' : limited ? `Bitte ${Math.max(1, Math.ceil((retryUntil - Date.now()) / 1000))} Sekunden warten` : 'Im Studio anmelden';
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  function cooldown(seconds) {
    clearInterval(retryTimer);
    retryUntil = Date.now() + Math.min(600, Math.max(1, seconds)) * 1000;
    retryTimer = setInterval(() => {
      formState();
      if (Date.now() >= retryUntil) { clearInterval(retryTimer); retryTimer = null; }
    }, 1000);
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, ...options });
    } finally { clearTimeout(timeout); }
  }
  async function session() {
    const response = await request('/api/studio/session', { headers: { Accept: 'application/json' } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('invalid_session_response');
    const data = await response.json();
    if (!data || typeof data.configured !== 'boolean' || typeof data.authenticated !== 'boolean') throw new Error('invalid_session_response');
    if (!response.ok && data.configured !== false) throw new Error('session_unavailable');
    return data;
  }
  async function checkStatus() {
    if (busy) return;
    busy = true; ready = false; retry.disabled = true; retry.hidden = true;
    setup.hidden = true; form.hidden = true; status.hidden = false;
    status.textContent = 'Verbindung zum Studio wird geprüft …';
    setError(''); formState();
    try {
      const data = await session();
      if (data.configured && data.authenticated) { location.replace('/'); return; }
      if (!data.configured) {
        setup.hidden = false;
        status.hidden = true;
        retry.hidden = false;
      } else {
        ready = true;
        status.hidden = true;
        form.hidden = false;
      }
    } catch {
      status.textContent = 'Das Studio ist gerade nicht erreichbar. Bitte prüfe die Verbindung und versuche es erneut.';
      retry.hidden = false;
    } finally {
      busy = false; retry.disabled = false; formState();
      if (ready) email.focus();
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !ready || Date.now() < retryUntil || !form.checkValidity()) return;
    busy = true; setError(''); retry.hidden = true; formState();
    try {
      const response = await request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: password.value, callbackURL: '/' })
      });
      if (response.status === 429) {
        const wait = Number(response.headers.get('Retry-After'));
        cooldown(Number.isFinite(wait) && wait > 0 ? wait : 30);
        setError('Zu viele Anmeldeversuche. Bitte warte einen Moment und versuche es erneut.');
        return;
      }
      if (!response.ok) {
        setError([400, 401, 403].includes(response.status) ? 'Die Anmeldung war nicht erfolgreich. Prüfe deine E-Mail-Adresse und dein Passwort.' : 'Die Anmeldung ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.');
        return;
      }
      // Confirm the HttpOnly session instead of using a token or redirect from the response body.
      const data = await session();
      if (data.configured && data.authenticated) { password.value = ''; location.replace('/'); return; }
      password.value = '';
      setError('Die Sitzung konnte noch nicht bestätigt werden. Bitte prüfe den Anmeldestatus erneut.');
      retry.hidden = false;
      retry.textContent = 'Anmeldestatus prüfen';
    } catch {
      setError('Der Anmeldestatus ist gerade unklar. Prüfe die Verbindung und den Anmeldestatus, bevor du es erneut versuchst.');
      retry.hidden = false;
      retry.textContent = 'Anmeldestatus prüfen';
    } finally { busy = false; formState(); }
  });
  retry.addEventListener('click', checkStatus);
  checkStatus();
})();
