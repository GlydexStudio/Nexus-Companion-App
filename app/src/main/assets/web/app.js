import { VRMStage } from './engines/vrm-renderer.js';
import { EmotionEngine } from './engines/emotion-engine.js';
import { LipSyncEngine } from './engines/lipsync-engine.js';
import { GazeEngine } from './engines/gaze-engine.js';
import { IdleEngine } from './engines/idle-engine.js';
import { AudioEngine } from './engines/audio-player.js';

/* ------------------------------------------------------------------ */
/* i18n pentru interfata (Nexus raspunde in limba detectata de Gumloop) */
/* ------------------------------------------------------------------ */
const I18N = {
  ro: {
    placeholder: 'Scrie-i lui Nexus…', waking: 'Nexus se trezește…',
    idle: 'Nexus', listening: 'Te ascult', thinking: 'Mă gândesc', speaking: 'Vorbesc',
    conversation: 'Conversație', settings: 'Setări', close: 'Închide',
    clearHistory: 'Șterge istoricul', resetMemory: 'Resetează memoria lui Nexus',
    emptyHistory: 'Încă nu ați vorbit. Spune ceva.',
    emptyMemory: 'Nexus nu ține minte nimic deocamdată.',
    memoryCleared: 'Memoria a fost ștearsă.', historyCleared: 'Istoricul a fost șters.'
  },
  en: {
    placeholder: 'Say something to Nexus…', waking: 'Nexus is waking up…',
    idle: 'Nexus', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking',
    conversation: 'Conversation', settings: 'Settings', close: 'Close',
    clearHistory: 'Clear history', resetMemory: 'Reset Nexus memory',
    emptyHistory: 'Nothing here yet. Say something.',
    emptyMemory: 'Nexus remembers nothing yet.',
    memoryCleared: 'Memory cleared.', historyCleared: 'History cleared.'
  },
  hu: {
    placeholder: 'Irj Nexusnak…', waking: 'Nexus ebred…',
    idle: 'Nexus', listening: 'Hallgatlak', thinking: 'Gondolkodom', speaking: 'Beszelek',
    conversation: 'Beszelgetes', settings: 'Beallitasok', close: 'Bezaras',
    clearHistory: 'Elozmenyek torlese', resetMemory: 'Nexus memoriajanak torlese',
    emptyHistory: 'Meg nincs semmi. Mondj valamit.',
    emptyMemory: 'Nexus meg semmire sem emlekszik.',
    memoryCleared: 'Memoria torolve.', historyCleared: 'Elozmenyek torolve.'
  }
};

const $ = (id) => document.getElementById(id);
const native = () => window.NexusNative;

/* ------------------------------------------------------------------ */
/* Stare                                                               */
/* ------------------------------------------------------------------ */
const state = {
  lang: 'ro',
  settings: {},
  listening: false,
  thinking: false,
  speaking: false,
  avatarReady: false,
  conversation: []
};

const stage = new VRMStage($('avatar-canvas'));
const emotion = new EmotionEngine(stage);
const lipsync = new LipSyncEngine();
const gaze = new GazeEngine(stage);
const idle = new IdleEngine(stage);
const audio = new AudioEngine();

// hook de debug (util cu chrome://inspect de pe PC sau in browser)
window.__nexus = { state, stage, emotion, lipsync, gaze, idle, audio };

const headSmooth = { yaw: 0, pitch: 0, roll: 0 };
const expr = {};
let clockT = 0;

