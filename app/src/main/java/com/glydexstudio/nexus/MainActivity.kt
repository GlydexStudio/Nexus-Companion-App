package com.glydexstudio.nexus

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import com.glydexstudio.nexus.ai.FriendlyErrors
import com.glydexstudio.nexus.ai.NexusBrain
import com.glydexstudio.nexus.bridge.NexusBridge
import com.glydexstudio.nexus.camera.FrameCapture
import com.glydexstudio.nexus.config.NexusConfig
import com.glydexstudio.nexus.memory.ConversationStore
import com.glydexstudio.nexus.memory.MemoryStore
import com.glydexstudio.nexus.settings.SettingsStore
import com.glydexstudio.nexus.voice.ElevenLabsClient
import com.glydexstudio.nexus.voice.SpeechInput
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

class MainActivity : AppCompatActivity(), NexusBridge.Host {

    private lateinit var webView: WebView
    private lateinit var settings: SettingsStore
    private lateinit var memory: MemoryStore
    private lateinit var conversation: ConversationStore
    private lateinit var brain: NexusBrain
    private lateinit var speech: SpeechInput
    private val eleven = ElevenLabsClient()
    private var camera: FrameCapture? = null

    private var webReady = false
    private var turnJob: Job? = null
    private var pendingMicAfterPermission = false

