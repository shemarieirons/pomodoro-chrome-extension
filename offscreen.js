/**
 * offscreen.js — runs in a hidden offscreen document.
 * Listens for PLAY_CHIME messages from the service worker and synthesises
 * the completion sound using the Web Audio API.
 */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_CHIME') {
    playChime();
  }
});

function playChime() {
  try {
    const ctx = new AudioContext();

    // Ascending chord: C5, E5, G5, C6
    const notes = [523.25, 659.26, 783.99, 1046.50];
    let t = ctx.currentTime;

    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + i * 0.18);

      gain.gain.setValueAtTime(0, t + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.35, t + i * 0.18 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.6);

      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.65);
    });

    // Lingering high chime tail
    const tail  = ctx.createOscillator();
    const tGain = ctx.createGain();
    tail.connect(tGain);
    tGain.connect(ctx.destination);
    tail.type = 'sine';
    tail.frequency.value = 880;
    tGain.gain.setValueAtTime(0.22, t + 0.95);
    tGain.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    tail.start(t + 0.95);
    tail.stop(t + 2.85);

    setTimeout(() => ctx.close(), 4000);
  } catch (e) {
    console.warn('Chime error:', e);
  }
}
