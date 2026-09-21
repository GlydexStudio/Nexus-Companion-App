package com.glydexstudio.nexus.ai

import org.json.JSONObject

/**
 * Raspunsul lui Nexus, exact in formatul returnat de flow-ul Gumloop "Nexus Chat":
 *
 * {
 *   "text": "...", "emotion": "happy", "intensity": 0.85,
 *   "behavior": "laugh", "lookAt": { "yaw": 0, "pitch": -2 }
 * }
 */
data class NexusResponse(
    val text: String,
    val emotion: String = "neutral",
    val intensity: Float = 0.6f,
    val behavior: String = "talk",
    val yaw: Float = 0f,
    val pitch: Float = 0f,
    val language: String? = null,
    val memoryAdd: List<Pair<String, String>> = emptyList()
) {
    fun toJson(): JSONObject = JSONObject()
        .put("text", text)
        .put("emotion", emotion)
        .put("intensity", intensity.toDouble())
        .put("behavior", behavior)
        .put("lookAt", JSONObject().put("yaw", yaw.toDouble()).put("pitch", pitch.toDouble()))
        .put("language", language ?: "")

    companion object {
        private val EMOTIONS = setOf("neutral", "relaxed", "happy", "sad", "angry")
        private val BEHAVIORS = setOf(
            "idle", "talk", "laugh", "think", "surprised",
            "concerned", "look_away", "look_at_user"
        )

        /** Parseaza tolerant: accepta JSON curat, JSON in ```fences```, sau text simplu. */
        fun parse(raw: String?): NexusResponse? {
            if (raw.isNullOrBlank()) return null
            val candidate = extractJsonObject(raw)
            if (candidate != null) {
                try {
                    val o = JSONObject(candidate)
                    val text = firstNonBlank(
                        o.optString("text"),
                        o.optString("response"),
                        o.optString("message"),
                        o.optString("output")
                    )
                    if (!text.isNullOrBlank()) return fromJson(o, text)
                } catch (_: Throwable) { }
            }
            // Fallback: flow-ul a returnat text simplu -> tot raspundem frumos.
            val plain = raw.trim()
            if (plain.isEmpty()) return null
            return NexusResponse(
                text = plain,
                emotion = "neutral",
                intensity = 0.55f,
                behavior = "talk"
            )
        }

        private fun fromJson(o: JSONObject, text: String): NexusResponse {
            val emotion = o.optString("emotion", "neutral").lowercase().trim()
                .let { if (it in EMOTIONS) it else "neutral" }
            val behavior = o.optString("behavior", "talk").lowercase().trim()
                .let { if (it in BEHAVIORS) it else "talk" }
            val intensity = o.optDouble("intensity", 0.6).toFloat().coerceIn(0f, 1f)

            var yaw = 0f
            var pitch = 0f
            o.optJSONObject("lookAt")?.let {
                yaw = it.optDouble("yaw", 0.0).toFloat().coerceIn(-35f, 35f)
                pitch = it.optDouble("pitch", 0.0).toFloat().coerceIn(-25f, 25f)
            }

            val mem = mutableListOf<Pair<String, String>>()
            o.optJSONArray("memory_add")?.let { arr ->
                for (i in 0 until arr.length()) {
                    when (val item = arr.opt(i)) {
                        is String -> if (item.isNotBlank()) mem.add(item to "general")
                        is JSONObject -> {
                            val t = item.optString("text")
                            if (t.isNotBlank()) mem.add(t to item.optString("category", "general"))
                        }
                    }
                }
            }

            val lang = o.optString("language").lowercase().takeIf { it.isNotBlank() }

            return NexusResponse(
                text = text.trim(),
                emotion = emotion,
                intensity = intensity,
                behavior = behavior,
                yaw = yaw,
                pitch = pitch,
                language = lang,
                memoryAdd = mem
            )
        }

        private fun firstNonBlank(vararg values: String?): String? =
            values.firstOrNull { !it.isNullOrBlank() }

        /** Gaseste primul obiect JSON echilibrat din text (ignora ```json fences). */
        fun extractJsonObject(raw: String): String? {
            val s = raw.replace("```json", "```").let {
                val i = it.indexOf("```")
                if (i >= 0) {
                    val j = it.indexOf("```", i + 3)
                    if (j > i) it.substring(i + 3, j) else it.substring(i + 3)
                } else it
            }
            val start = s.indexOf('{')
            if (start < 0) return null
            var depth = 0
            var inString = false
            var escape = false
            for (i in start until s.length) {
                val c = s[i]
                when {
                    escape -> escape = false
                    c == '\\' && inString -> escape = true
                    c == '"' -> inString = !inString
                    !inString && c == '{' -> depth++
                    !inString && c == '}' -> {
                        depth--
                        if (depth == 0) return s.substring(start, i + 1)
                    }
                }
            }
            return null
        }
    }
}