/* ------------------------------------------------------------------ */
/* Bucla de compunere: emotie + idle + privire + lip sync              */
/* ------------------------------------------------------------------ */
stage.addUpdater((dt) => {
  clockT += dt;
  for (const k in expr) delete expr[k];

  const talking = state.speaking;
  emotion.setTalking(talking);
  lipsync.setTalking(talking);

  emotion.update(dt, expr);
  const idleOut = idle.update(dt, expr, talking);
  const gazeHead = gaze.update(dt, talking);
  lipsync.update(dt, expr, audio.currentTime);

  stage.applyExpressions(expr);

  // --- cap: idle sway + comportament + fractiune din privire ---
  const beh = emotion.headOffset();
  const targetYaw = idleOut.sway.yaw + gazeHead.yaw + (beh ? beh.yaw : 0);
  const targetPitch = idleOut.sway.pitch + gazeHead.pitch + (beh ? beh.pitch : 0);
  const targetRoll = idleOut.sway.roll + (beh ? beh.roll : 0);

  const k = 1 - Math.pow(0.004, dt);
  headSmooth.yaw += (targetYaw - headSmooth.yaw) * k;
  headSmooth.pitch += (targetPitch - headSmooth.pitch) * k;
  headSmooth.roll += (targetRoll - headSmooth.roll) * k;

  const head = stage.bone('head');
  if (head) head.rotation.set(headSmooth.pitch, headSmooth.yaw, headSmooth.roll, 'YXZ');

  const neck = stage.bone('neck');
  if (neck) {
    neck.rotation.set(headSmooth.pitch * 0.35, headSmooth.yaw * 0.35, headSmooth.roll * 0.3, 'YXZ');
  }

  // --- respiratie ---
  const chest = stage.bone('upperChest') || stage.bone('chest');
  if (chest) chest.rotation.x = -idleOut.breath;
  const spine = stage.bone('spine');
  if (spine) spine.rotation.x = idleOut.breath * 0.6;

  const driftAmount = state.settings.reduceMotion ? 0 :
    (state.settings.visualEffects === false ? 0 : 0.7);
  stage.applyCameraDrift(driftAmount, clockT);
});

/* ------------------------------------------------------------------ */
/* Incarcarea avatarului                                               */
/* ------------------------------------------------------------------ */
async function loadAvatar(url) {
  try {
    await stage.load(url);
    state.avatarReady = true;
    stage.start();
    hideLoader();
    // salut vizual discret, fara text
    emotion.setEmotion('relaxed', 0.35);
    gaze.setBehavior('look_at_user');
  } catch (err) {
    state.avatarReady = false;
    hideLoader();
    if (native() && native().avatarFailed) native().avatarFailed(String(err && err.message || err));
  }
}

function hideLoader() {
  const el = $('loader');
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 700);
}

/* ------------------------------------------------------------------ */
/* Evenimente Android -> Web                                           */
/* ------------------------------------------------------------------ */
window.NexusHost = {
  emit(event, payload) {
    try { handle(event, payload || {}); } catch (err) {
      if (native() && native().log) native().log('host error ' + event + ': ' + err.message);
    }
  }
};

function handle(event, p) {
  switch (event) {
    case 'config':
      if (p.avatarUrl && !state.avatarReady) loadAvatar(p.avatarUrl);
      break;

    case 'settings':
      applySettings(p);
      break;

    case 'state':
      if ('listening' in p) setListening(p.listening);
      if ('thinking' in p) setThinking(p.thinking);
      if ('speaking' in p) setSpeaking(p.speaking);
      updateStatus();
      break;

    case 'micLevel': {
      const bar = $('mic-level').firstElementChild;
      bar.style.width = Math.round((p.level || 0) * 100) + '%';
      break;
    }

    case 'partial':
      showCaption(p.text, true);
      break;

    case 'userMessage':
      showCaption(p.text, true);
      state.conversation.push({ role: 'user', text: p.text });
      $('text-input').value = '';
      break;

    case 'nexusResponse':
      onNexusResponse(p);
      break;

    case 'audio':
      playAudio(p);
      break;

    case 'stopAudio':
      audio.stop();
      lipsync.reset();
      setSpeaking(false);
      updateStatus();
      break;

    case 'conversation':
      state.conversation = (p.items || []).map((i) => ({ role: i.role, text: i.text }));
      renderHistory();
      break;

    case 'memory':
      renderMemory(p.items || []);
      break;

    case 'notice':
      toast(p.message);
      break;

    case 'appPaused':
      audio.suspend();
      stage.pause();
      setSpeaking(false);
      break;

    case 'appResumed':
      stage.resume();
      break;

    case 'back':
      onBack();
      break;
  }
}

function onNexusResponse(p) {
  emotion.setEmotion(p.emotion || 'neutral', typeof p.intensity === 'number' ? p.intensity : 0.6);
  emotion.setBehavior(p.behavior || 'talk');
  gaze.setBehavior(p.behavior || 'talk');
  if (p.lookAt) gaze.setAiTarget(p.lookAt.yaw, p.lookAt.pitch);

  showCaption(p.text, false);
  state.conversation.push({ role: 'nexus', text: p.text });
  renderHistory();

  // raspuns fara voce (ex. mesaj de eroare prietenos) -> tot misca putin gura
  if (p.silent) {
    setSpeaking(false);
    updateStatus();
  }
}

