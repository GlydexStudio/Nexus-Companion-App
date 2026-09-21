package com.glydexstudio.nexus.ai

import android.content.Context
import com.glydexstudio.nexus.memory.ConversationStore
import com.glydexstudio.nexus.memory.MemoryStore
import com.glydexstudio.nexus.settings.SettingsStore

/**
 * Leaga tot ce inseamna "gandire": istoric + memorie + limba + context vizual
 * -> agentul Gumloop "Nexus Chat" -> raspuns validat pentru avatar si voce.
 */
class NexusBrain(
    context: Context,
    private val settings: SettingsStore,
    private val memory: MemoryStore,
    private val conversation: ConversationStore
) {
    private val gumloop = GumloopClient()

    @Volatile
    var lastLanguage: String = "ro"
        private set

    sealed class Outcome {
        data class Success(val response: NexusResponse) : Outcome()
        data class Failure(
            val case: FriendlyErrors.Case,
            val message: String,
            val lang: String,
            val detail: String = ""
        ) : Outcome()
    }

    suspend fun respond(userText: String, visionBase64: String?): Outcome {
        val text = userText.trim()
        if (text.isEmpty()) {
            return Outcome.Failure(
                FriendlyErrors.Case.AI_DOWN,
                FriendlyErrors.message(FriendlyErrors.Case.AI_DOWN, lastLanguage),
                lastLanguage
            )
        }

        val configured = settings.getString(SettingsStore.LANGUAGE)
        val lang = if (configured == "auto") LanguageDetector.detect(text, lastLanguage) else configured
        lastLanguage = lang

        val history = conversation.recentAsJson()
        conversation.append("user", text)

        val result = gumloop.ask(
            message = text,
            history = history,
            memory = memory.asPromptBlock(),
            language = lang,
            visionBase64 = visionBase64,
            interactionId = conversation.interactionId
        )

        return when (result) {
            is GumloopClient.Result.Ok -> {
                conversation.interactionId = result.interactionId
                val parsed = NexusResponse.parse(result.raw)
                if (parsed == null) {
                    fail(
                        FriendlyErrors.Case.AI_DOWN, lang,
                        "agentul a raspuns, dar nu am putut extrage text: " +
                            result.raw.take(200)
                    )
                } else {
                    if (parsed.memoryAdd.isNotEmpty()) memory.addAll(parsed.memoryAdd)
                    conversation.append("nexus", parsed.text, parsed.emotion)
                    parsed.language?.let { if (it in listOf("ro", "en", "hu")) lastLanguage = it }
                    Outcome.Success(parsed)
                }
            }
            is GumloopClient.Result.Err -> when (result.kind) {
                GumloopClient.Kind.NOT_CONFIGURED ->
                    fail(FriendlyErrors.Case.NOT_CONFIGURED, lang, result.detail)
                GumloopClient.Kind.NETWORK ->
                    fail(FriendlyErrors.Case.NO_INTERNET, lang, result.detail)
                GumloopClient.Kind.AUTH ->
                    fail(FriendlyErrors.Case.NOT_CONFIGURED, lang, result.detail)
                GumloopClient.Kind.TIMEOUT ->
                    fail(FriendlyErrors.Case.SLOW, lang, result.detail)
                else ->
                    fail(FriendlyErrors.Case.AI_DOWN, lang, "${result.kind}: ${result.detail}")
            }
        }
    }

    private fun fail(case: FriendlyErrors.Case, lang: String, detail: String = "") =
        Outcome.Failure(case, FriendlyErrors.message(case, lang), lang, detail)
}
