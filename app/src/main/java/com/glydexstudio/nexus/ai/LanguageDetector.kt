package com.glydexstudio.nexus.ai

/**
 * Detectie rapida ro / en / hu pentru a alege locale-ul de speech recognition
 * si limba mesajelor de eroare. Decizia finala de limba o ia tot flow-ul Gumloop.
 */
object LanguageDetector {

    private val RO_WORDS = setOf(
        "si", "este", "sunt", "nu", "bine", "ce", "faci", "multumesc", "salut", "buna",
        "vreau", "poti", "cum", "pentru", "acum", "azi", "maine", "despre", "unde", "cand"
    )
    private val HU_WORDS = setOf(
        "es", "van", "nem", "igen", "hogy", "mit", "csinalsz", "koszonom", "szia", "jo",
        "akarok", "tudsz", "hogyan", "miert", "ma", "holnap", "hol", "mikor", "kerlek"
    )
    private val EN_WORDS = setOf(
        "the", "and", "you", "are", "what", "how", "hello", "hi", "thanks", "please",
        "want", "can", "today", "tomorrow", "where", "when", "why", "good", "about"
    )

    fun detect(text: String, fallback: String = "ro"): String {
        val t = text.lowercase()
        if (t.isBlank()) return fallback

        var ro = 0; var hu = 0; var en = 0

        // diacritice specifice
        if (Regex("[ăâîșțşţ]").containsMatchIn(t)) ro += 3
        if (Regex("[őűáéíóöüú]").containsMatchIn(t)) hu += 2
        if (Regex("[őű]").containsMatchIn(t)) hu += 3

        val normalized = t
            .replace(Regex("[ăâ]"), "a").replace("î", "i")
            .replace(Regex("[șş]"), "s").replace(Regex("[țţ]"), "t")
            .replace(Regex("[áà]"), "a").replace(Regex("[éè]"), "e")
            .replace(Regex("[íì]"), "i").replace(Regex("[óöő]"), "o")
            .replace(Regex("[úüű]"), "u")

        normalized.split(Regex("[^a-z]+")).filter { it.isNotEmpty() }.forEach { w ->
            if (w in RO_WORDS) ro++
            if (w in HU_WORDS) hu++
            if (w in EN_WORDS) en++
        }

        return when {
            ro == 0 && hu == 0 && en == 0 -> fallback
            ro >= hu && ro >= en -> "ro"
            hu >= en -> "hu"
            else -> "en"
        }
    }
}
