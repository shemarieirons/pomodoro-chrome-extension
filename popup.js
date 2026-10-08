/**
 * popup.js — UI shell only.
 * All timer logic lives in background.js.
 * This script reads state from the service worker and sends control messages.
 *
 * Tab clicks = view a timer type (selectedMode). They do not stop the active timer.
 * Start on a different tab = select that timer to run (stops/resets the previous one).
 */

(() => {
  const MODES = {
    pomo:  { label: 'Focus Time',  duration: 1500 },
    short: { label: 'Short Break', duration: 300  },
    long:  { label: 'Long Break',  duration: 900  },
  };

  /* ── DOM refs ────────────────────────────────────────────── */
  const timeDisplay   = document.getElementById('time-display');
  const timerLabel    = document.getElementById('timer-label');
  const startBtn      = document.getElementById('start-btn');
  const resetBtn      = document.getElementById('reset-btn');
  const ringArc       = document.getElementById('ring-arc');
  const ringContainer = document.getElementById('ring-container');
  const sessionNum    = document.getElementById('session-num');
  const dots          = document.querySelectorAll('.session-dots .dot');
  const tabs          = document.querySelectorAll('.tab-btn');

  /* ── Ring ────────────────────────────────────────────────── */
  const RADIUS        = 88;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  ringArc.style.strokeDasharray = CIRCUMFERENCE;

  function setRingProgress(fraction) {
    ringArc.style.strokeDashoffset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function formatTime(s) {
    s = Math.max(0, Math.round(s));
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }

  /**
   * sessions = completed focus sessions (0..4).
   * Badge shows the current work session in the cycle: 1/4 .. 4/4.
   */
  function updateDots(sessions) {
    sessions = sessions ?? 0;
    dots.forEach((dot, i) => {
      dot.classList.remove('done', 'current');
      if (i < sessions)                        dot.classList.add('done');
      else if (i === sessions && sessions < 4) dot.classList.add('current');
    });
    sessionNum.textContent = sessions >= 4 ? 4 : sessions + 1;
  }

  function applyState(state) {
    const activeMode = state.mode ?? 'pomo';
    const viewedMode = state.selectedMode ?? activeMode;
    const viewingActive = viewedMode === activeMode;

    let remaining;
    let total;
    let labelMode;

    if (viewingActive) {
      // Show the live active timer (remaining preserved across tab visits).
      remaining = state.remaining ?? MODES[activeMode].duration;
      if (state.running && state.endTime) {
        remaining = Math.max(0, (state.endTime - Date.now()) / 1000);
      }
      total = state.total ?? MODES[activeMode].duration;
      labelMode = activeMode;
    } else {
      // Preview the viewed tab only — active timer keeps running in the background.
      remaining = MODES[viewedMode].duration;
      total = MODES[viewedMode].duration;
      labelMode = viewedMode;
    }

    timeDisplay.textContent = formatTime(remaining);
    setRingProgress(total > 0 ? remaining / total : 0);
    timerLabel.textContent  = MODES[labelMode]?.label ?? 'Focus Time';
    updateDots(state.sessions ?? 0);

    tabs.forEach(t => {
      const key = t.id.replace('tab-', '');
      t.classList.toggle('active', key === viewedMode);
    });

    // Controls reflect the viewed tab. Pause only when viewing the running timer.
    // Start on a different tab will switch the active timer (handled in background).
    if (viewingActive && state.running) {
      startBtn.textContent = '⏸ Pause';
      startBtn.classList.remove('paused');
      ringContainer.classList.add('running');
    } else if (viewingActive && remaining < total && remaining > 0) {
      startBtn.textContent = '▶ Resume';
      startBtn.classList.add('paused');
      ringContainer.classList.remove('running');
    } else {
      startBtn.textContent = '▶ Start';
      startBtn.classList.remove('paused');
      ringContainer.classList.remove('running');
    }
  }

  /* ── Communicate with background ────────────────────────── */
  async function send(msg, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await chrome.runtime.sendMessage(msg);
        return resp;
      } catch (e) {
        if (i < retries - 1 && String(e).includes('receiving end')) {
          await new Promise(r => setTimeout(r, 150));
          continue;
        }
        console.warn('Message failed:', e);
        return null;
      }
    }
    return null;
  }

  /* ── Live tick while popup is open ──────────────────────── */
  let tickInterval = null;

  async function refreshState() {
    const state = await send({ type: 'GET_STATE' });
    if (!state) return;
    applyState(state);
  }

  function startTicking() {
    if (tickInterval) return;
    tickInterval = setInterval(refreshState, 500);
  }

  function stopTicking() {
    clearInterval(tickInterval);
    tickInterval = null;
  }

  /* ── Button handlers ─────────────────────────────────────── */
  startBtn.addEventListener('click', async () => {
    const state = await send({ type: 'GET_STATE' });
    if (!state) return;

    const viewed = state.selectedMode ?? state.mode;
    const viewingActive = viewed === state.mode;

    if (viewingActive && state.running) {
      await send({ type: 'PAUSE' });
    } else {
      // Start / Resume, or switch to the viewed timer and start it.
      await send({ type: 'START' });
    }
    await refreshState();
  });

  resetBtn.addEventListener('click', async () => {
    await send({ type: 'RESET' });
    await refreshState();
  });

  // Tab click = view only (does not stop the active timer).
  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const key = tab.id.replace('tab-', '');
      await send({ type: 'SET_MODE', mode: key, total: MODES[key].duration });
      await refreshState();
    });
  });

  /* ── Init ────────────────────────────────────────────────── */
  (async () => {
    await refreshState();
    startTicking();
  })();

  window.addEventListener('unload', stopTicking);
})();
