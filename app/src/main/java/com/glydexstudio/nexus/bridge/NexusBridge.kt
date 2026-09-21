package com.glydexstudio.nexus.bridge

import android.webkit.JavascriptInterface

/**
 * Puntea JS -> Android. Metodele sunt apelate de pe thread-ul WebView,
 * deci [Host] trebuie sa mute lucrul pe main thread / coroutine.
 */
class NexusBridge(private val host: Host) {

    interface Host {
        fun onWebReady()
        fun sendMessage(text: String)
        fun startListening()
        fun stopListening()
        fun cancelSpeaking()
        fun requestSettings()
        fun updateSetting(key: String, value: String)
        fun requestConversation()
        fun clearConversation()
        fun requestMemory()
        fun resetMemory()
        fun forgetFact(text: String)
        fun setCameraEnabled(enabled: Boolean)
        fun onSpeakingFinished()
        fun onAvatarFailed(reason: String)
        fun onBackResult(handled: Boolean)
        fun logFromWeb(message: String)
    }

    @JavascriptInterface fun ready() = host.onWebReady()

    @JavascriptInterface fun send(text: String) = host.sendMessage(text)

    @JavascriptInterface fun startListening() = host.startListening()

    @JavascriptInterface fun stopListening() = host.stopListening()

    @JavascriptInterface fun cancelSpeaking() = host.cancelSpeaking()

    @JavascriptInterface fun getSettings() = host.requestSettings()

    @JavascriptInterface fun setSetting(key: String, value: String) = host.updateSetting(key, value)

    @JavascriptInterface fun getConversation() = host.requestConversation()

    @JavascriptInterface fun clearConversation() = host.clearConversation()

    @JavascriptInterface fun getMemory() = host.requestMemory()

    @JavascriptInterface fun resetMemory() = host.resetMemory()

    @JavascriptInterface fun forget(text: String) = host.forgetFact(text)

    @JavascriptInterface fun setCameraEnabled(enabled: Boolean) = host.setCameraEnabled(enabled)

    @JavascriptInterface fun speakingFinished() = host.onSpeakingFinished()

    @JavascriptInterface fun avatarFailed(reason: String) = host.onAvatarFailed(reason)

    @JavascriptInterface fun backResult(handled: Boolean) = host.onBackResult(handled)

    @JavascriptInterface fun log(message: String) = host.logFromWeb(message)
}
