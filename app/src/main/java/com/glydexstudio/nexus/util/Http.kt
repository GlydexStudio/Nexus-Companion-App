package com.glydexstudio.nexus.util

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Client HTTP minimal (fara dependinte externe) folosit pentru Gumloop si ElevenLabs.
 * Nu arunca niciodata exceptii in afara: intoarce mereu un [HttpResult].
 */
object Http {

    data class HttpResult(
        val ok: Boolean,
        val code: Int,
        val body: ByteArray,
        val error: String? = null
    ) {
        fun text(): String = String(body, Charsets.UTF_8)
    }

    private const val CONNECT_TIMEOUT = 15_000
    private const val READ_TIMEOUT = 60_000

    fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResult =
        request("GET", url, headers, null, null)

    fun postJson(
        url: String,
        json: String,
        headers: Map<String, String> = emptyMap()
    ): HttpResult = request("POST", url, headers, json.toByteArray(Charsets.UTF_8), "application/json")

    private fun request(
        method: String,
        url: String,
        headers: Map<String, String>,
        body: ByteArray?,
        contentType: String?
    ): HttpResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = CONNECT_TIMEOUT
                readTimeout = READ_TIMEOUT
                instanceFollowRedirects = true
                setRequestProperty("Accept-Encoding", "identity")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
                if (body != null) {
                    doOutput = true
                    if (contentType != null) setRequestProperty("Content-Type", contentType)
                    setFixedLengthStreamingMode(body.size)
                }
            }
            if (conn is HttpsURLConnection) {
                // nimic special, dar pastram referinta pentru claritate
            }
            body?.let { conn.outputStream.use { os -> os.write(it); os.flush() } }

            val code = conn.responseCode
            val stream: InputStream? = if (code in 200..299) conn.inputStream else conn.errorStream
            val bytes = stream?.use { readAll(it) } ?: ByteArray(0)
            HttpResult(
                ok = code in 200..299,
                code = code,
                body = bytes,
                error = if (code in 200..299) null else "HTTP $code"
            )
        } catch (t: Throwable) {
            HttpResult(false, -1, ByteArray(0), t.message ?: t.javaClass.simpleName)
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) { }
        }
    }

    private fun readAll(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream(16 * 1024)
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
