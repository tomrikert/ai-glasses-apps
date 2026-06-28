# Gmail · Meta Ray-Ban Display Glasses

A hands-free Gmail client built as a [Meta Wearables Web App](https://wearables.developer.meta.com/docs/develop/webapps/) for the Meta Ray-Ban Display glasses.

**Features:** view inbox → read emails → archive / delete → reply with AI-suggested quick replies or voice dictation.

---

## Setup

### 1. Google Cloud credentials

You need a **TV and Limited Input Devices** OAuth 2.0 client, which uses the [Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628) — designed for screens without keyboards.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. **APIs & Services → Enable APIs** → search for **Gmail API** → Enable
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **TV and Limited Input devices**
   - Name: `Gmail Glasses App` (or anything)
5. Copy the **Client ID**

### 2. Configure the app

Open `app.js` and replace the placeholder on line 14:

```js
GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
```

### 3. Deploy

Host the `gmail-app/` folder on any static web server with HTTPS (required for Service Worker and SpeechRecognition).

Quick options:
- **GitHub Pages** — push to a repo, enable Pages
- **Vercel / Netlify** — drag-and-drop the folder
- **Local test** — `npx serve gmail-app` (then tunnel with `ngrok` for HTTPS)

### 4. Load on your glasses

In the Meta Ray-Ban companion app, navigate to **Display → Web Apps** and enter the HTTPS URL of your deployed app.

---

## First Sign-in

On the glasses display, the Auth screen shows a short code and the URL **google.com/device**.

1. On your phone or computer, go to [google.com/device](https://google.com/device)
2. Sign in with Google and enter the code shown on your glasses
3. Grant Gmail permission
4. The glasses display automatically advances to your Inbox

Tokens are stored locally and refresh automatically — you only sign in once.

---

## Navigation (D-pad / captouch frame)

| Input | Action |
|-------|--------|
| **↑ / ↓** | Scroll between emails (or scroll email body in detail view) |
| **← / →** | Navigate action buttons |
| **Select (tap)** | Open email / send reply / confirm action |
| **Back (swipe left)** | Return to previous screen |

Neural Band gestures map to the same D-pad events automatically.

---

## Screen Flow

```
Auth → Inbox → Email Detail → Reply (suggestions)
                           → Voice Reply
                           → Confirm (archive/delete)
```

---

## Technical Notes

- **Viewport:** 600×600dp, `mrbd-web-app-capable`
- **Auth:** OAuth 2.0 Device Authorization Grant (RFC 8628) — no popup, no redirect
- **Offline:** Service Worker caches the app shell; Gmail API is always network-first
- **Voice:** Web Speech API via the glasses microphone (`SpeechRecognition`)
- **No dependencies:** vanilla JS + CSS, zero npm packages
