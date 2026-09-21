import { VRMStage } from './engines/vrm-renderer.js';
import { EmotionEngine } from './engines/emotion-engine.js';
import { LipSyncEngine } from './engines/lipsync-engine.js';
import { GazeEngine } from './engines/gaze-engine.js';
import { IdleEngine } from './engines/idle-engine.js';
import { AudioEngine } from './engines/audio-player.js';

const I18N = {
  ro: {
    placeholder: 'Scrie-i lui Nexus…', waking: 'Nexus se trezește…',
    idle: 'Nexus', listening: 'Te ascult', thinking: 'Mă gândesc', speaking: 'Vorbesc',
    conversation: 'Conversație', settings: 'Setări', close: 'Închide',
    clearHistory: 'Șterge istoricul', resetMemory: 'Resetează memoria lui Nexus',
    emptyHistory: 'Încă nu ați vorbit. Spune ceva.', emptyMemory: 'Nexus nu ține minte nimic deocamdată.',
    memoryCleared: 'Memoria a fost ștearsă.', historyCleared: 'Istoricul a fost șters.',
    model: 'Model', selectModel: 'Alege avatarul'
  },
  en: {
    placeholder: 'Say something to Nexus…', waking: 'Nexus is waking up…',
    idle: 'Nexus', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking',
    conversation: 'Conversation', settings: 'Settings', close: 'Close',
    clearHistory: 'Clear history', resetMemory: 'Reset Nexus memory',
    emptyHistory: 'Nothing here yet. Say something.', emptyMemory: 'Nexus remembers nothing yet.',
    memoryCleared: 'Memory cleared.', historyCleared: 'History cleared.',
    model: 'Model', selectModel: 'Choose avatar'
  },
  hu: {
    placeholder: 'Írj Nexusnak…', waking: 'Nexus ébred…',
    idle: 'Nexus', listening: 'Hallgatlak', thinking: 'Gondolkodom', speaking: 'Beszélek',
    conversation: 'Beszélgetés', settings: 'Beállítások', close: 'Bezárás',
    clearHistory: 'Előzmények törlése', resetMemory: 'Nexus memóriájának törlése',
    emptyHistory: 'Még nincs semmi. Mondj valamit.', emptyMemory: 'Nexus még semmire sem emlékszik.',
    memoryCleared: 'Memória törölve.', historyCleared: 'Előzmények törölve.',
    model: 'Modell', selectModel: 'Avatar választása'
  }
};

const MODEL_CATALOG = {
  nexus: { name: 'Nexus', file: '../avatars/nexus.vrm' },
  lyra: { name: 'Lyra', file: '../avatars/lyra.vrm' },
  dante: { name: 'Dante', file: '../avatars/dante.vrm' }
};

const $ = (id) => document.getElementById(id);
const native = () => window.NexusNative;

const state = {
  lang: 'ro', settings: {}, listening: false, thinking: false, speaking: false,
  avatarReady: false, modelId: 'nexus', conversation: []
};

const stage = new VRMStage($('avatar-canvas'));
const emotion = new EmotionEngine(stage);
const lipsync = new LipSyncEngine(stage);
const gaze = new GazeEngine(stage);
const idle = new IdleEngine(stage);
const audio = new AudioEngine();
window.__nexus = { state, stage, emotion, lipsync, gaze, idle, audio };

const headSmooth = { yaw: 0, pitch: 0, roll: 0 };
const expr = {};
let clockT = 0;
let loaderHideTimer = null;

// AI response face is staged here and only activated when the real voice
// playback starts. This keeps Joy/Sad/Angry/Surprised from appearing during
// the network/TTS preparation gap.
let pendingResponseFace = null;

