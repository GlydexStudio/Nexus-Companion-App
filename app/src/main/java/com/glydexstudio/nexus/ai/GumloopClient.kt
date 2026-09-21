package com.glydexstudio.nexus.ai

import android.util.Log
import com.glydexstudio.nexus.config.NexusConfig
import com.glydexstudio.nexus.util.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Client pentru agentul Gumloop "Nexus Chat".
 *
 * 1) POST /start_agent              -> interaction_id
 * 2) GET  /agent_status/{id}        -> poll pana la COMPLETED si citeste raspunsul
 *
 * Conversatia continua pe acelasi interaction_id (agentul tine istoricul).
 * Daca utilizatorul sterge istoricul, interaction_id se reseteaza.
 */
class GumloopClient {

    sealed class Result {
        data class Ok(val raw: String, val interactionId: String) : Result()
        data class Err(val kind: Kind, val detail: String) : Result()
    }

    enum class Kind { NOT_CONFIGURED, NETWORK, AUTH, TIMEOUT, FLOW_FAILED, EMPTY }

    private fun headers(): Map<String, String> = buildMap {
        put("Authorization", "Bearer ${NexusConfig.GUMLOOP_API_KEY}")
        put("Accept", "application/json")
        put("x-auth-key", NexusConfig.GUMLOOP_USER_ID)
    }

    suspend fun ask(
        message: String,
        history: JSONArray,
        memory: String,
        language: String,
        visionBase64: String?,
        interactionId: String?
    ): Result = withContext(Dispatchers.IO) {
        if (!NexusConfig.gumloopReady()) {
            return@withContext Result.Err(Kind.NOT_CONFIGURED, "Gumloop nu este configurat")
        }

        val payload = buildPayload(message, history, memory, language, visionBase64)
        val continuing = !interactionId.isNullOrBlank()

        val body = JSONObject().apply {
            put("gummie_id", NexusConfig.GUMLOOP_AGENT_ID)
            put("user_id", NexusConfig.GUMLOOP_USER_ID)
            put("message", payload)
            if (NexusConfig.GUMLOOP_PROJECT_ID.isNotBlank()) {
                put("project_id", NexusConfig.GUMLOOP_PROJECT_ID)
            }
            if (continuing) put("interaction_id", interactionId)
        }

        val start = Http.postJson(
            "${NexusConfig.GUMLOOP_BASE_URL}/start_agent",
            body.toString(),
            headers()
        )

        Log.d(
            "Nexus",
            "start_agent -> HTTP ${start.code} (agent=${NexusConfig.GUMLOOP_AGENT_ID}" +
                ", continue=${continuing})"
        )

        if (!start.ok) {
            // 409 = interactiunea anterioara inca ruleaza; o luam de la capat fara ea
            if (start.code == 409 && continuing) {
                Log.w("Nexus", "interaction ocupata, reiau fara interaction_id")
                return@withContext ask(message, history, memory, language, visionBase64, null)
            }
            return@withContext when {
                start.code == 401 || start.code == 403 ->
                    Result.Err(Kind.AUTH, "Cheie / agent inaccesibil (${start.code}): ${start.text().take(180)}")
                start.code == 404 ->
                    Result.Err(Kind.NOT_CONFIGURED, "Agentul nu exista (404). Verifica GUMLOOP_AGENT_ID.")
                start.code < 0 -> Result.Err(Kind.NETWORK, start.error ?: "network")
                else -> Result.Err(Kind.FLOW_FAILED, "start_agent ${start.code}: ${start.text().take(220)}")
            }
        }

        val started = try { JSONObject(start.text()) } catch (_: Throwable) { JSONObject() }
        val id = started.optString("interaction_id").ifBlank { interactionId.orEmpty() }
        if (id.isBlank()) {
            return@withContext Result.Err(Kind.FLOW_FAILED, "interaction_id lipsa din raspuns")
        }

        pollInteraction(id)
    }

