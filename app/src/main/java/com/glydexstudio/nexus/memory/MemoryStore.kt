package com.glydexstudio.nexus.memory

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Memoria pe termen lung a lui Nexus (preferinte, interese, proiecte, stil).
 *
 * REGULA: se scriu DOAR fapte trimise explicit de flow-ul Gumloop in campul
 * "memory_add" sau salvate manual de utilizator. Nexus nu inventeaza amintiri.
 */
class MemoryStore(context: Context) {

    private val prefs = context.getSharedPreferences("nexus_memory", Context.MODE_PRIVATE)
    private val key = "facts"
    private val maxFacts = 120

    @Synchronized
    fun all(): List<MemoryFact> {
        val raw = prefs.getString(key, "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                MemoryFact(
                    text = o.optString("text"),
                    category = o.optString("category", "general"),
                    ts = o.optLong("ts", 0L)
                ).takeIf { it.text.isNotBlank() }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    @Synchronized
    fun add(text: String, category: String = "general") {
        val clean = text.trim()
        if (clean.isEmpty() || clean.length > 300) return
        val current = all().toMutableList()
        // fara duplicate (comparatie case-insensitive)
        if (current.any { it.text.equals(clean, ignoreCase = true) }) return
        current.add(MemoryFact(clean, category, System.currentTimeMillis()))
        while (current.size > maxFacts) current.removeAt(0)
        persist(current)
    }

    @Synchronized
    fun addAll(items: List<Pair<String, String>>) = items.forEach { add(it.first, it.second) }

    @Synchronized
    fun remove(text: String) {
        persist(all().filterNot { it.text.equals(text, ignoreCase = true) })
    }

    @Synchronized
    fun reset() = prefs.edit().remove(key).apply()

    /** Format compact trimis catre flow-ul Gumloop. */
    fun asPromptBlock(): String {
        val facts = all()
        if (facts.isEmpty()) return ""
        return facts.joinToString("\n") { "- [${it.category}] ${it.text}" }
    }

    fun toJsonArray(): JSONArray {
        val arr = JSONArray()
        all().forEach {
            arr.put(JSONObject().put("text", it.text).put("category", it.category).put("ts", it.ts))
        }
        return arr
    }

    private fun persist(list: List<MemoryFact>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().put("text", it.text).put("category", it.category).put("ts", it.ts))
        }
        prefs.edit().putString(key, arr.toString()).apply()
    }

    data class MemoryFact(val text: String, val category: String, val ts: Long)
}
