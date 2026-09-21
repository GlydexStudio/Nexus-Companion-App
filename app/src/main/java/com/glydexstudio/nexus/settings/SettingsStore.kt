package com.glydexstudio.nexus.settings

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

class SettingsStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("nexus_settings", Context.MODE_PRIVATE)

    companion object {
        const val LANGUAGE = "language"
        const val VOICE_VOLUME = "voiceVolume"
        const val VOICE_ENABLED = "voiceEnabled"
        const val SPEECH_RATE = "speechRate"
        const val AUTO_LISTEN = "autoListen"
        const val ANIMATION_INTENSITY = "animationIntensity"
        const val LIP_SYNC = "lipSync"
        const val EYE_MOVEMENT = "eyeMovement"
        const val CAMERA_ACCESS = "cameraAccess"
        const val VISUAL_EFFECTS = "visualEffects"
        const val REDUCE_MOTION = "reduceMotion"
        const val AVATAR_MODEL = "avatarModel"
    }

    private val defaults = mapOf<String, Any>(
        LANGUAGE to "auto",
        VOICE_VOLUME to 0.9f,
        VOICE_ENABLED to true,
        SPEECH_RATE to 1.0f,
        AUTO_LISTEN to false,
        ANIMATION_INTENSITY to 0.85f,
        LIP_SYNC to true,
        EYE_MOVEMENT to true,
        CAMERA_ACCESS to false,
        VISUAL_EFFECTS to true,
        REDUCE_MOTION to false,
        AVATAR_MODEL to "nexus"
    )

    fun getBool(key: String): Boolean = prefs.getBoolean(key, defaults[key] as? Boolean ?: false)
    fun getFloat(key: String): Float = prefs.getFloat(key, defaults[key] as? Float ?: 0f)
    fun getString(key: String): String = prefs.getString(key, defaults[key] as? String ?: "") ?: ""

    fun set(key: String, value: Any?) {
        val e = prefs.edit()
        when (val d = defaults[key]) {
            is Boolean -> e.putBoolean(key, parseBool(value, d))
            is Float -> e.putFloat(key, parseFloat(value, d))
            is String -> e.putString(key, value?.toString() ?: d)
            else -> e.putString(key, value?.toString() ?: "")
        }
        e.apply()
    }

    fun recognizerLocale(detected: String?): String {
        val lang = when (getString(LANGUAGE)) {
            "ro" -> "ro"
            "en" -> "en"
            "hu" -> "hu"
            else -> detected ?: "ro"
        }
        return when (lang) {
            "en" -> "en-US"
            "hu" -> "hu-HU"
            else -> "ro-RO"
        }
    }

    fun toJson(): JSONObject {
        val o = JSONObject()
        defaults.keys.forEach { k ->
            when (defaults[k]) {
                is Boolean -> o.put(k, getBool(k))
                is Float -> o.put(k, getFloat(k).toDouble())
                else -> o.put(k, getString(k))
            }
        }
        return o
    }

    private fun parseBool(v: Any?, def: Boolean): Boolean = when (v) {
        is Boolean -> v
        is String -> v.equals("true", true) || v == "1"
        is Number -> v.toInt() != 0
        else -> def
    }

    private fun parseFloat(v: Any?, def: Float): Float = when (v) {
        is Number -> v.toFloat()
        is String -> v.toFloatOrNull() ?: def
        is Boolean -> if (v) 1f else 0f
        else -> def
    }.coerceIn(0f, 2f)
}