    private suspend fun pollInteraction(interactionId: String): Result {
        val deadline = System.currentTimeMillis() + NexusConfig.GUMLOOP_TIMEOUT_MS
        var url = "${NexusConfig.GUMLOOP_BASE_URL}/agent_status/$interactionId" +
            "?user_id=${NexusConfig.GUMLOOP_USER_ID}"
        if (NexusConfig.GUMLOOP_PROJECT_ID.isNotBlank()) {
            url += "&project_id=${NexusConfig.GUMLOOP_PROJECT_ID}"
        }

        var backoff = NexusConfig.GUMLOOP_POLL_INTERVAL_MS
        while (System.currentTimeMillis() < deadline) {
            delay(backoff)
            if (backoff < 5_000) backoff += 400

            val res = Http.get(url, headers())
            if (!res.ok) {
                if (res.code == 401 || res.code == 403) {
                    return Result.Err(Kind.AUTH, "Cheie Gumloop invalida (${res.code})")
                }
                if (res.code == 404) {
                    return Result.Err(Kind.FLOW_FAILED, "interaction_id necunoscut")
                }
                continue
            }

            val json = try { JSONObject(res.text()) } catch (_: Throwable) { continue }
            val state = json.optString("state").uppercase()
            when (state) {
                "COMPLETED", "IDLE" -> {
                    val raw = extractResponse(json)
                    Log.d("Nexus", "agent $state, raspuns ${raw?.length ?: 0} caractere")
                    return if (raw.isNullOrBlank()) {
                        Result.Err(Kind.EMPTY, "agent terminat fara raspuns")
                    } else {
                        Result.Ok(raw, interactionId)
                    }
                }
                "FAILED" -> {
                    val err = json.optString("error_message").ifBlank { "agent failed" }
                    return Result.Err(Kind.FLOW_FAILED, err.take(300))
                }
                else -> { /* ASYNC_PROCESSING / QUEUED / PROCESSING */ }
            }
        }
        return Result.Err(Kind.TIMEOUT, "agent timeout")
    }

    /**
     * Agentul primeste un singur string. Impachetam contextul (memorie, limba, vision)
     * in mesaj, ca sa nu depindem de noduri de Input.
     */
    private fun buildPayload(
        message: String,
        history: JSONArray,
        memory: String,
        language: String,
        visionBase64: String?
    ): String {
        val sb = StringBuilder()
        sb.append("Limba detectata: ").append(language).append('\n')
        if (memory.isNotBlank()) {
            sb.append("Memorie despre utilizator:\n").append(memory).append("\n\n")
        }
        if (history.length() > 0) {
            sb.append("Istoric recent (doar daca e prima interactiune; altfel ignora):\n")
            sb.append(history.toString()).append("\n\n")
        }
        if (!visionBase64.isNullOrBlank()) {
            sb.append("Context vizual (JPEG base64, optional):\n")
            sb.append(visionBase64).append("\n\n")
        }
        sb.append("Mesajul utilizatorului:\n").append(message).append('\n')
        sb.append("\nRaspunde EXCLUSIV cu JSON-ul {text, emotion, intensity, behavior, lookAt, language, memory_add}.")
        return sb.toString()
    }

    private fun extractResponse(json: JSONObject): String? {
        json.optString("response").takeIf { it.isNotBlank() }?.let { return it }

        val messages = json.optJSONArray("messages") ?: return null
        for (i in messages.length() - 1 downTo 0) {
            val m = messages.optJSONObject(i) ?: continue
            val role = m.optString("role").lowercase()
            if (role == "user" || role == "human") continue
            val content = flattenContent(m.opt("content") ?: m.opt("text") ?: m.opt("message"))
            if (!content.isNullOrBlank()) return content
        }
        return null
    }

    private fun flattenContent(value: Any?): String? = when (value) {
        null, JSONObject.NULL -> null
        is String -> value
        is JSONArray -> (0 until value.length())
            .mapNotNull { flattenContent(value.opt(it)) }
            .firstOrNull { it.isNotBlank() }
        is JSONObject -> {
            value.optString("text").takeIf { it.isNotBlank() }
                ?: value.optString("content").takeIf { it.isNotBlank() }
                ?: value.toString()
        }
        else -> value.toString()
    }
}
