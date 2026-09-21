package com.glydexstudio.nexus.config

/**
 * SINGURUL loc unde se configureaza API-urile aplicatiei Nexus.
 *
 * Aplicatia este pentru uz personal, deci cheile stau direct in cod (nu exista .env).
 * Completeaza valorile de mai jos si aplicatia este gata de rulat.
 *
 * Creierul conversational este un AGENT Gumloop (nu un flow / pipeline).
 * Se creeaza de pe telefon: gumloop.com/personal/home -> New Agent.
 */
object NexusConfig {

    // ------------------------------------------------------------------
    // GUMLOOP  (creierul conversational - agentul "Nexus Chat")
    // ------------------------------------------------------------------
    const val GUMLOOP_API_KEY: String = ""
    const val GUMLOOP_USER_ID: String = ""

    /**
     * ID-ul agentului "Nexus Chat" (gummie_id).
     * Il iei din URL dupa ce deschizi agentul:
     *   https://www.gumloop.com/agents/XXXXXXXX
     * XXXXXXXX este valoarea de pus aici. Fara https://, fara slash-uri.
     */
    const val GUMLOOP_AGENT_ID: String = ""

    /** Optional: doar daca agentul apartine unui workspace/team, altfel lasa gol. */
    const val GUMLOOP_PROJECT_ID: String = ""

    const val GUMLOOP_BASE_URL: String = "https://api.gumloop.com/api/v1"

    /** Cat asteptam un raspuns de la agent inainte sa renuntam elegant. */
    const val GUMLOOP_TIMEOUT_MS: Long = 90_000
    const val GUMLOOP_POLL_INTERVAL_MS: Long = 2_000

    // ------------------------------------------------------------------
    // ELEVENLABS  (vocea feminina a lui Nexus)
    // ------------------------------------------------------------------
    const val ELEVEN_API_KEY: String = ""

    /**
     * Voice ID feminin, tanar (20-27 ani), cald si expresiv.
     * Recomandat: o voce "conversational" din ElevenLabs Voice Library,
     * NU una de tip narrator / corporate / anime.
     */
    const val ELEVEN_VOICE_ID: String = "g2q5o7JkQLfXq97y6VBQ"

    /** eleven_multilingual_v2 = calitate maxima RO/EN/HU. eleven_turbo_v2_5 = latenta mica. */
    const val ELEVEN_MODEL_ID: String = "eleven_v3"

    const val ELEVEN_BASE_URL: String = "https://api.elevenlabs.io/v1"
    const val ELEVEN_OUTPUT_FORMAT: String = "mp3_44100_128"

    /** Setari de baza ale vocii; sunt ajustate dinamic dupa emotie. */
    const val VOICE_STABILITY: Float = 0.40f
    const val VOICE_SIMILARITY: Float = 0.80f
    const val VOICE_STYLE: Float = 0.45f
    const val VOICE_SPEAKER_BOOST: Boolean = true

    // ------------------------------------------------------------------
    // GENERAL
    // ------------------------------------------------------------------
    /** Cate perechi user/nexus trimitem ca istoric catre agent (la primul mesaj). */
    const val HISTORY_TURNS: Int = 12

    /** Cate mesaje pastram local pe telefon. */
    const val HISTORY_STORE_LIMIT: Int = 400

    /** Latimea cadrului trimis catre AI cand camera este activata (px). */
    const val VISION_FRAME_WIDTH: Int = 256
    const val VISION_JPEG_QUALITY: Int = 55

    fun gumloopReady(): Boolean =
        GUMLOOP_API_KEY.isNotBlank() && !GUMLOOP_API_KEY.startsWith("PUNE_AICI") &&
            GUMLOOP_AGENT_ID.isNotBlank() && !GUMLOOP_AGENT_ID.startsWith("PUNE_AICI") &&
            GUMLOOP_USER_ID.isNotBlank() && !GUMLOOP_USER_ID.startsWith("PUNE_AICI")

    fun elevenReady(): Boolean =
        ELEVEN_API_KEY.isNotBlank() && !ELEVEN_API_KEY.startsWith("PUNE_AICI") &&
            ELEVEN_VOICE_ID.isNotBlank() && !ELEVEN_VOICE_ID.startsWith("PUNE_AICI")
}