async function playAudio(p) {
  if (!p.data) return;
  lipsync.setAlignment(p.alignment || null);
  audio.onEnded = () => {
    setSpeaking(false);
    lipsync.reset();
    updateStatus();
    if (native() && native().speakingFinished) native().speakingFinished();
  };

  setSpeaking(true);
  updateStatus();

  const ok = await audio.play(p.data, { volume: p.volume, rate: p.rate });
  if (!ok) {
    setSpeaking(false);
    updateStatus();
    return;
  }
  lipsync.attach(audio.getAnalyser(), audio.sampleRate);
}

/* ------------------------------------------------------------------ */
/* Stari UI                                                           */
/* ------------------------------------------------------------------ */
function setListening(v) { state.listening = !!v; document.body.classList.toggle('listening', state.listening); }
function setThinking(v) { state.thinking = !!v; document.body.classList.toggle('thinking', state.thinking); }
function setSpeaking(v) { state.speaking = !!v; document.body.classList.toggle('speaking', state.speaking); }

function updateStatus() {
  const t = I18N[state.lang] || I18N.ro;
  const label = state.listening ? t.listening
    : state.thinking ? t.thinking
    : state.speaking ? t.speaking
    : t.idle;
  $('status-text').textContent = label;
}

let captionTimer = null;
function showCaption(text, isUser) {
  if (!text) return;
  const el = $('caption');
  el.textContent = text;
  el.classList.toggle('user', !!isUser);
  el.classList.remove('hidden-caption');
  el.classList.add('visible-caption');
  clearTimeout(captionTimer);
  if (!isUser) {
    const ms = Math.min(16000, 3500 + text.length * 55);
    captionTimer = setTimeout(hideCaption, ms);
  }
}

function hideCaption() {
  const el = $('caption');
  el.classList.remove('visible-caption');
  // golim textul dupa ce s-a stins, ca sa nu ramana un dreptunghi gol
  setTimeout(() => {
    if (!el.classList.contains('visible-caption')) {
      el.textContent = '';
      el.classList.add('hidden-caption');
    }
  }, 320);
}

let toastTimer = null;
function toast(message) {
  if (!message) return;
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

/* ------------------------------------------------------------------ */
/* Setari                                                             */
/* ------------------------------------------------------------------ */
function applySettings(s) {
  state.settings = s || {};
  const lang = s.language && s.language !== 'auto' ? s.language : state.lang;
  state.lang = I18N[lang] ? lang : 'ro';

  idle.setIntensity(num(s.animationIntensity, 0.85));
  idle.setReduceMotion(!!s.reduceMotion);
  emotion.setIntensityScale(num(s.animationIntensity, 0.85));
  gaze.setEnabled(s.eyeMovement !== false);
  gaze.setIntensity(num(s.animationIntensity, 0.85));
  lipsync.setEnabled(s.lipSync !== false);
  audio.setVolume(num(s.voiceVolume, 0.9));

  document.body.classList.toggle('no-effects', s.visualEffects === false);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);

  // reflecta valorile in controale
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    if (!(key in state.settings)) return;
    if (el.type === 'checkbox') el.checked = !!state.settings[key];
    else el.value = state.settings[key];
  });
  document.querySelectorAll('#seg-language button').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === (s.language || 'auto'));
  });

  applyTexts();
  updateStatus();
}

function applyTexts() {
  const t = I18N[state.lang] || I18N.ro;
  $('text-input').placeholder = t.placeholder;
  $('loader-text').textContent = t.waking;
  document.querySelector('#panel-history h2').textContent = t.conversation;
  document.querySelector('#panel-settings h2').textContent = t.settings;
  $('btn-close-history').textContent = t.close;
  $('btn-close-settings').textContent = t.close;
  $('btn-clear-history').textContent = t.clearHistory;
  $('btn-reset-memory').textContent = t.resetMemory;
}

function num(v, def) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? def : n;
}

