package com.glydexstudio.nexus.config

/**
 * Configuratia Nexus.
 *
 * Repository-ul este public, deci NU comite credentiale API reale aici.
 * Valorile reale trebuie furnizate local prin mecanismul de configurare
 * al build-ului / mediului local.
 */
object NexusConfig {

    // ------------------------------------------------------------------
    // GUMLOOP
    // ------------------------------------------------------------------

    const val GUMLOOP_API_KEY: String = ""
    const val GUMLOOP_USER_ID: String = ""

    /**
     * ID-ul agentului "Nexus Chat" (gummie_id).
     */
    const val GUMLOOP_AGENT_ID: String = ""

    const val GUMLOOP_PROJECT_ID: String = ""
    const val GUMLOOP_BASE_URL: String = "https://api.gumloop.com/api/v1"
    const val GUMLOOP_TIMEOUT_MS: Long = 90_000
    const val GUMLOOP_POLL_INTERVAL_MS: Long = 1_000

    // ------------------------------------------------------------------
    // ELEVENLABS
    // ------------------------------------------------------------------

    const val ELEVEN_API_KEY: String = ""

    const val NEXUS_VOICE_ID: String = "g2q5o7JkQLfXq97y6VBQ"
    const val LYRA_VOICE_ID: String = "ZDpKaZPj0z45wLlQSdID"
    const val DANTE_VOICE_ID: String = "WQk4JkRjrOHY435Dzccy"

    const val ELEVEN_MODEL_ID: String = "eleven_v3"
    const val ELEVEN_BASE_URL: String = "https://api.elevenlabs.io/v1"
    const val ELEVEN_OUTPUT_FORMAT: String = "mp3_44100_128"

    const val VOICE_STABILITY: Float = 0.40f
    const val VOICE_SIMILARITY: Float = 0.80f
    const val VOICE_STYLE: Float = 0.45f
    const val VOICE_SPEAKER_BOOST: Boolean = true

    // ------------------------------------------------------------------
    // AVATARE
    // ------------------------------------------------------------------

    const val DEFAULT_AVATAR_MODEL = "nexus"

    fun normalizedAvatarModel(model: String?): String = when (model?.lowercase()?.trim()) {
        "lyra" -> "lyra"
        "dante" -> "dante"
        else -> DEFAULT_AVATAR_MODEL
    }

    fun isValidAvatarModel(model: String?): Boolean =
        model != null &&
            (model == "nexus" || model == "lyra" || model == "dante")

    fun avatarFileForModel(model: String?): String = when (normalizedAvatarModel(model)) {
        "lyra" -> "avatars/lyra.vrm"
        "dante" -> "avatars/dante.vrm"
        else -> "avatars/nexus.vrm"
    }

    fun avatarDisplayName(model: String?): String = when (normalizedAvatarModel(model)) {
        "lyra" -> "Lyra"
        "dante" -> "Dante"
        else -> "Nexus"
    }

    fun voiceIdForModel(model: String?): String = when (normalizedAvatarModel(model)) {
        "lyra" -> LYRA_VOICE_ID
        "dante" -> DANTE_VOICE_ID
        else -> NEXUS_VOICE_ID
    }

    fun gumloopReady(): Boolean =
        GUMLOOP_API_KEY.isNotBlank() &&
            !GUMLOOP_API_KEY.startsWith("PUNE_AICI") &&
            GUMLOOP_AGENT_ID.isNotBlank() &&
            !GUMLOOP_AGENT_ID.startsWith("PUNE_AICI") &&
            GUMLOOP_USER_ID.isNotBlank() &&
            !GUMLOOP_USER_ID.startsWith("PUNE_AICI")

    fun elevenReady(): Boolean =
        ELEVEN_API_KEY.isNotBlank() &&
            !ELEVEN_API_KEY.startsWith("PUNE_AICI") &&
            NEXUS_VOICE_ID.isNotBlank() &&
            !NEXUS_VOICE_ID.startsWith("PUNE_AICI")

    // ------------------------------------------------------------------
    // MEMORY / VISION
    // ------------------------------------------------------------------

    const val HISTORY_TURNS: Int = 12
    const val HISTORY_STORE_LIMIT: Int = 400
    const val VISION_FRAME_WIDTH: Int = 256
    const val VISION_JPEG_QUALITY: Int = 55
}