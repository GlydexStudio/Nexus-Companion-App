package com.glydexstudio.nexus.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * Speech recognition on-device / Google, cu rezultate partiale pentru feedback vizual.
 * Trebuie folosit pe main thread (cerinta SpeechRecognizer).
 */
class SpeechInput(private val context: Context) {

    interface Callbacks {
        fun onReady()
        fun onLevel(rms: Float)
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onEnd()
        fun onFailure(permanent: Boolean)
    }

    private var recognizer: SpeechRecognizer? = null
    private var callbacks: Callbacks? = null
    var isListening = false
        private set

    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(localeTag: String, cb: Callbacks) {
        stop()
        callbacks = cb
        if (!available()) { cb.onFailure(true); return }

        val r = try {
            SpeechRecognizer.createSpeechRecognizer(context)
        } catch (_: Throwable) {
            cb.onFailure(true); return
        }
        recognizer = r

        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { isListening = true; cb.onReady() }
            override fun onBeginningOfSpeech() { }
            override fun onRmsChanged(rmsdB: Float) {
                cb.onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
            }
            override fun onBufferReceived(buffer: ByteArray?) { }
            override fun onEndOfSpeech() { isListening = false }

            override fun onError(error: Int) {
                isListening = false
                val permanent = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ||
                    error == SpeechRecognizer.ERROR_CLIENT
                val silent = error == SpeechRecognizer.ERROR_NO_MATCH ||
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                release()
                if (silent) cb.onEnd() else cb.onFailure(permanent)
            }

            override fun onResults(results: Bundle?) {
                isListening = false
                val text = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.trim()
                    .orEmpty()
                release()
                if (text.isNotEmpty()) cb.onFinal(text) else cb.onEnd()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.let { if (it.isNotBlank()) cb.onPartial(it) }
            }

            override fun onEvent(eventType: Int, params: Bundle?) { }
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, localeTag)
            putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, localeTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1400L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L)
        }

        try {
            r.startListening(intent)
            isListening = true
        } catch (_: Throwable) {
            release()
            cb.onFailure(false)
        }
    }

    fun stop() {
        try { recognizer?.stopListening() } catch (_: Throwable) { }
        isListening = false
    }

    fun cancel() {
        try { recognizer?.cancel() } catch (_: Throwable) { }
        release()
    }

    fun release() {
        try { recognizer?.destroy() } catch (_: Throwable) { }
        recognizer = null
        isListening = false
    }

    @Suppress("unused")
    fun localeOf(tag: String): Locale = Locale.forLanguageTag(tag)
}