/* ------------------------------------------------------------------ */
/* Panouri                                                            */
/* ------------------------------------------------------------------ */
function renderHistory() {
  const list = $('history-list');
  const t = I18N[state.lang] || I18N.ro;
  if (!state.conversation.length) {
    list.innerHTML = '<p class="empty">' + t.emptyHistory + '</p>';
    return;
  }
  list.innerHTML = state.conversation.map((m) => {
    const cls = m.role === 'user' ? 'user' : 'nexus';
    return '<div class="msg ' + cls + '"><div class="bubble">' + escapeHtml(m.text) + '</div></div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function renderMemory(items) {
  const box = $('memory-list');
  const t = I18N[state.lang] || I18N.ro;
  if (!items.length) {
    box.innerHTML = '<p class="empty">' + t.emptyMemory + '</p>';
    return;
  }
  box.innerHTML = items.map((i) =>
    '<div class="memory-item"><span>' + escapeHtml(i.text) +
    '</span><button data-forget="' + escapeHtml(i.text) + '">&times;</button></div>'
  ).join('');
  box.querySelectorAll('[data-forget]').forEach((b) => {
    b.addEventListener('click', () => {
      if (native()) native().forget(b.dataset.forget);
    });
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function openPanel(id) {
  closePanels();
  $(id).classList.add('open');
}
function closePanels() {
  $('panel-history').classList.remove('open');
  $('panel-settings').classList.remove('open');
}
function anyPanelOpen() {
  return $('panel-history').classList.contains('open') ||
    $('panel-settings').classList.contains('open');
}

function onBack() {
  if (anyPanelOpen()) {
    closePanels();
    if (native()) native().backResult(true);
  } else if (native()) {
    native().backResult(false);
  }
}

/* ------------------------------------------------------------------ */
/* Interactiuni                                                       */
/* ------------------------------------------------------------------ */
function sendText() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  audio.ensureContext();
  input.value = '';
  input.blur();
  if (native()) native().send(text);
}

$('btn-send').addEventListener('click', sendText);
$('text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendText(); }
});

$('btn-mic').addEventListener('click', () => {
  audio.ensureContext();
  if (!native()) return;
  if (state.listening) native().stopListening();
  else if (state.speaking) { native().cancelSpeaking(); native().startListening(); }
  else native().startListening();
});

$('btn-settings').addEventListener('click', () => {
  if (native()) { native().getSettings(); native().getMemory(); }
  openPanel('panel-settings');
});
$('btn-history').addEventListener('click', () => {
  if (native()) native().getConversation();
  openPanel('panel-history');
});
$('btn-close-settings').addEventListener('click', closePanels);
$('btn-close-history').addEventListener('click', closePanels);

$('btn-clear-history').addEventListener('click', () => {
  if (native()) native().clearConversation();
  state.conversation = [];
  renderHistory();
  toast((I18N[state.lang] || I18N.ro).historyCleared);
});

$('btn-reset-memory').addEventListener('click', () => {
  if (native()) native().resetMemory();
  toast((I18N[state.lang] || I18N.ro).memoryCleared);
});

document.querySelectorAll('#seg-language button').forEach((b) => {
  b.addEventListener('click', () => {
    if (native()) native().setSetting('language', b.dataset.value);
  });
});

document.querySelectorAll('[data-setting]').forEach((el) => {
  const key = el.dataset.setting;
  const evt = el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(evt, () => {
    const value = el.type === 'checkbox' ? String(el.checked) : String(el.value);
    state.settings[key] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
    if (key === 'voiceVolume') audio.setVolume(parseFloat(el.value));
    if (key === 'animationIntensity') {
      idle.setIntensity(parseFloat(el.value));
      emotion.setIntensityScale(parseFloat(el.value));
      gaze.setIntensity(parseFloat(el.value));
    }
    if (key === 'lipSync') lipsync.setEnabled(el.checked);
    if (key === 'eyeMovement') gaze.setEnabled(el.checked);
    if (key === 'reduceMotion') {
      idle.setReduceMotion(el.checked);
      document.body.classList.toggle('reduce-motion', el.checked);
    }
    if (key === 'visualEffects') document.body.classList.toggle('no-effects', !el.checked);
    if (native()) native().setSetting(key, value);
  });
});

// primul gest deblocheaza AudioContext-ul
document.addEventListener('touchstart', () => audio.ensureContext(), { once: true, passive: true });

// pauza randarii cand ecranul nu este vizibil -> fara consum inutil
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stage.pause(); audio.stop(); setSpeaking(false); }
  else stage.resume();
});

/* ------------------------------------------------------------------ */
/* Pornire                                                            */
/* ------------------------------------------------------------------ */
loadAvatar('../avatars/nexus.vrm');
applyTexts();

if (native() && native().ready) native().ready();
else {
  // rulare in browser (fara Android) - nu blocam interfata
  hideLoader();
}
