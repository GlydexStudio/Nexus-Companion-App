package com.glydexstudio.nexus

import android.app.Application
import android.webkit.WebView

class NexusApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Un singur proces -> nu e nevoie de data directory suffix.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            try { WebView.setDataDirectorySuffix("nexus") } catch (_: Throwable) { }
        }
    }
}
