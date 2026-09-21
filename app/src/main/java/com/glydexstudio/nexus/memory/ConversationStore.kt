package com.glydexstudio.nexus.memory

import android.content.Context
import com.glydexstudio.nexus.config.NexusConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Istoricul conversatiei, pastrat local in fisier JSON. Poate fi sters de utilizator. */
class ConversationStore(context: Context) {

    private val file = File(context.filesDir, "nexus_conversation.json")
    private val meta = context.getSharedPreferences("nexus_conversation_meta", Context.MODE_PRIVATE)

    /** ID-ul sesiunii Gumloop; null = conversatie noua. */
    var interactionId: String?
        get() = meta.getString("interaction_id", null)?.takeIf { it.isNotBlank() }
        set(value) {
            meta.edit().putString("interaction_id", value?.takeIf { it.isNotBlank() }).apply()
        }

    @Synchronized
    fun all(): List<Turn> {
        if (!file.exists()) return emptyList()
        return try {
            val arr = JSONArray(file.readText())
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                Turn(
                    role = o.optString("role", "user"),
                    text = o.optString("text"),
                    emotion = o.optString("emotion", "neutral"),
                    ts = o.optLong("ts", 0L)
                ).takeIf { it.text.isNotBlank() }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    @Synchronized
    fun append(role: String, text: String, emotion: String = "neutral") {
        val list = all().toMutableList()
        list.add(Turn(role, text.trim(), emotion, System.currentTimeMillis()))
        while (list.size > NexusConfig.HISTORY_STORE_LIMIT) list.removeAt(0)
        write(list)
    }

    @Synchronized
    fun clear() {
        try { if (file.exists()) file.delete() } catch (_: Throwable) { }
        interactionId = null
    }

    /** Ultimele N schimburi, in formatul trimis catre Gumloop. */
    fun recentAsJson(turns: Int = NexusConfig.HISTORY_TURNS): JSONArray {
        val list = all()
        val slice = if (list.size > turns * 2) list.subList(list.size - turns * 2, list.size) else list
        val arr = JSONArray()
        slice.forEach { arr.put(JSONObject().put("role", it.role).put("content", it.text)) }
        return arr
    }

    fun toJsonArray(): JSONArray {
        val arr = JSONArray()
        all().forEach {
            arr.put(
                JSONObject()
                    .put("role", it.role)
                    .put("text", it.text)
                    .put("emotion", it.emotion)
                    .put("ts", it.ts)
            )
        }
        return arr
    }

    private fun write(list: List<Turn>) {
        try {
            val arr = JSONArray()
            list.forEach {
                arr.put(
                    JSONObject()
                        .put("role", it.role)
                        .put("text", it.text)
                        .put("emotion", it.emotion)
                        .put("ts", it.ts)
                )
            }
            file.writeText(arr.toString())
        } catch (_: Throwable) { }
    }

    data class Turn(val role: String, val text: String, val emotion: String, val ts: Long)
}