stage.addUpdater((dt) => {
  clockT += dt;
  for (const k in expr) delete expr[k];

  const talking = state.speaking && audio.playing;
  emotion.setTalking(talking);
  lipsync.setTalking(talking);

  emotion.update(dt, expr);
  const idleOut = idle.update(dt, expr, talking);
  const gazeHead = gaze.update(dt, talking);
  lipsync.update(dt, expr, audio.currentTime);
  stage.applyExpressions(expr);

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
  if (neck) neck.rotation.set(headSmooth.pitch * 0.35, headSmooth.yaw * 0.35, headSmooth.roll * 0.3, 'YXZ');

  const chest = stage.bone('upperChest') || stage.bone('chest');
  if (chest) chest.rotation.x = -idleOut.breath;
  const spine = stage.bone('spine');
  if (spine) spine.rotation.x = idleOut.breath * 0.6;

  const driftAmount = state.settings.reduceMotion ? 0 : (state.settings.visualEffects === false ? 0 : 0.7);
  stage.applyCameraDrift(driftAmount, clockT);
});

async function loadAvatar(url, modelId = state.modelId) {
  const profile = MODEL_CATALOG[modelId] || MODEL_CATALOG.nexus;
  const previousModel = state.modelId;
  stopAvatarSpeech();
  state.modelId = modelId;
  state.avatarReady = false;
  updateModelSelector();
  showLoader((I18N[state.lang] || I18N.ro).waking + ' ' + profile.name + '…');

  try {
    await stage.load(url);
    state.avatarReady = true;
    headSmooth.yaw = headSmooth.pitch = headSmooth.roll = 0;
    stage.start();
    hideLoader();
    emotion.setEmotion('relaxed', 0.35);
    gaze.setBehavior('look_at_user');
  } catch (err) {
    state.avatarReady = false;
    state.modelId = previousModel;
    updateModelSelector();
    hideLoader();
    if (native()) native().log('avatar load failed for ' + modelId + ': ' + String(err && err.message || err));
    if (native() && modelId !== previousModel) native().setSetting('avatarModel', previousModel);
    toast('Modelul ' + profile.name + ' nu este disponibil în pachetul aplicației.');
  }
}

function returnToIdle() {
  // Never allow a queued AI emotion to survive a cancelled/failed response.
  pendingResponseFace = null;

  // Release lip-sync and fade the response expression back to the idle face.
  // VRoid full expressions such as Joy can also contain mouth geometry.
  lipsync.setTalking(false);
  lipsync.reset();
  lipsync.detach();

  emotion.setTalking(false);
  emotion.setBehavior('idle');
  emotion.setEmotion('neutral', 0.25);

  gaze.setBehavior('look_at_user');
  setSpeaking(false);
  updateStatus();
}

function stopAvatarSpeech() {
  audio.stop();
  returnToIdle();
}

function showLoader(text) {
  const el = $('loader');
  if (!el) return;
  clearTimeout(loaderHideTimer);
  $('loader-text').textContent = text || ((I18N[state.lang] || I18N.ro).waking);
  el.style.display = 'flex';
  el.classList.remove('hidden');
}

function hideLoader() {
  const el = $('loader'); if (!el) return;
  el.classList.add('hidden');
  loaderHideTimer = setTimeout(() => { el.style.display = 'none'; }, 650);
}

window.NexusHost = {
  emit(event, payload) {
    try { handle(event, payload || {}); }
    catch (err) { if (native() && native().log) native().log('host error ' + event + ': ' + err.message); }
  }
};

