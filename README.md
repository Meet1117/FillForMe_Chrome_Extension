# FillForMe – Test Data Recorder & AI Form Filler

Stop filling long forms by hand while you test your app.

- **Record & Replay**: fill a form once, then replay it as often as you like, with fresh data each run if you want.
- **AI Fill**: FillForMe reads the fields on the page and fills them with realistic data from Groq AI. You choose which fields get filled.

Everything runs in a Chrome side panel that stays open while you click around the page.

---

## 1. Install (2 minutes)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one with `manifest.json`).
4. Pin FillForMe (puzzle icon → pin), then click its icon to open the side panel.

## 2. Turn it on for your site

For safety, FillForMe does nothing on a site until you turn it on there.

1. Open your app (for example `http://localhost:3000`).
2. Press **Option+A** (Mac) or **Alt+A** (Windows / Linux). FillForMe turns on for the site straight away and confirms with a message at the bottom of the page. You can also click **Enable** (or **Turn on for this site**) in the side panel.

You can see and remove sites any time in **Settings (⚙) → Sites**.

If you press another FillForMe shortcut on a site that isn't turned on yet, a small popup appears on the page asking **Turn on FillForMe for this site?** Click **Turn on**, and the shortcut you pressed runs straight away.

FillForMe gets access to all sites when you install it, which is why turning a site on needs no Chrome prompt. It still only runs on the sites you turned on. If you limit FillForMe's site access in Chrome (puzzle icon → FillForMe), Chrome asks again the first time you turn on a site it no longer has access to.

If a site doesn't look like a dev or test site (its address has none of `localhost`, `127.0.0.1`, `dev`, `test`, `staging`, `uat`, `qa`), FillForMe asks **"This looks like a live site"** the first time you fill or replay there. Once you click **Continue**, it never asks again for that site.

## 3. Try it on the demo form

A realistic 6-step form with about 40 fields is included. Serve it from localhost:

```bash
cd "path/to/this/folder"
python3 -m http.server 8080
```

Open <http://localhost:8080/test/demo-form.html> and enable FillForMe on `localhost`.
When you click Submit, the form shows the submitted data as JSON, so you can check exactly what was filled.

> Local `file://` pages also work, but you must turn on **Allow access to file URLs** on FillForMe's details page in `chrome://extensions`. Serving the page from localhost is easier.

## 4. Get a Groq API key (free, optional)

FillForMe works without a key: it uses its built-in random data generator. A key gives you smarter, consistent AI data.

1. Go to <https://console.groq.com/keys> and sign in.
2. Click **Create API Key** and copy it.
3. In FillForMe, open **Settings (⚙)**, paste the key, and click **Test key**. You should see "Key works".
4. Pick a **Model** (the default is a fast chat model) and the **Country for test data** (India, US, or UK). It controls how names, phone numbers, addresses, and postal codes look.

The key is stored only in this browser (`chrome.storage.local`) and is sent only to Groq. It is never logged and never included in exports.

---

## Record & Replay

### Record

1. Open the **Record** tab and click **Start recording**.
2. Fill the form as usual: type, choose options, click **Next**, and so on. A red strip at the top of the panel and a small bar on the page show the step count, with **Pause** and **Stop**. You can drag the page bar out of the way.
3. Click **Stop and save** in the panel or **Stop** on the page bar, then give the recording a name.

FillForMe records field values (when you leave a field, not on every keystroke), button and link clicks, and page changes, including single-page-app route changes and fields inside iframes. Password values are recorded but always shown masked.

### Edit

Click **Edit** on a recording. Steps read like plain English, for example `Type "John Smith" into "Customer Name"` or `Click "Next"`. For each step you can change the value, delete the step, drag ⋮⋮ to reorder, or add an extra wait after the step (⏱ ms).

Each field step has a **value mode**:

| Mode | What happens on every run |
|---|---|
| **Fixed** | The same value every time |
| **Random** | A new value that fits the field: name, email, phone, number in range, date, a random option… |
| **Counter** | A template like `Sample-{{n}}` or `test{{n}}@mail.com` |
| **AI** | Groq writes a fresh, realistic value (one AI call per page, not per field) |

Counter placeholders:

- `{{n}}`: run number. It keeps counting across sessions, so values stay unique.
- `{{date}}`: today's date (`YYYY-MM-DD`).
- `{{time}}`: the current time (`HHmmss`).
- `{{random:4}}`: 4 random digits.

**Set text fields to Random** / **Set text fields to AI** set up a recording in one click.

### Submit the form when done

This checkbox is shown in both tabs and is **off by default**.

- **Off:** FillForMe fills every field and stops just before the Submit / Save button. You check the form and submit it yourself. Replay runs once.
- **On:** FillForMe clicks Submit / Save after filling. Replay can run many times in a row.

FillForMe recognises the submit click by its text (Submit, Save, Finish, Create, Confirm…, but not "Save draft" or "Next"). If it guesses wrong, open the recording in the editor and tick or untick **This is the submit button** on that step.

### Replay

Set how many **times** to run and click **Play**. (Running more than once needs **Submit the form when done**.)

- Each run starts fresh from the recording's start page. Turn on **Don't reload between runs** in the editor if your app shows a new empty form after you submit.
- Before each step, FillForMe waits for the field or button to appear, up to 10 seconds by default (change this in Settings). This handles slow steps and dropdowns that load their options from an API.
- **Speed**: Fast / Normal / Slow, set in the editor.
- Replay keeps going across page loads.
- The page bar shows progress, for example `Run 3 of 10 · Step 14 of 38`, with Pause, Resume, and Stop.
- **If a step fails**, playback pauses, highlights what it was looking for, and offers **Retry / Skip step / Stop**. It never fails silently.
- At the end you get a summary: runs completed, steps skipped, and errors.

