/**
 * background.js — Pomodoro Service Worker
 *
 * Timer state lives here and persists regardless of whether the popup is open.
 * Uses chrome.alarms for reliable wake-up even when Chrome is in the background.
 * Uses chrome.notifications for OS-level alerts.
 * Uses an offscreen document to play the Web Audio chime.
 *
 * selectedMode = tab currently being viewed (UI only).
 * mode         = the single active timer type.
 * Tab clicks only change selectedMode and never stop the active timer.
 * START on a different mode stops/resets the active timer and starts the viewed one.
 * RESET (↺ Refresh) fully clears the cycle: stops timers, sessions → 1/4, default duration.
 */

const ALARM_NAME = 'pomodoro-end';
const SESSIONS_PER_CYCLE = 4;

const DURATIONS = {
  pomo:  1500,
  short: 300,
  long:  900,
};

const MODE_LABELS = {
  pomo:  'Focus session complete! Take a break 🎉',
  short: 'Break over! Time to focus 🍅',
  long:  'Long break over! Ready to go 🚀',
};

/* ── State helpers ──────────────────────────────────────────── */

/**
 * sessions = completed focus sessions in the current cycle (0..4).
 * Displayed session number is sessions + 1 (capped at 4 during long break).
 * Only incremented when a focus timer reaches zero naturally.
 */
async function getState() {
  const defaults = {
    mode:         'pomo',
    selectedMode: 'pomo',
    total:        DURATIONS.pomo,
    remaining:    DURATIONS.pomo,
    endTime:      null,   // ms timestamp when timer will hit zero (null = paused/stopped)
    running:      false,
    sessions:     0,
  };
  const stored = await chrome.storage.local.get(defaults);
  if (stored.selectedMode == null) stored.selectedMode = stored.mode;
  // Clamp legacy/corrupt values so the badge never boots stuck past the cycle.
  if (typeof stored.sessions !== 'number' || stored.sessions < 0) stored.sessions = 0;
  if (stored.sessions > SESSIONS_PER_CYCLE) stored.sessions = SESSIONS_PER_CYCLE;
  return stored;
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

function durationFor(mode) {
  return DURATIONS[mode] ?? DURATIONS.pomo;
}

/** Snapshot remaining seconds for a running timer without mutating state. */
function liveRemaining(state) {
  if (state.running && state.endTime) {
    return Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
  }
  return state.remaining ?? durationFor(state.mode);
}

/**
 * After natural completion:
 *   Focus 1–3 → Short Break (sessions becomes 1–3, display 2–4)
 *   Focus 4   → Long Break  (sessions becomes 4, display 4)
 *   Short     → Focus (same sessions)
 *   Long      → Focus at sessions 0 (display 1/4)
 */
function nextAfterCompletion(state) {
  if (state.mode === 'pomo') {
    const sessions = Math.min((state.sessions ?? 0) + 1, SESSIONS_PER_CYCLE);
    const mode = sessions >= SESSIONS_PER_CYCLE ? 'long' : 'short';
    const total = durationFor(mode);
    return {
      sessions,
      mode,
      selectedMode: mode,
      total,
      remaining: total,
      running: false,
      endTime: null,
    };
  }

  const sessions = state.mode === 'long' ? 0 : (state.sessions ?? 0);
  const total = durationFor('pomo');
  return {
    sessions,
    mode: 'pomo',
    selectedMode: 'pomo',
    total,
    remaining: total,
    running: false,
    endTime: null,
  };
}

/* ── Offscreen document for audio ───────────────────────────── */

async function ensureOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url:         'offscreen.html',
      reasons:     ['AUDIO_PLAYBACK'],
      justification: 'Play Pomodoro completion chime',
    });
  } catch (e) {
    if (!String(e).toLowerCase().includes('single') &&
        !String(e).toLowerCase().includes('already')) {
      throw e;
    }
  }
}

async function playChime() {
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ type: 'PLAY_CHIME' }).catch(() => {});
  } catch (e) {
    console.warn('Chime failed:', e);
  }
}

/* ── Alarm handler (fires at timer end) ─────────────────────── */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getState();

  chrome.notifications.create('pomodoro-done', {
    type:     'basic',
    iconUrl:  'hello_extensions.png',
    title:    'Pomodoro Timer',
    message:  MODE_LABELS[state.mode] ?? 'Time is up!',
    priority: 2,
    requireInteraction: true,
  });

  await playChime();

  // Advance cycle and make the next tab visible (does not auto-press Start).
  // Session count only changes here, and only when focus just finished.
  await setState(nextAfterCompletion(state));
});

/* ── Message handler (from popup) ───────────────────────────── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: String(err) }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'GET_STATE':
      return await getState();

    case 'START': {
      const state = await getState();
      const viewed = state.selectedMode ?? state.mode;

      // Selecting a different timer to run: stop/reset the active one, then
      // make the viewed mode the sole active timer and start it.
      if (viewed !== state.mode) {
        await chrome.alarms.clear(ALARM_NAME);
        const total = durationFor(viewed);
        const endTime = Date.now() + total * 1000;
        await setState({
          mode: viewed,
          selectedMode: viewed,
          total,
          remaining: total,
          running: true,
          endTime,
          // sessions unchanged — never advance on manual start
        });
        chrome.alarms.create(ALARM_NAME, { when: endTime });
        return { ok: true };
      }

      // Same mode: resume / continue the single active timer.
      const remaining = liveRemaining(state);
      const endTime = Date.now() + remaining * 1000;
      await setState({ running: true, endTime, remaining });
      await chrome.alarms.clear(ALARM_NAME);
      chrome.alarms.create(ALARM_NAME, { when: endTime });
      return { ok: true };
    }

    case 'PAUSE': {
      const state = await getState();
      if (!state.running) return { ok: true };
      const remaining = liveRemaining(state);
      await chrome.alarms.clear(ALARM_NAME);
      await setState({ running: false, endTime: null, remaining });
      return { ok: true };
    }

    case 'RESET': {
      // Refresh: full Pomodoro reset back to initial state for the viewed timer type.
      await chrome.alarms.clear(ALARM_NAME);
      const state = await getState();
      const mode = state.selectedMode ?? state.mode ?? 'pomo';
      const total = durationFor(mode);
      await setState({
        mode,
        selectedMode: mode,
        total,
        remaining: total,
        running: false,
        endTime: null,
        sessions: 0,
      });
      return { ok: true };
    }

    case 'SET_MODE': {
      // Tab navigation / viewing only — never stops or resets the active timer.
      const mode = msg.mode;
      if (!DURATIONS[mode]) return { error: 'Unknown mode' };
      await setState({ selectedMode: mode });
      return { ok: true };
    }

    case 'RESET_SESSIONS': {
      await setState({ sessions: 0 });
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}
