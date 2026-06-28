// ─────────────────────────────────────────────────────────────────────────────
//  Gmail for Meta Ray-Ban Display Glasses
//  Meta Wearables Web App · 600×600dp · D-pad navigation
//
//  SETUP (one-time):
//  1. Go to console.cloud.google.com → create/select a project
//  2. Enable "Gmail API"
//  3. Create OAuth 2.0 credentials → type "TVs and Limited Input devices"
//  4. Paste your Client ID below
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/gmail.modify',
  DEVICE_CODE_URL: 'https://oauth2.googleapis.com/device/code',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GMAIL_API: 'https://gmail.googleapis.com/gmail/v1',
  INBOX_SIZE: 15,
};

// ── STORAGE ───────────────────────────────────────────────────────────────────
const Store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ── AUTH ─────────────────────────────────────────────────────────────────────
const Auth = {
  _accessToken: null,
  _refreshToken: null,
  _expiresAt: 0,
  _pollTimer: null,

  init() {
    const saved = Store.get('auth');
    if (saved) {
      this._accessToken  = saved.access_token;
      this._refreshToken = saved.refresh_token;
      this._expiresAt    = saved.expires_at || 0;
    }
  },

  isValid() {
    return !!this._accessToken && Date.now() < this._expiresAt - 30_000;
  },

  async getToken() {
    if (this.isValid()) return this._accessToken;
    if (this._refreshToken) {
      await this._refresh();
      if (this.isValid()) return this._accessToken;
    }
    return null;
  },

  async _refresh() {
    try {
      const res = await fetch(CONFIG.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CONFIG.GOOGLE_CLIENT_ID,
          grant_type:    'refresh_token',
          refresh_token: this._refreshToken,
        }),
      });
      if (!res.ok) { this._clear(); return; }
      this._save(await res.json());
    } catch { this._clear(); }
  },

  _save(data) {
    this._accessToken  = data.access_token;
    if (data.refresh_token) this._refreshToken = data.refresh_token;
    this._expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    Store.set('auth', {
      access_token:  this._accessToken,
      refresh_token: this._refreshToken,
      expires_at:    this._expiresAt,
    });
  },

  _clear() {
    this._accessToken = this._refreshToken = null;
    this._expiresAt = 0;
    Store.del('auth');
  },

  // Google Device Authorization Grant (RFC 8628)
  async startDeviceFlow(onCode, onSuccess, onError) {
    if (this._pollTimer) clearTimeout(this._pollTimer);

    let data;
    try {
      const res = await fetch(CONFIG.DEVICE_CODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CONFIG.GOOGLE_CLIENT_ID, scope: CONFIG.SCOPES }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      onError(`Could not start sign-in: ${e.message}`);
      return;
    }

    onCode({
      userCode: data.user_code,
      expiresIn: data.expires_in,
    });

    const interval = (data.interval || 5) * 1000;
    const expiry   = Date.now() + data.expires_in * 1000;

    const poll = async () => {
      if (Date.now() > expiry) { onError('Authorization timed out. Tap to try again.'); return; }
      try {
        const r = await fetch(CONFIG.TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id:   CONFIG.GOOGLE_CLIENT_ID,
            device_code: data.device_code,
            grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        const t = await r.json();
        if (t.access_token) { this._save(t); onSuccess(); return; }
        if (t.error === 'authorization_pending' || t.error === 'slow_down') {
          this._pollTimer = setTimeout(poll, t.error === 'slow_down' ? interval * 2 : interval);
          return;
        }
        onError(t.error_description || t.error || 'Authorization failed.');
      } catch { this._pollTimer = setTimeout(poll, interval); }
    };

    this._pollTimer = setTimeout(poll, interval);
  },

  signOut() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    this._clear();
  },
};

