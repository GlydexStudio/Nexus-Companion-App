package com.glydexstudio.nexus.voice

import com.glydexstudio.nexus.config.NexusConfig
import com.glydexstudio.nexus.util.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Text-to-speech ElevenLabs.
 *
 * Audio-ul este returnat ca base64 impreuna cu alignment-ul pe caractere si redat
 * in WebView prin Web Audio API, pentru ca lip-sync-ul sa poata folosi timing-ul TTS.
 */
class ElevenLabsClient {

    sealed class Result {
        data class Ok(val base64Mp3: String, val alignment: JSONObject?) : Result()
        data class Err(val kind: Kind, val detail: String) : Result()
    }

    enum class Kind { NOT_CONFIGURED, NETWORK, AUTH, QUOTA, FAILED }

    suspend fun speak(text: String, emotion: String, intensity: Float): Result =
        withContext(Dispatchers.IO) {
            if (!NexusConfig.elevenReady()) {
                return@withContext Result.Err(Kind.NOT_CONFIGURED, "ElevenLabs neconfigurat")
            }
            val clean = text.trim()
            if (clean.isEmpty()) return@withContext Result.Err(Kind.FAILED, "text gol")

            val (stability, style) = voiceShape(emotion, intensity)

            val body = JSONObject().apply {
                put("text", clean.take(4500))
                put("model_id", NexusConfig.ELEVEN_MODEL_ID)
                put(
                    "voice_settings",
                    JSONObject()
                        .put("stability", stability.toDouble())
                        .put("similarity_boost", NexusConfig.VOICE_SIMILARITY.toDouble())
                        .put("style", style.toDouble())
                        .put("use_speaker_boost", NexusConfig.VOICE_SPEAKER_BOOST)
                )
            }

            val url = "${NexusConfig.ELEVEN_BASE_URL}/text-to-speech/${NexusConfig.ELEVEN_VOICE_ID}/with-timestamps" +
                "?output_format=${NexusConfig.ELEVEN_OUTPUT_FORMAT}"

            val res = Http.postJson(
                url,
                body.toString(),
                mapOf(
                    "xi-api-key" to NexusConfig.ELEVEN_API_KEY,
                    "Accept" to "application/json"
                )
            )

            when {
                res.ok && res.body.isNotEmpty() -> try {
                    val payload = JSONObject(res.text())
                    val audio = payload.optString("audio_base64")
                    if (audio.isEmpty()) {
                        Result.Err(Kind.FAILED, "ElevenLabs nu a returnat audio")
                    } else {
                        Result.Ok(audio, payload.optJSONObject("alignment"))
                    }
                } catch (_: Throwable) {
                    Result.Err(Kind.FAILED, "raspuns ElevenLabs invalid")
                }
                res.code == 401 || res.code == 403 -> Result.Err(Kind.AUTH, "cheie invalida")
                res.code == 429 -> Result.Err(Kind.QUOTA, "limita atinsa")
                res.code < 0 -> Result.Err(Kind.NETWORK, res.error ?: "network")
                else -> Result.Err(Kind.FAILED, "HTTP ${res.code}")
            }
        }

    /**
     * Modeleaza vocea dupa emotie: mai putina stabilitate + mai mult stil = livrare
     * mai expresiva si spontana; mai multa stabilitate = calm, asezat.
     */
    private fun voiceShape(emotion: String, intensity: Float): Pair<Float, Float> {
        val i = intensity.coerceIn(0f, 1f)
        var stability = NexusConfig.VOICE_STABILITY
        var style = NexusConfig.VOICE_STYLE
        when (emotion) {
            "happy" -> { stability -= 0.14f * i; style += 0.25f * i }
            "angry" -> { stability -= 0.10f * i; style += 0.20f * i }
            "sad" -> { stability += 0.20f * i; style -= 0.12f * i }
            "relaxed" -> { stability += 0.14f * i; style -= 0.05f * i }
            else -> { stability += 0.04f }
        }
        return stability.coerceIn(0.15f, 0.90f) to style.coerceIn(0f, 0.85f)
    }
}