function handle(event, p) {
  switch (event) {
    case 'config':
      if (p.modelId) state.modelId = p.modelId;
      updateModelSelector();
      if (p.avatarUrl) loadAvatar(p.avatarUrl, state.modelId);
      break;
    case 'modelConfig':
      if (p.modelId && p.avatarUrl) loadAvatar(p.avatarUrl, p.modelId);
      break;
    case 'settings': applySettings(p); break;
    case 'state':
      if ('listening' in p) setListening(p.listening);
      if ('thinking' in p) setThinking(p.thinking);

      // AudioEngine is the authoritative source for the avatar's speaking
      // state. Some native/backend states can arrive before the TTS audio is
      // actually playing, so a remote speaking=true is intentionally ignored.
      if ('speaking' in p && p.speaking === false && !audio.playing) {
        setSpeaking(false);
      }

      updateStatus(); break;
    case 'micLevel':
      $('mic-level').firstElementChild.style.width = Math.round((p.level || 0) * 100) + '%'; break;
    case 'partial': showCaption(p.text, true); break;
    case 'userMessage':
      showCaption(p.text, true); state.conversation.push({ role: 'user', text: p.text }); $('text-input').value = ''; break;
    case 'nexusResponse': onNexusResponse(p); break;
    case 'audio': playAudio(p); break;
    case 'stopAudio': stopAvatarSpeech(); break;
    case 'conversation': state.conversation = (p.items || []).map((i) => ({ role: i.role, text: i.text })); renderHistory(); break;
    case 'memory': renderMemory(p.items || []); break;
    case 'notice': toast(p.message); break;
    case 'appPaused': audio.suspend(); returnToIdle(); stage.pause(); break;
    case 'appResumed': stage.resume(); break;
    case 'back': onBack(); break;
  }
}

function onNexusResponse(p) {
  // IMPORTANT: do not render the response emotion yet.
  // ElevenLabs still has to prepare the audio. The face is activated by
  // AudioEngine.onPlaybackStarted(), which is tied to real audio playback.
  pendingResponseFace = {
    emotion: p.emotion || 'neutral',
    intensity: typeof p.intensity === 'number' ? p.intensity : 0.6,
    behavior: p.behavior || 'talk',
    lookAt: p.lookAt ? {
      yaw: num(p.lookAt.yaw, 0),
      pitch: num(p.lookAt.pitch, 0)
    } : null
  };

  if (p.silent) {
    pendingResponseFace = null;
    returnToIdle();
  } else {
    // While waiting for TTS, keep the avatar visually in Idle.
    emotion.setBehavior('idle');
    gaze.setBehavior('look_at_user');
    setSpeaking(false);
    updateStatus();
  }

  showCaption(p.text, false);
  state.conversation.push({ role: 'nexus', text: p.text });
  renderHistory();
}

async function playAudio(p) {
  if (!p.data) return;
  lipsync.setAlignment(p.alignment || null);

  audio.onPrepared = (analyser, sampleRate) => {
    lipsync.attach(analyser, sampleRate);
  };
  audio.onPlaybackStarted = () => {
    // This callback is the exact synchronization boundary:
    // voice output has actually started, so the response face can start now.
    const face = pendingResponseFace || {
      emotion: 'neutral',
      intensity: 0.35,
      behavior: 'talk',
      lookAt: null
    };
    pendingResponseFace = null;

    setSpeaking(true);
    emotion.setEmotion(face.emotion, face.intensity);
    emotion.setBehavior(face.behavior || 'talk');

    const behavior = face.behavior || 'talk';
    gaze.setBehavior(behavior);
    if (face.lookAt) gaze.setAiTarget(face.lookAt.yaw, face.lookAt.pitch);

    updateStatus();
  };
  audio.onEnded = () => {
    // The actual audio end is the authoritative end-of-speech event.
    returnToIdle();
    if (native() && native().speakingFinished) native().speakingFinished();
  };

  // Important: state.speaking does NOT become true until the real audio play event.
  const ok = await audio.play(p.data, { volume: p.volume, rate: p.rate });
  if (!ok) {
    returnToIdle();
  }
}

function setListening(v) { state.listening = !!v; document.body.classList.toggle('listening', state.listening); }
function setThinking(v) { state.thinking = !!v; document.body.classList.toggle('thinking', state.thinking); }
function setSpeaking(v) { state.speaking = !!v; document.body.classList.toggle('speaking', state.speaking); }

