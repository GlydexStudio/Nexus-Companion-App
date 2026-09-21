# Nexus

Companion AI feminină cu avatar VRM, pentru Android. Dezvoltată direct de pe telefon,
cu **Code On The Go**.

- **Package:** `com.glydexstudio.nexus`
- **AI:** Gumloop (agent `Nexus Chat`)
- **Voce:** ElevenLabs
- **Avatar:** VRM local + Three.js + `@pixiv/three-vrm`, randat în WebView
- Fără `.env`. Fără fișiere Gradle (le gestionează Code On The Go).

---

## 1. Ce trebuie făcut înainte de prima rulare

### a) Cheile API — un singur fișier

`app/src/main/java/com/glydexstudio/nexus/config/NexusConfig.kt`

```kotlin
const val GUMLOOP_API_KEY   = "…"
const val GUMLOOP_USER_ID   = "…"
const val GUMLOOP_AGENT_ID  = "…"   // din URL: gumloop.com/agents/XXXXXXXX
const val ELEVEN_API_KEY    = "…"
const val ELEVEN_VOICE_ID   = "…"
```

Nimic altundeva nu trebuie modificat. Aplicația pornește și fără chei — îți spune
frumos că nu e conectată, în loc să crape.

### b) Avatarul

Pune modelul la `app/src/main/assets/avatars/nexus.vrm`
(detalii și cerințe de expresii: fișierul din acel folder).

### c) Agentul Gumloop (de pe telefon)