    /** Scope propriu, anulat in onDestroy - nu depinde de lifecycle-runtime-ktx. */
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingMicAfterPermission) {
            startListening()
        } else if (!granted) {
            emitError(FriendlyErrors.Case.MIC_DENIED)
            emitState(listening = false)
        }
        pendingMicAfterPermission = false
    }

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        settings.set(SettingsStore.CAMERA_ACCESS, granted)
        if (!granted) emitError(FriendlyErrors.Case.CAMERA_DENIED)
        requestSettings()
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        settings = SettingsStore(this)
        memory = MemoryStore(this)
        conversation = ConversationStore(this)
        brain = NexusBrain(this, settings, memory, conversation)
        speech = SpeechInput(this)
        camera = FrameCapture()

        webView = findViewById(R.id.webView)
        configureWebView()
        webView.loadUrl("$ASSET_ORIGIN/web/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webReady) emit("back", JSONObject()) else finish()
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(0xFF06070A.toInt())
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            javaScriptCanOpenWindowsAutomatically = false
            setSupportZoom(false)
            builtInZoomControls = false
            textZoom = 100
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.settings.safeBrowsingEnabled = false
        }
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER

        webView.addJavascriptInterface(NexusBridge(this), "NexusNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                if (url.host != ASSET_HOST) return null
                return serveAsset(url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean = true // fara navigare externa

            override fun onRenderProcessGone(
                view: WebView?,
                detail: android.webkit.RenderProcessGoneDetail?
            ): Boolean {
                // In loc de crash: reincarcam interfata.
                webReady = false
                try { webView.loadUrl("$ASSET_ORIGIN/web/index.html") } catch (_: Throwable) { }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                // Nu dam WebView-ului acces la hardware; audio/camera sunt gestionate nativ.
                request?.deny()
            }

            override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                msg?.let { Log.d(TAG, "web: ${it.message()} @${it.lineNumber()}") }
                return true
            }
        }
    }

    /** Serveste assets prin https:// pentru ca ES modules + WebGL sa functioneze corect. */
    private fun serveAsset(url: Uri): WebResourceResponse? {
        val path = url.path?.trimStart('/') ?: return null
        if (path.contains("..")) return null
        return try {
            val stream = assets.open(path)
            WebResourceResponse(mimeOf(path), "UTF-8", 200, "OK", corsHeaders(), stream)
        } catch (_: IOException) {
            WebResourceResponse(
                "text/plain", "UTF-8", 404, "Not Found",
                corsHeaders(), ByteArrayInputStream(ByteArray(0))
            )
        }
    }

    private fun corsHeaders() = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Cache-Control" to "no-cache"
    )

    private fun mimeOf(path: String): String = when {
        path.endsWith(".html") -> "text/html"
        path.endsWith(".js") -> "text/javascript"
        path.endsWith(".mjs") -> "text/javascript"
        path.endsWith(".css") -> "text/css"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".woff2") -> "font/woff2"
        path.endsWith(".vrm") || path.endsWith(".glb") -> "model/gltf-binary"
        path.endsWith(".mp3") -> "audio/mpeg"
        else -> "application/octet-stream"
    }

    override fun onPause() {
        super.onPause()
        speech.cancel()
        if (webReady) emit("appPaused", JSONObject())
        try { webView.onPause() } catch (_: Throwable) { }
        webView.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        try { webView.onResume() } catch (_: Throwable) { }
        if (webReady) emit("appResumed", JSONObject())
    }

    override fun onDestroy() {
        turnJob?.cancel()
        scope.cancel()
        speech.release()
        camera?.shutdown()
        camera = null
        try {
            webView.removeJavascriptInterface("NexusNative")
            webView.loadUrl("about:blank")
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        } catch (_: Throwable) { }
        super.onDestroy()
    }

    // ------------------------------------------------------------------
    // Android -> JS
    // ------------------------------------------------------------------
    private fun emit(event: String, payload: JSONObject) {
        val js = "window.NexusHost && window.NexusHost.emit(${JSONObject.quote(event)}," +
            "${payload});"
        runOnUiThread {
            try {
                webView.evaluateJavascript(js, null)
            } catch (_: Throwable) { }
        }
    }

    private fun emitState(
        listening: Boolean? = null,
        thinking: Boolean? = null,
        speaking: Boolean? = null
    ) {
        val o = JSONObject()
        listening?.let { o.put("listening", it) }
        thinking?.let { o.put("thinking", it) }
        speaking?.let { o.put("speaking", it) }
        emit("state", o)
    }

    private fun emitError(case: FriendlyErrors.Case) {
        emit(
            "notice",
            JSONObject()
                .put("message", FriendlyErrors.message(case, brain.lastLanguage))
                .put("kind", case.name.lowercase())
        )
    }

    // ------------------------------------------------------------------
    // Bridge (JS -> Android)
    // ------------------------------------------------------------------
    override fun onWebReady() {
        runOnUiThread {
            webReady = true
            requestSettings()
            requestConversation()
            requestMemory()
            emit(
                "config",
                JSONObject()
                    .put("gumloop", NexusConfig.gumloopReady())
                    .put("voice", NexusConfig.elevenReady())
                    .put("speech", speech.available())
                    .put("avatarUrl", "$ASSET_ORIGIN/avatars/nexus.vrm")
            )
            if (!NexusConfig.gumloopReady()) emitError(FriendlyErrors.Case.NOT_CONFIGURED)
        }
    }

    override fun sendMessage(text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        runOnUiThread { runTurn(clean) }
    }

    private fun runTurn(userText: String) {
        turnJob?.cancel()
        emit("userMessage", JSONObject().put("text", userText))
        emitState(listening = false, thinking = true, speaking = false)

        turnJob = scope.launch {
            try {
                val vision = maybeCaptureFrame()
                val outcome = brain.respond(userText, vision)
                emitState(thinking = false)

                when (outcome) {
                    is NexusBrain.Outcome.Success -> {
                        val r = outcome.response
                        emit("nexusResponse", r.toJson())
                        speakIfPossible(r.text, r.emotion, r.intensity)
                    }
                    is NexusBrain.Outcome.Failure -> {
                        // motivul tehnic exact ajunge in logcat (filtreaza dupa tag-ul "Nexus"),
                        // in timp ce utilizatorul vede doar un mesaj natural
                        Log.w(TAG, "Gumloop [${outcome.case}] ${outcome.detail}")
                        emit(
                            "nexusResponse",
                            JSONObject()
                                .put("text", outcome.message)
                                .put("emotion", "relaxed")
                                .put("intensity", 0.4)
                                .put("behavior", "concerned")
                                .put("lookAt", JSONObject().put("yaw", 0).put("pitch", 0))
                                .put("silent", true)
                        )
                        emitState(speaking = false)
                    }
                }
            } catch (_: CancellationException) {
                emitState(thinking = false, speaking = false)
            } catch (t: Throwable) {
                Log.w(TAG, "turn failed", t)
                emitState(thinking = false, speaking = false)
                emitError(FriendlyErrors.Case.AI_DOWN)
            }
        }
    }

    private suspend fun speakIfPossible(text: String, emotion: String, intensity: Float) {
        if (!settings.getBool(SettingsStore.VOICE_ENABLED)) { emitState(speaking = false); return }
        if (!NexusConfig.elevenReady()) { emitState(speaking = false); return }

        when (val res = eleven.speak(text, emotion, intensity)) {
            is ElevenLabsClient.Result.Ok -> {
                emit(
                    "audio",
                    JSONObject()
                        .put("mime", "audio/mpeg")
                        .put("data", res.base64Mp3)
                        .putOpt("alignment", res.alignment)
                        .put("volume", settings.getFloat(SettingsStore.VOICE_VOLUME).toDouble())
                        .put("rate", settings.getFloat(SettingsStore.SPEECH_RATE).toDouble())
                )
            }
            is ElevenLabsClient.Result.Err -> {
                emitState(speaking = false)
                if (res.kind != ElevenLabsClient.Kind.NOT_CONFIGURED) {
                    emitError(FriendlyErrors.Case.VOICE_DOWN)
                }
            }
        }
    }

    private suspend fun maybeCaptureFrame(): String? {
        if (!settings.getBool(SettingsStore.CAMERA_ACCESS)) return null
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) return null
        val cam = camera ?: return null
        return kotlinx.coroutines.withTimeoutOrNull(2500) {
            kotlinx.coroutines.suspendCancellableCoroutine<String?> { cont ->
                try {
                    cam.captureFrontFrame(this@MainActivity) { b64 ->
                        if (cont.isActive) cont.resume(b64) { }
                    }
                } catch (_: Throwable) {
                    if (cont.isActive) cont.resume(null) { }
                }
            }
        }
    }

    override fun startListening() {
        runOnUiThread {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
            ) {
                pendingMicAfterPermission = true
                micPermission.launch(Manifest.permission.RECORD_AUDIO)
                return@runOnUiThread
            }
            if (!speech.available()) { emitError(FriendlyErrors.Case.MIC_DENIED); return@runOnUiThread }

            emit("stopAudio", JSONObject())
            emitState(listening = true, speaking = false)

            speech.start(settings.recognizerLocale(brain.lastLanguage), object : SpeechInput.Callbacks {
                override fun onReady() = emitState(listening = true)
                override fun onLevel(rms: Float) =
                    emit("micLevel", JSONObject().put("level", rms.toDouble()))

                override fun onPartial(text: String) =
                    emit("partial", JSONObject().put("text", text))

                override fun onFinal(text: String) {
                    emitState(listening = false)
                    runTurn(text)
                }

                override fun onEnd() = emitState(listening = false)

                override fun onFailure(permanent: Boolean) {
                    emitState(listening = false)
                    emitError(FriendlyErrors.Case.MIC_DENIED)
                }
            })
        }
    }

    override fun stopListening() {
        runOnUiThread {
            speech.stop()
            emitState(listening = false)
        }
    }

    override fun cancelSpeaking() {
        runOnUiThread {
            turnJob?.cancel()
            emit("stopAudio", JSONObject())
            emitState(thinking = false, speaking = false)
        }
    }

    override fun requestSettings() {
        runOnUiThread { emit("settings", settings.toJson()) }
    }

    override fun updateSetting(key: String, value: String) {
        runOnUiThread {
            if (key == SettingsStore.CAMERA_ACCESS && (value == "true" || value == "1")) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    cameraPermission.launch(Manifest.permission.CAMERA)
                    return@runOnUiThread
                }
            }
            settings.set(key, value)
            requestSettings()
        }
    }

    override fun requestConversation() {
        runOnUiThread {
            emit("conversation", JSONObject().put("items", conversation.toJsonArray()))
        }
    }

    override fun clearConversation() {
        runOnUiThread {
            conversation.clear()
            requestConversation()
        }
    }

    override fun requestMemory() {
        runOnUiThread { emit("memory", JSONObject().put("items", memory.toJsonArray())) }
    }

    override fun resetMemory() {
        runOnUiThread {
            memory.reset()
            requestMemory()
        }
    }

    override fun forgetFact(text: String) {
        runOnUiThread {
            memory.remove(text)
            requestMemory()
        }
    }

    override fun setCameraEnabled(enabled: Boolean) =
        updateSetting(SettingsStore.CAMERA_ACCESS, enabled.toString())

    override fun onSpeakingFinished() {
        runOnUiThread {
            emitState(speaking = false)
            if (settings.getBool(SettingsStore.AUTO_LISTEN)) startListening()
        }
    }

    override fun onAvatarFailed(reason: String) {
        Log.w(TAG, "avatar failed: $reason")
        runOnUiThread { emitError(FriendlyErrors.Case.AVATAR_FAILED) }
    }

    override fun onBackResult(handled: Boolean) {
        if (!handled) runOnUiThread { finish() }
    }

    override fun logFromWeb(message: String) {
        Log.d(TAG, "web: $message")
    }

    companion object {
        private const val TAG = "Nexus"
        private const val ASSET_HOST = "appassets.nexus.local"
        private const val ASSET_ORIGIN = "https://$ASSET_HOST"
    }
}