// ── GMAIL API ─────────────────────────────────────────────────────────────────
const Gmail = {
  async _req(path, opts = {}) {
    const token = await Auth.getToken();
    if (!token) throw new Error('session_expired');
    const res = await fetch(`${CONFIG.GMAIL_API}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 401) { Auth._clear(); throw new Error('session_expired'); }
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`Gmail API ${res.status}`);
    return res.json();
  },

  getProfile() {
    return this._req('/users/me/profile');
  },

  listInbox(max = CONFIG.INBOX_SIZE) {
    return this._req(`/users/me/messages?labelIds=INBOX&maxResults=${max}`);
  },

  getMessageMeta(id) {
    return this._req(`/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`);
  },

  getMessageFull(id) {
    return this._req(`/users/me/messages/${id}?format=full`);
  },

  archive(id) {
    return this._req(`/users/me/messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    });
  },

  trash(id) {
    return this._req(`/users/me/messages/${id}/trash`, { method: 'POST' });
  },

  async sendReply(threadId, to, subject, bodyText, messageId) {
    const profile = await this.getProfile();
    const reSubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
    const lines = [
      `From: ${profile.emailAddress}`,
      `To: ${to}`,
      `Subject: ${reSubject}`,
      ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
      'Content-Type: text/plain; charset=UTF-8',
      '',
      bodyText,
    ];
    const raw = lines.join('\r\n');
    // base64url-encode the full RFC 2822 message
    const bytes   = new TextEncoder().encode(raw);
    const binary  = Array.from(bytes, b => String.fromCharCode(b)).join('');
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return this._req('/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: encoded, threadId }),
    });
  },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function header(msg, name) {
  return (msg.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBody(msg) {
  const b64 = str => {
    try { return decodeURIComponent(Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); }
    catch { return ''; }
  };

  const extract = (part) => {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) return b64(part.body.data);
    if (part.mimeType === 'text/html'  && part.body?.data) {
      const d = document.createElement('div');
      d.innerHTML = b64(part.body.data);
      d.querySelectorAll('script,style,img,head').forEach(el => el.remove());
      return (d.textContent || d.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (part.parts) return part.parts.map(extract).filter(Boolean)[0] || '';
    return '';
  };

  if (msg.payload?.body?.data) return b64(msg.payload.body.data);
  if (msg.payload?.parts)      return extract({ parts: msg.payload.parts });
  return msg.snippet || '';
}

function fmtDate(str) {
  if (!str) return '';
  try {
    const d = new Date(str);
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return str; }
}

function displayName(from) {
  const m = from.match(/^"?([^"<]+?)"?\s*(?:<[^>]+>)?$/);
  return m ? m[1].trim() : from.replace(/<[^>]+>/, '').trim() || from;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── REPLY SUGGESTIONS ─────────────────────────────────────────────────────────
function suggestReplies(subject, body) {
  const t = `${subject} ${body}`.toLowerCase();
  const rules = [
    { re: /\bmeeting|calendar|schedule|call|zoom|teams|appointment\b/, replies: [
      "That time works for me!", "I'm available — let's confirm.", "Can we reschedule? I have a conflict.", "Please send a calendar invite.",
    ]},
    { re: /\?|question|wondering|could you|can you|would you|how do|when (is|will|can)/, replies: [
      "Thanks for your question — I'll look into it.", "Great question! Let me get back to you soon.", "I'll check on this and respond today.", "Sure, I can help with that!",
    ]},
    { re: /\bplease|request|need|require|asap|urgent|deadline\b/, replies: [
      "On it! I'll get back to you shortly.", "Received — I'll handle this today.", "Thanks for the heads up. I'm on it.", "I'll do my best to meet that deadline.",
    ]},
    { re: /\bthank|thanks|appreciate|grateful\b/, replies: [
      "You're welcome!", "Happy to help!", "Anytime — let me know if you need anything.", "Thanks for the kind words!",
    ]},
    { re: /\bfollow.?up|checking in|update|status|progress|any news\b/, replies: [
      "Still working on it — I'll update you soon.", "Thanks for following up. I'll prioritize this.", "I should have an update by end of day.", "Apologies for the delay — I'll circle back today.",
    ]},
    { re: /\bfyi|attached|sharing|sending over|take a look|please find\b/, replies: [
      "Thanks for sharing!", "Got it, thanks.", "Received — I'll review and follow up.", "Thanks for the heads up!",
    ]},
  ];

  for (const { re, replies } of rules) {
    if (re.test(t)) return replies;
  }

  return ["Thanks for reaching out!", "Got it — I'll follow up soon.", "Received, thank you!", "Noted. I'll get back to you."];
}

// ── APP ───────────────────────────────────────────────────────────────────────
const App = {
  emails:         [],
  cache:          {},
  currentEmail:   null,
  history:        [],
  confirmCb:      null,
  _recognition:   null,
  _toastTimer:    null,

  // ── INIT ──────────────────────────────────────────────────────────────
  init() {
    this._bindEvents();
    Auth.init();
    this._checkAuth();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  // ── AUTH ──────────────────────────────────────────────────────────────
  async _checkAuth() {
    const token = await Auth.getToken();
    if (token) { this._postAuth(); } else { this._startDeviceFlow(); }
  },

  _startDeviceFlow() {
    this._show('screen-auth');
    this._el('auth-loading').classList.remove('hidden');
    this._el('auth-code-view').classList.add('hidden');
    this._el('auth-error-view').classList.add('hidden');

    Auth.startDeviceFlow(
      ({ userCode, expiresIn }) => {
        this._el('auth-loading').classList.add('hidden');
        this._el('auth-code-view').classList.remove('hidden');
        this._el('user-code').textContent = userCode;
        this._el('auth-expires').textContent = `Expires in ${Math.ceil(expiresIn / 60)} min`;
      },
      () => this._postAuth(),
      (msg) => {
        this._el('auth-loading').classList.add('hidden');
        this._el('auth-code-view').classList.add('hidden');
        this._el('auth-error-view').classList.remove('hidden');
        this._el('auth-error-msg').textContent = msg;
        setTimeout(() => this._el('auth-error-view').querySelector('button')?.focus(), 50);
      }
    );
  },

  async _postAuth() {
    try {
      const p = await Gmail.getProfile();
      this._userEmail = p.emailAddress || '';
    } catch {}
    this._loadInbox();
  },

  // ── INBOX ──────────────────────────────────────────────────────────────
  async _loadInbox(silent = false) {
    this._show('screen-inbox');
    const list = this._el('email-list');

    if (!silent) list.innerHTML = '<li style="padding:20px;text-align:center;opacity:.5">Loading…</li>';

    try {
      const data = await Gmail.listInbox();
      this.emails = data.messages || [];

      if (!this.emails.length) {
        list.innerHTML = '<li style="padding:20px;text-align:center;opacity:.5">No emails in inbox</li>';
        this._el('inbox-badge').classList.add('hidden');
        return;
      }

      // Fetch metadata for all messages in parallel
      const metas = await Promise.all(this.emails.map(s => Gmail.getMessageMeta(s.id).catch(() => null)));
      metas.forEach((m, i) => { if (m) this.cache[this.emails[i].id] = m; });
      this._renderInbox();
    } catch (e) {
      if (e.message === 'session_expired') { this._startDeviceFlow(); return; }
      list.innerHTML = `<li style="padding:20px;text-align:center;color:#FF4444">Error: ${esc(e.message)}</li>`;
    }
  },

  _renderInbox() {
    const list = this._el('email-list');
    list.innerHTML = '';

    const unread = this.emails.filter(s => this.cache[s.id]?.labelIds?.includes('UNREAD')).length;
    const badge  = this._el('inbox-badge');
    if (unread) { badge.textContent = String(unread); badge.classList.remove('hidden'); }
    else         { badge.classList.add('hidden'); }

    this.emails.forEach(stub => {
      const msg     = this.cache[stub.id];
      const from    = header(msg, 'From');
      const subject = header(msg, 'Subject') || '(no subject)';
      const date    = fmtDate(header(msg, 'Date'));
      const isUnread = msg?.labelIds?.includes('UNREAD');

      const li = document.createElement('li');
      li.className = `email-item focusable${isUnread ? ' unread' : ''}`;
      li.tabIndex  = 0;
      li.dataset.id = stub.id;
      li.setAttribute('role', 'listitem');
      li.setAttribute('aria-label', `${isUnread ? 'Unread. ' : ''}From ${displayName(from)}. ${subject}`);
      li.innerHTML = `
        <div class="email-row">
          <span class="email-sender">${esc(displayName(from) || 'Unknown')}</span>
          <span class="email-time">${esc(date)}</span>
        </div>
        <span class="email-subject">${esc(subject)}</span>
        <span class="email-preview">${esc(stub.snippet || '')}</span>`;

      li.addEventListener('click', () => this._openEmail(stub.id));
      list.appendChild(li);
    });

    list.querySelector('.focusable')?.focus();
  },

  // ── EMAIL DETAIL ──────────────────────────────────────────────────────
  async _openEmail(id) {
    this._push('inbox');
    this._show('screen-detail');

    const cached = this.cache[id];
    if (cached) {
      this._el('detail-from').textContent    = displayName(header(cached, 'From')) || 'Unknown';
      this._el('detail-date').textContent    = fmtDate(header(cached, 'Date'));
      this._el('detail-subject').textContent = header(cached, 'Subject') || '(no subject)';
    }
    this._el('detail-body').textContent = 'Loading…';

    try {
      const full = await Gmail.getMessageFull(id);
      this.cache[id] = full;
      this.currentEmail = full;

      const body = decodeBody(full).trim();
      this._el('detail-from').textContent    = displayName(header(full, 'From')) || 'Unknown';
      this._el('detail-date').textContent    = fmtDate(header(full, 'Date'));
      this._el('detail-subject').textContent = header(full, 'Subject') || '(no subject)';
      this._el('detail-body').textContent    = body.slice(0, 2000) + (body.length > 2000 ? '\n\n[message truncated]' : '');
    } catch (e) {
      if (e.message === 'session_expired') { this._startDeviceFlow(); return; }
      this._el('detail-body').textContent = `Could not load email: ${e.message}`;
    }

    document.querySelector('#screen-detail [data-action="back"]')?.focus();
  },

  // ── REPLY ─────────────────────────────────────────────────────────────
  _showReply() {
    if (!this.currentEmail) return;
    this._push('detail');
    this._show('screen-reply');

    const from    = header(this.currentEmail, 'From');
    const subject = header(this.currentEmail, 'Subject');
    const body    = decodeBody(this.currentEmail);

    this._el('reply-to-label').textContent = `to ${displayName(from)}`;

    const list = this._el('reply-list');
    list.innerHTML = '';
    suggestReplies(subject, body).forEach(text => {
      const li = document.createElement('li');
      li.className = 'reply-item focusable';
      li.tabIndex  = 0;
      li.textContent = text;
      li.addEventListener('click', () => this._sendReply(text));
      list.appendChild(li);
    });

    list.querySelector('.focusable')?.focus();
  },

  async _sendReply(bodyText) {
    if (!this.currentEmail) return;
    const to        = header(this.currentEmail, 'From');
    const subject   = header(this.currentEmail, 'Subject');
    const messageId = header(this.currentEmail, 'Message-ID');
    const threadId  = this.currentEmail.threadId;

    this._toast('Sending…', 60_000);
    try {
      await Gmail.sendReply(threadId, to, subject, bodyText, messageId);
      this._toast('Sent! ✓', 2500);
      this.history = [];
      this._loadInbox(true);
    } catch (e) {
      if (e.message === 'session_expired') { this._startDeviceFlow(); return; }
      this._toast(`Failed: ${e.message}`, 3000);
    }
  },

  // ── VOICE ─────────────────────────────────────────────────────────────
  _startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this._toast('Voice not supported on this device'); return; }

    this._push('reply');
    this._show('screen-voice');
    this._el('voice-transcript').textContent = '';
    this._el('send-voice-btn').classList.add('hidden');
    delete this._el('send-voice-btn').dataset.voiceText;

    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous     = false;
    this._recognition = recognition;

    let final = '';

    recognition.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
        else                      interim += e.results[i][0].transcript;
      }
      this._el('voice-transcript').textContent = (final + interim).trim();
    };

    recognition.onend = () => {
      this._recognition = null;
      const text = final.trim();
      if (text) {
        const btn = this._el('send-voice-btn');
        btn.dataset.voiceText = text;
        btn.classList.remove('hidden');
        btn.focus();
      } else {
        this._toast('Nothing heard — try again');
        this._back();
      }
    };

    recognition.onerror = e => {
      this._recognition = null;
      this._toast(`Voice error: ${e.error}`);
      this._back();
    };

    recognition.start();
  },

  // ── ARCHIVE / DELETE ──────────────────────────────────────────────────
  _confirmDialog(title, msg, cb) {
    this._push('detail');
    this._show('screen-confirm');
    this._el('confirm-title').textContent = title;
    this._el('confirm-msg').textContent   = msg;
    this.confirmCb = cb;
    document.querySelector('#screen-confirm [data-action="confirm-no"]')?.focus();
  },

  _archiveEmail() {
    if (!this.currentEmail) return;
    const id = this.currentEmail.id;
    this._confirmDialog('Archive', 'Remove this email from your inbox?', async () => {
      this._toast('Archiving…', 60_000);
      try {
        await Gmail.archive(id);
        this._removeLocal(id);
        this._toast('Archived!', 2500);
        this.history = [];
        this._loadInbox(true);
      } catch (e) {
        this._toast(`Error: ${e.message}`, 3000);
        this._show('screen-detail');
      }
    });
  },

  _deleteEmail() {
    if (!this.currentEmail) return;
    const id      = this.currentEmail.id;
    const subject = header(this.currentEmail, 'Subject') || 'this email';
    this._confirmDialog('Delete', `Move "${subject.slice(0, 45)}" to trash?`, async () => {
      this._toast('Deleting…', 60_000);
      try {
        await Gmail.trash(id);
        this._removeLocal(id);
        this._toast('Moved to trash!', 2500);
        this.history = [];
        this._loadInbox(true);
      } catch (e) {
        this._toast(`Error: ${e.message}`, 3000);
        this._show('screen-detail');
      }
    });
  },

  _removeLocal(id) {
    this.emails = this.emails.filter(e => e.id !== id);
    delete this.cache[id];
    this.currentEmail = null;
  },

  // ── NAVIGATION ────────────────────────────────────────────────────────
  _push(screen) {
    this.history.push(screen);
    if (this.history.length > 8) this.history.shift();
  },

  _back() {
    if (this._recognition) { try { this._recognition.stop(); } catch {} this._recognition = null; }
    const prev = this.history.pop();
    this._show(`screen-${prev || 'inbox'}`);
  },

  _show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    this._el(screenId)?.classList.add('active');
    setTimeout(() => {
      const first = document.querySelector('.screen.active .focusable');
      if (first && document.activeElement !== first) first.focus();
    }, 40);
  },

  // ── FOCUS / D-PAD ─────────────────────────────────────────────────────
  _focusables() {
    return [...document.querySelectorAll('.screen.active .focusable')];
  },

  _moveFocus(dir) {
    const items = this._focusables();
    if (!items.length) return;
    const idx  = items.indexOf(document.activeElement);
    const next = (idx + dir + items.length) % items.length;
    items[next].focus();
  },

  _scrollDetail(dir) {
    this._el('detail-body')?.scrollBy({ top: dir * 90, behavior: 'smooth' });
  },

  // ── EVENT BINDING ─────────────────────────────────────────────────────
  _bindEvents() {
    // D-pad / keyboard navigation
    document.addEventListener('keydown', e => {
      const active = document.querySelector('.screen.active')?.id.replace('screen-', '');

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          active === 'detail' ? this._scrollDetail(1) : this._moveFocus(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          active === 'detail' ? this._scrollDetail(-1) : this._moveFocus(-1);
          break;
        case 'ArrowRight': e.preventDefault(); this._moveFocus(1);  break;
        case 'ArrowLeft':  e.preventDefault(); this._moveFocus(-1); break;
        case 'Escape':     e.preventDefault(); this._back();        break;
        case ' ':
        case 'Enter': {
          // Simulate click on non-button focusables (list items)
          const el = document.activeElement;
          if (el && !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(el.tagName)) {
            e.preventDefault();
            el.click();
          }
          break;
        }
      }
    });

    // Action delegation (buttons)
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (el) this._handleAction(el.dataset.action, el);
    });
  },

  _handleAction(action, el) {
    switch (action) {
      case 'retry-auth':    this._startDeviceFlow(); break;
      case 'refresh-inbox': this._loadInbox();       break;
      case 'sign-out':
        Auth.signOut();
        this.emails = []; this.cache = {}; this.currentEmail = null; this.history = [];
        this._startDeviceFlow();
        break;
      case 'back':         this._back();         break;
      case 'reply':        this._showReply();    break;
      case 'archive':      this._archiveEmail(); break;
      case 'delete':       this._deleteEmail();  break;
      case 'voice-reply':  this._startVoice();   break;
      case 'cancel-voice':
        if (this._recognition) { try { this._recognition.stop(); } catch {} this._recognition = null; }
        this._back();
        break;
      case 'send-voice': {
        const text = el?.dataset?.voiceText;
        if (text) this._sendReply(text);
        break;
      }
      case 'confirm-no':
        this.confirmCb = null;
        this._back();
        break;
      case 'confirm-yes':
        if (this.confirmCb) { const cb = this.confirmCb; this.confirmCb = null; cb(); }
        break;
    }
  },

  // ── TOAST ─────────────────────────────────────────────────────────────
  _toast(msg, ms = 2500) {
    const el = this._el('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    if (ms < 60_000) this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  },

  _el(id) { return document.getElementById(id); },
};

document.addEventListener('DOMContentLoaded', () => App.init());
