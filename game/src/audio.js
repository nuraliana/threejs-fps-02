// Sound: every effect is synthesized with WebAudio, no audio files.
// A gunshot is a noise burst through a low-pass filter; a reload is two
// clicks; a kill is a short two-note ding. Nothing here needs the network,
// and nothing plays until the player first clicks (the browser's rule).
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone(freq, duration, gain, when = 0, type = 'sine') {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  const SHOT_FILTER = { pistol: 1800, rifle: 1400, smg: 2200, shotgun: 900, sniper: 1100 };

  return {
    unlock() {
      ensure();
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot(weaponId, distance = 0) {
      const vol = Math.max(0.08, 0.5 - distance * 0.008);
      burst(weaponId === 'shotgun' ? 0.28 : 0.14, SHOT_FILTER[weaponId] ?? 1400, vol);
      tone(weaponId === 'sniper' ? 70 : 120, 0.08, vol * 0.5, 0, 'triangle');
    },
    dryFire() {
      tone(1800, 0.03, 0.12, 0, 'square');
    },
    reload() {
      tone(900, 0.04, 0.15, 0, 'square');
      tone(600, 0.04, 0.15, 0.35, 'square');
    },
    hit() {
      tone(2200, 0.05, 0.2, 0, 'sine');
    },
    kill() {
      tone(880, 0.09, 0.25, 0);
      tone(1320, 0.12, 0.25, 0.09);
    },
    explosion() {
      burst(0.9, 220, 0.9);
      tone(55, 0.7, 0.6, 0, 'sine');
    },
    plantBeep() {
      tone(1200, 0.08, 0.2, 0, 'square');
    },
    bombBeep() {
      tone(1500, 0.06, 0.12, 0, 'square');
    },
    roundWin() {
      tone(523, 0.14, 0.25, 0);
      tone(659, 0.14, 0.25, 0.13);
      tone(784, 0.22, 0.25, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 0.25, 0);
      tone(311, 0.22, 0.25, 0.15);
    },
    click() {
      tone(1400, 0.03, 0.12, 0, 'square');
    },
    buy() {
      tone(980, 0.06, 0.18, 0);
      tone(1470, 0.08, 0.18, 0.06);
    },
  };
}