---

## AI Fill

1. Open the **AI Fill** tab and click **Find fields**. Every field on the page gets a small round checkbox mark.
2. Choose fields with **All / None / Empty only / Required only**, by clicking the marks on the page, or with the list in the panel. Your choice is remembered for that page.
3. Optional: **Describe the data**, for example *"Water testing lab, customer is a hotel in Mumbai, samples collected this week"*. This is saved per site.
4. Click **Fill N fields**.

Afterwards, use **Undo** to restore the previous values, or **Regenerate** for new data.

- **Preview before filling** shows the generated values first. You can edit them, then click **Fill these values**.
- **Fill all steps** fills a step, clicks **Next**, waits for the next step, and repeats until the last step. There it clicks Submit only if **Submit the form when done** is on; otherwise it waits for you.
  - If FillForMe can't find your Next button, click **Pick it yourself** and click it on the page once. This is saved per site.

All selected fields go to Groq in **one** request with their labels, types, constraints, and options. The AI is told to keep the record consistent: the email matches the name, the city matches the state and postal code, end dates come after start dates. FillForMe then **checks every value**: options must exist, numbers must be within min/max, dates must be valid, text must fit maxlength, and patterns must match. Any value that fails is replaced by a random valid value and flagged in the panel.

If there's no key, a rate limit, a network problem, or a bad AI response, you get a clear message and FillForMe fills random data instead. A bad AI response is retried once automatically first.

---

## Keyboard shortcuts

| Windows / Linux | Mac | Action |
|---|---|---|
| `Alt+A` | `⌥A` (Option+A) | Turn on FillForMe for this site |
| `Alt+Shift+F` | `⌥⇧F` (Option+Shift+F) | Show the fields on the page, then press **Enter** to fill them (Esc cancels) |
| `Alt+Shift+R` | `⌥⇧R` (Option+Shift+R) | Play the last-used recording for this site |
| `Alt+Shift+P` | `⌥⇧P` (Option+Shift+P) | Start / stop recording |

FillForMe detects your device and shows the matching keys in the panel.

**Fill shortcut in two steps:** the first press marks every field it will fill and shows "Press Enter to fill". Click a mark to leave a field out, then press **Enter** (or the shortcut again) to fill. **Esc** cancels. While FillForMe is waiting, Enter is caught by FillForMe, so it won't submit the page's form.

These shortcuts are set automatically when you load FillForMe. They are listed at the bottom of the panel. Click **Change** there (or go to `chrome://extensions/shortcuts`) to change them.

Chrome skips a default shortcut if Chrome or another extension already uses that key. If that happens when you install FillForMe, the shortcuts page opens so you can choose another key. Chrome only applies the defaults on a fresh install: clicking **Reload** on an extension that is already loaded keeps its current shortcuts. To get the defaults back, click **Remove**, then **Load unpacked** again.

> On a Mac, Option+A normally types "å". While FillForMe uses Option+A, Chrome catches it, so you can't type "å" in Chrome. Pick another key on the shortcuts page if you need it.

## Share with your team

**Settings → Export everything** saves every recording and setting as a JSON file. **Import file** loads one. Single recordings can be exported from their ⋮ menu. The API key is never exported.

---

## Known limitations

- **File uploads** are not supported yet. File fields are skipped and marked "not supported".
- **CAPTCHAs, OTP codes, and 2-factor prompts** can't be filled. Do these by hand. Playback pauses with Retry / Skip / Stop if one blocks a step.
- **Some custom widgets** are best effort only: div-based dropdowns (react-select style), fancy date pickers, rich-text editors, sliders, and drag-and-drop. FillForMe opens a custom dropdown and clicks the matching option, but unusual widgets may need a Fixed value or a manual step.
- **Fields inside web-component shadow DOM** are not detected.
- **Iframes from another domain** only work if you also enable FillForMe for that domain.
- Pressing **Enter** to submit is not recorded as a step. Record a click on the submit button instead.
- After you update or reload the extension, reload the pages you're testing.

## Privacy

Recordings, settings, and the API key stay in your browser. Field data is sent only to Groq, and only when you use AI. Generated emails use `example.com`, and US/UK phone numbers use reserved fictional ranges, so test data never reaches real people.

---

## For developers

Plain JavaScript, Manifest V3, no build step.

```
manifest.json
background/   service-worker.js (router, shortcuts) · sites.js (permissions, content-script registration)
              bridge.js (calls into page frames) · recorder.js · player.js · ai-fill.js · groq.js · util.js
shared/       store.js · steps.js (ES modules) · url-utils.js · templates.js · generator.js · validator.js
              (classic scripts usable from both content scripts and modules)
content/      dom-utils.js · scanner.js · filler.js · overlay.js (Shadow DOM UI) · recorder.js · main.js
sidepanel/    sidepanel.html/css/js · state.js · ui.js · record-tab.js · editor.js · ai-tab.js · settings.js
test/         demo-form.html
```

- Content scripts are registered dynamically (`scripting.registerContentScripts`, all frames) only for origins you enable.
- The service worker drives playback by calling `__FP.api.*` in the right frame through `chrome.scripting.executeScript`. Playback state lives in `chrome.storage.session`, so it survives page loads and worker restarts.
- All Groq calls go through the service worker.