function updateStatus() {
  const t = I18N[state.lang] || I18N.ro;
  const label = state.listening ? t.listening : state.thinking ? t.thinking : state.speaking ? t.speaking : (MODEL_CATALOG[state.modelId]?.name || t.idle);
  $('status-text').textContent = label;
}

let captionTimer = null;
function showCaption(text, isUser) {
  if (!text) return;
  const el = $('caption'); el.textContent = text; el.classList.toggle('user', !!isUser);
  el.classList.remove('hidden-caption'); el.classList.add('visible-caption');
  clearTimeout(captionTimer);
  if (!isUser) captionTimer = setTimeout(hideCaption, Math.min(16000, 3500 + text.length * 55));
}
function hideCaption() {
  const el = $('caption'); el.classList.remove('visible-caption');
  setTimeout(() => { if (!el.classList.contains('visible-caption')) { el.textContent = ''; el.classList.add('hidden-caption'); } }, 320);
}
let toastTimer = null;
function toast(message) {
  if (!message) return;
  const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function applySettings(s) {
  state.settings = s || {};
  if (s.avatarModel && MODEL_CATALOG[s.avatarModel]) state.modelId = s.avatarModel;
  const lang = s.language && s.language !== 'auto' ? s.language : state.lang;
  state.lang = I18N[lang] ? lang : 'ro';
  idle.setIntensity(num(s.animationIntensity, 0.85)); idle.setReduceMotion(!!s.reduceMotion);
  emotion.setIntensityScale(num(s.animationIntensity, 0.85)); gaze.setEnabled(s.eyeMovement !== false); gaze.setIntensity(num(s.animationIntensity, 0.85));
  lipsync.setEnabled(s.lipSync !== false); audio.setVolume(num(s.voiceVolume, 0.9));
  document.body.classList.toggle('no-effects', s.visualEffects === false);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const key = el.dataset.setting; if (!(key in state.settings)) return;
    if (el.type === 'checkbox') el.checked = !!state.settings[key]; else el.value = state.settings[key];
  });
  document.querySelectorAll('#seg-language button').forEach((b) => b.classList.toggle('active', b.dataset.value === (s.language || 'auto')));
  updateModelSelector(); applyTexts(); updateStatus();
}

function updateModelSelector() {
  document.querySelectorAll('.model-choice').forEach((b) => b.classList.toggle('active', b.dataset.model === state.modelId));
  const label = $('selected-model-name');
  if (label) label.textContent = MODEL_CATALOG[state.modelId]?.name || 'Nexus';
}

function applyTexts() {
  const t = I18N[state.lang] || I18N.ro;
  $('text-input').placeholder = t.placeholder; $('loader-text').textContent = t.waking;
  document.querySelector('#panel-history h2').textContent = t.conversation;
  document.querySelector('#panel-settings h2').textContent = t.settings;
  $('btn-close-history').textContent = t.close; $('btn-close-settings').textContent = t.close;
  $('btn-clear-history').textContent = t.clearHistory; $('btn-reset-memory').textContent = t.resetMemory;
  const title = document.querySelector('#model-group .group-title'); if (title) title.textContent = t.model;
  const hint = $('model-hint'); if (hint) hint.textContent = t.selectModel;
}
function num(v, def) { const n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? def : n; }