1. [gumloop.com/personal/home](https://www.gumloop.com/personal/home) → **New Agent**
2. Nume: **Nexus Chat**
3. Lipește prompt-ul din `GUMLOOP_NEXUS_CHAT.md`
4. Deschide agentul și copiază ID-ul din URL: `gumloop.com/agents/XXXXXXXX`

### d) Vocea ElevenLabs

Alege o voce **feminină, 20–27 ani, conversațională**: caldă, inteligentă, expresivă,
jucăușă. Evită vocile marcate narrator / corporate / childlike / anime.
Modelul implicit este `eleven_multilingual_v2` (română, engleză, maghiară).
Pentru latență mai mică poți pune `eleven_turbo_v2_5` în `NexusConfig`.

---

## 2. Dependințe de adăugat în Code On The Go

Nu am creat fișiere Gradle, conform cerinței. În modulul `app` ai nevoie doar de:

```gradle
implementation 'androidx.appcompat:appcompat:1.7.0'
implementation 'androidx.core:core-ktx:1.13.1'
implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1'
```

Atât. Nu sunt necesare CameraX sau `lifecycle-runtime-ktx`:
- camera frontală folosește **Camera2**, API de platformă (zero dependințe)
- coroutinele rulează pe un scope propriu al activității, anulat în `onDestroy`

Codul a fost compilat și verificat cu Kotlin 2.0 împotriva SDK-ului Android
(0 erori) exact cu acest set de dependințe.

Configurare modul:

| Setare | Valoare |
|---|---|
| `namespace` / `applicationId` | `com.glydexstudio.nexus` |
| `minSdk` | 26 |
| `targetSdk` / `compileSdk` | 34 |
| `jvmTarget` | 17 |

Rețeaua, JSON-ul și HTTP-ul sunt implementate fără librării externe
(`HttpURLConnection` + `org.json`), ca să ai cât mai puține dependințe de rezolvat pe telefon.

**Important:** WebView-ul trebuie să fie Chrome 89+ (Android System WebView actualizat) —
scena 3D folosește import maps. Dacă lipsește, aplicația afișează un mesaj clar,
nu o pagină albă.

---

## 3. Structura proiectului

```
app/src/main/
├── AndroidManifest.xml
├── java/com/glydexstudio/nexus/
│   ├── NexusApp.kt                  Application
│   ├── MainActivity.kt              WebView, permisiuni, orchestrare tur de conversație
│   ├── config/NexusConfig.kt        ⇦ TOATE cheile și reglajele API
│   ├── ai/
│   │   ├── GumloopClient.kt         start_agent + polling agent_status
│   │   ├── NexusResponse.kt         parser tolerant pentru JSON-ul lui Nexus
│   │   ├── NexusBrain.kt            istoric + memorie + limbă + vision → Gumloop
│   │   ├── LanguageDetector.kt      ro / en / hu
│   │   └── FriendlyErrors.kt        mesaje naturale, în 3 limbi
│   ├── voice/
│   │   ├── ElevenLabsClient.kt      TTS, cu setări de voce modulate de emoție
│   │   └── SpeechInput.kt           recunoaștere vocală + rezultate parțiale
│   ├── camera/FrameCapture.kt       Camera2: un singur cadru, la cerere, apoi eliberează
│   ├── memory/
│   │   ├── MemoryStore.kt           memorie pe termen lung (doar fapte explicite)
│   │   └── ConversationStore.kt     istoric local, ștergibil
│   ├── settings/SettingsStore.kt    toate setările
│   └── bridge/NexusBridge.kt        puntea JS ⇄ Android
└── assets/
    ├── avatars/nexus.vrm            ⇦ avatarul tău
    └── web/
        ├── index.html, styles.css, app.js, boot-check.js
        ├── engines/
        │   ├── vrm-renderer.js      scenă, lumini, încadrare medium close-up
        │   ├── emotion-engine.js    emoții + comportamente
        │   ├── lipsync-engine.js    viseme din spectrul audio real
        │   ├── gaze-engine.js       privire AI + saccade naturale
        │   ├── idle-engine.js       clipit, respirație, micro-mișcări
        │   └── audio-player.js      Web Audio + analyser
        └── lib/                     three.js 0.160 + three-vrm 2.1.2 (locale, offline)
```

---

## 4. Cum funcționează un tur de conversație

```
voce  →  SpeechRecognizer  ─┐
                            ├→  NexusBrain  →  Gumloop "Nexus Chat"  →  JSON
text  →  input UI          ─┘                                            │
                                                                         ▼
      avatar: emoție + comportament + privire   ←──────────────  Android parsează
                                                                         │
                          ElevenLabs  →  MP3 base64  →  Web Audio  ──────┘
                                                            │
                                            analyser → lip sync pe semnal real
```

Lip sync-ul nu este un ciclu `aa → ih → aa`. Analizează amplitudinea și centroidul
spectral al vocii reale și distribuie ponderi între `aa / ih / ou / ee / oh`, cu
attack/release separate — de aici coarticularea naturală. Dacă decodarea audio eșuează,
trece automat pe fallback bazat pe amplitudine, fără să se vadă o ruptură.

---

## 5. Încadrarea avatarului

Camera se calculează din geometria reală a modelului, nu din valori fixe: se măsoară
creștetul (inclusiv părul, din vertecșii legați de osul capului) și lățimea feței
(din distanța interpupilară), apoi cadrul se compune între creștet + aer deasupra
și puțin sub piept.

Rezultat măsurat pe ecrane Android uzuale (16:9, 19.5:9, 18:9, tabletă):

| Reper | Poziție în cadru |
|---|---|
| creștet | ~10% de sus |
| umeri | ~58% |
| piept (upperChest) | ~74% |
| șolduri | în afara cadrului |
| fața | ~48% din lățime |

Adică exact medium close-up: cap, față, păr, gât, umeri, puțin bust. Fără full body,
fără extreme close-up. Dacă vrei altă încadrare, singurul loc de reglat este obiectul
`this.framing` din `engines/vrm-renderer.js`:

```js
headroom: 0.10,        // aer deasupra creștetului
belowChest: 0.45,      // cât coboară cadrul sub piept
faceWidthRatio: 0.66,  // cât din lățime poate ocupa fața
maxHairSpill: 1.15,    // cât poate depăși părul marginile
```

---

## 6. Setări disponibile în aplicație

Limbă (Auto / Română / English / Magyar) · voce activă · volum · viteză vorbire ·
reascultare automată · intensitate animații · Lip Sync · mișcarea ochilor ·
efecte vizuale · Reduce Motion · acces cameră · listă de memorie cu ștergere
individuală · Reset Nexus Memory · Clear Conversation History.

---

## 7. Comportament la erori

Nimic nu duce la crash și nu se afișează erori tehnice. Pentru fiecare situație există
un mesaj în vocea lui Nexus, în limba curentă:

| Situație | Ce se întâmplă |
|---|---|
| Gumloop nu răspunde / timeout | „Mi s-au blocat gândurile pe drum. Mai zi o dată?” |
| fără internet | „Mi-a picat conexiunea o secundă…” |
| ElevenLabs cade | rămâne pe text, avatarul continuă să reacționeze |
| microfon refuzat | sugerează scrisul, restul funcționează |
| cameră refuzată | se dezactivează, conversația continuă |
| VRM-ul nu se încarcă | mesaj calm, UI-ul rămâne funcțional |
| JSON invalid de la AI | textul e folosit ca atare, emoție neutră |
| procesul WebView moare | scena se reîncarcă singură |

---

## 8. Două decizii de robustețe în interfață

Ambele au ieșit la iveală testând scena reală, nu din teorie:

1. **Subtitrarea stă în dock, are fundal aproape opac și nu folosește `backdrop-filter`
   sau animație de `opacity`.** Un strat animat doar pe compozitor, suprapus peste un
   canvas WebGL, poate rămâne nedesenat — iar replica lui Nexus este cel mai important
   text din aplicație. Acum contrastul măsurat este ~17:1, indiferent ce poartă avatarul.
2. **Analyser-ul audio este montat înaintea nodului de volum.** Altfel, la volum mic
   lip sync-ul ar fi murit odată cu sunetul.

---

## 9. Optimizări pentru telefon

- rezoluție internă adaptivă: dacă FPS-ul scade, randarea coboară automat (și urcă înapoi)
- randarea se oprește complet când aplicația e în fundal sau ecranul e stins
- camera pornește doar pentru un cadru, apoi se eliberează
- `removeUnnecessaryVertices` / `removeUnnecessaryJoints` la încărcarea VRM-ului
- WebView distrus corect la `onDestroy`, bridge-ul eliminat, audio oprit — fără leak-uri
- bibliotecile 3D sunt locale în `assets/web/lib`, deci avatarul merge și fără internet
