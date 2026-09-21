package com.glydexstudio.nexus.ai

/**
 * Mesaje naturale afisate utilizatorului. Niciodata stack trace-uri sau coduri HTTP.
 * Nexus "isi cere scuze" in stilul ei, in limba curenta.
 */
object FriendlyErrors {

    enum class Case { NO_INTERNET, AI_DOWN, VOICE_DOWN, MIC_DENIED, CAMERA_DENIED, AVATAR_FAILED, NOT_CONFIGURED, SLOW }

    fun message(case: Case, lang: String): String {
        val l = if (lang in listOf("ro", "en", "hu")) lang else "ro"
        return when (case) {
            Case.NO_INTERNET -> when (l) {
                "en" -> "I lost the connection for a second. Check your internet and I'm right back."
                "hu" -> "Egy pillanatra elvesztettem a kapcsolatot. Nezd meg a netet, es folytatjuk."
                else -> "Mi-a picat conexiunea o secundă. Verifică internetul și continuăm."
            }
            Case.AI_DOWN -> when (l) {
                "en" -> "My thoughts got stuck on the way. Say that again?"
                "hu" -> "Elakadtak a gondolataim utkozben. Megismetled?"
                else -> "Mi s-au blocat gândurile pe drum. Mai zi o dată?"
            }
            Case.VOICE_DOWN -> when (l) {
                "en" -> "My voice isn't coming through right now, so I'll stay in text for a bit."
                "hu" -> "A hangom most nem jon at, szoval maradok szovegben egy kicsit."
                else -> "Nu-mi iese vocea acum, așa că rămân pe text un pic."
            }
            Case.MIC_DENIED -> when (l) {
                "en" -> "I can't hear you without mic access, but you can type and I'll answer."
                "hu" -> "Mikrofon nelkul nem hallak, de irhatsz is, es valaszolok."
                else -> "Fără microfon nu te aud, dar poți scrie și îți răspund."
            }
            Case.CAMERA_DENIED -> when (l) {
                "en" -> "No camera then. Totally fine, we talk anyway."
                "hu" -> "Akkor kamera nelkul. Semmi gond, igy is beszelgetunk."
                else -> "Atunci fără cameră. E ok, vorbim oricum."
            }
            Case.AVATAR_FAILED -> when (l) {
                "en" -> "My body didn't load this time, but I'm still here with you."
                "hu" -> "A testem most nem toltodott be, de itt vagyok veled."
                else -> "Nu mi s-a încărcat corpul de data asta, dar sunt aici cu tine."
            }
            Case.NOT_CONFIGURED -> when (l) {
                "en" -> "I'm not fully wired up yet - add the API keys in NexusConfig and I wake up."
                "hu" -> "Meg nem vagyok teljesen bekotve - add meg az API kulcsokat a NexusConfig-ban."
                else -> "Încă nu sunt conectată complet - pune cheile API în NexusConfig și mă trezesc."
            }
            Case.SLOW -> when (l) {
                "en" -> "That took longer than I'd like. Try me once more?"
                "hu" -> "Ez tovabb tartott a kelletenel. Probalod megegyszer?"
                else -> "A durat mai mult decât mi-ar plăcea. Mai încerci o dată?"
            }
        }
    }
}