function renderHistory() {
  const list = $('history-list'), t = I18N[state.lang] || I18N.ro;
  if (!state.conversation.length) { list.innerHTML = '<p class="empty">' + t.emptyHistory + '</p>'; return; }
  list.innerHTML = state.conversation.map((m) => '<div class="msg ' + (m.role === 'user' ? 'user' : 'nexus') + '"><div class="bubble">' + escapeHtml(m.text) + '</div></div>').join('');
  list.scrollTop = list.scrollHeight;
}
function renderMemory(items) {
  const box = $('memory-list'), t = I18N[state.lang] || I18N.ro;
  if (!items.length) { box.innerHTML = '<p class="empty">' + t.emptyMemory + '</p>'; return; }
  box.innerHTML = items.map((i) => '<div class="memory-item"><span>' + escapeHtml(i.text) + '</span><button data-forget="' + escapeHtml(i.text) + '">&times;</button></div>').join('');
  box.querySelectorAll('[data-forget]').forEach((b) => b.addEventListener('click', () => { if (native()) native().forget(b.dataset.forget); }));
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function openPanel(id) { closePanels(); $(id).classList.add('open'); }
function closePanels() { $('panel-history').classList.remove('open'); $('panel-settings').classList.remove('open'); }
function anyPanelOpen() { return $('panel-history').classList.contains('open') || $('panel-settings').classList.contains('open'); }
function onBack() { if (anyPanelOpen()) { closePanels(); if (native()) native().backResult(true); } else if (native()) native().backResult(false); }

function sendText() {
  const input = $('text-input'), text = input.value.trim(); if (!text) return;
  audio.ensureContext(); input.value = ''; input.blur(); if (native()) native().send(text);
}

$('btn-send').addEventListener('click', sendText);
$('text-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });
$('btn-mic').addEventListener('click', () => {
  audio.ensureContext(); if (!native()) return;
  if (state.listening) native().stopListening();
  else if (state.speaking) { native().cancelSpeaking(); native().startListening(); }
  else native().startListening();
});
$('btn-settings').addEventListener('click', () => { if (native()) { native().getSettings(); native().getMemory(); } openPanel('panel-settings'); });
$('btn-history').addEventListener('click', () => { if (native()) native().getConversation(); openPanel('panel-history'); });
$('btn-close-settings').addEventListener('click', closePanels); $('btn-close-history').addEventListener('click', closePanels);
$('btn-clear-history').addEventListener('click', () => { if (native()) native().clearConversation(); state.conversation = []; renderHistory(); toast((I18N[state.lang] || I18N.ro).historyCleared); });
$('btn-reset-memory').addEventListener('click', () => { if (native()) native().resetMemory(); toast((I18N[state.lang] || I18N.ro).memoryCleared); });

document.querySelectorAll('#seg-language button').forEach((b) => b.addEventListener('click', () => { if (native()) native().setSetting('language', b.dataset.value); }));
document.querySelectorAll('.model-choice').forEach((b) => b.addEventListener('click', () => {
  const model = b.dataset.model; if (!MODEL_CATALOG[model] || model === state.modelId) return;
  stopAvatarSpeech();
  state.modelId = model; updateModelSelector();
  if (native()) native().setSetting('avatarModel', model);
  else loadAvatar(MODEL_CATALOG[model].file, model);
}));

document.querySelectorAll('[data-setting]').forEach((el) => {
  const key = el.dataset.setting; const evt = el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(evt, () => {
    const value = el.type === 'checkbox' ? String(el.checked) : String(el.value);
    state.settings[key] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
    if (key === 'voiceVolume') audio.setVolume(parseFloat(el.value));
    if (key === 'animationIntensity') { idle.setIntensity(parseFloat(el.value)); emotion.setIntensityScale(parseFloat(el.value)); gaze.setIntensity(parseFloat(el.value)); }
    if (key === 'lipSync') lipsync.setEnabled(el.checked);
    if (key === 'eyeMovement') gaze.setEnabled(el.checked);
    if (key === 'reduceMotion') { idle.setReduceMotion(el.checked); document.body.classList.toggle('reduce-motion', el.checked); }
    if (key === 'visualEffects') document.body.classList.toggle('no-effects', !el.checked);
    if (native()) native().setSetting(key, value);
  });
});

document.addEventListener('touchstart', () => audio.ensureContext(), { once: true, passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.stop(); lipsync.reset(); setSpeaking(false); stage.pause(); } else stage.resume(); });

applyTexts();
if (native() && native().ready) native().ready();
else loadAvatar(MODEL_CATALOG.nexus.file, 'nexus');
