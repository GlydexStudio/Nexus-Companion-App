# Nexus — setup direct pe telefon cu Code On The Go

## 1. Păstrează fișierele Gradle generate de Code On The Go

Nu copia și nu înlocui:

- `build.gradle.kts`
- `settings.gradle.kts`
- `gradle.properties`

Sursa Nexus nu conține aceste fișiere.

## 2. Copiază structura proiectului

În proiectul Android creat de Code On The Go, îmbină directoarele din arhivă cu rădăcina proiectului, păstrând modulele și fișierele Gradle generate.

Calea Kotlin trebuie să devină:

`app/src/main/java/com/glydexstudio/nexus/`

Resursele și web assets trebuie să ajungă în:

`app/src/main/res/`

`app/src/main/assets/`

## 3. Instalează runtime-ul web local

Din Termux, în rădăcina proiectului:

```sh
bash scripts/fetch_web_dependencies.sh
```

Scriptul descarcă versiunile fixate în `app/src/main/assets/web/vendor/`.

## 4. Adaugă VRM-ul real

Pune avatarul furnizat de proprietarul proiectului la:

`app/src/main/assets/avatars/nexus.vrm`

Nu redenumi fișierul.

## 5. Configurează cheile

Editează o copie locală a `.env.example`:

```env
DIFY_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=
```

În aplicație deschide:

`Settings → Import .env`

Cheile sunt citite de Kotlin și nu sunt transmise către JavaScript.

## 6. Build

Folosește build-ul generat și configurat deja de Code On The Go. Dacă aplicația oferă alegerea variantei de build, folosește varianta Android standard a modulului `app`.

## 7. Test rapid

1. Pornește aplicația fără internet. Interfața locală trebuie să pornească; avatarul VRM trebuie să fie disponibil dacă modelul și bibliotecile vendor sunt prezente.
2. Activează microfonul doar când apeși microfonul.
3. Pentru Camera / Visual Context, activează manual opțiunea din Settings.
4. Trimite un mesaj. Dify răspunde prin Kotlin, răspunsul este validat, iar ElevenLabs generează vocea dacă este configurat.
5. La indisponibilitatea ElevenLabs, textul Nexus rămâne vizibil și aplicația nu trebuie să se blocheze.
