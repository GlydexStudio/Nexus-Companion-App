package com.glydexstudio.nexus.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Size
import com.glydexstudio.nexus.config.NexusConfig
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Captureaza UN SINGUR cadru de pe camera frontala, la cerere, apoi elibereaza imediat
 * camera. Foloseste Camera2 (API de platforma) - fara nicio dependinta externa.
 *
 * Camera nu ruleaza continuu: fara consum inutil de baterie si fara memory leaks.
 * Complet optionala: daca lipseste permisiunea, hardware-ul sau ceva esueaza pe drum,
 * intoarce null si aplicatia continua normal.
 */
class FrameCapture {

    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private val busy = AtomicBoolean(false)

    private fun ensureHandler(): Handler {
        if (thread == null) {
            thread = HandlerThread("nexus-camera").apply { start() }
            handler = Handler(thread!!.looper)
        }
        return handler!!
    }

    @SuppressLint("MissingPermission")
    fun captureFrontFrame(context: Context, callback: (String?) -> Unit) {
        if (!busy.compareAndSet(false, true)) { callback(null); return }

        val done = AtomicBoolean(false)
        var device: CameraDevice? = null
        var session: CameraCaptureSession? = null
        var reader: ImageReader? = null

        fun finish(result: String?) {
            if (!done.compareAndSet(false, true)) return
            try { session?.close() } catch (_: Throwable) { }
            try { device?.close() } catch (_: Throwable) { }
            try { reader?.close() } catch (_: Throwable) { }
            busy.set(false)
            callback(result)
        }

        try {
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val cameraId = frontCameraId(manager) ?: run { finish(null); return }

            val characteristics = manager.getCameraCharacteristics(cameraId)
            val sensorOrientation =
                characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
            val size = pickSmallJpegSize(
                characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            )

            val h = ensureHandler()
            val imageReader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 1)
            reader = imageReader

            imageReader.setOnImageAvailableListener({ r ->
                var bytes: ByteArray? = null
                var image: android.media.Image? = null
                try {
                    image = r.acquireLatestImage()
                    if (image != null) {
                        val buf = image.planes[0].buffer
                        bytes = ByteArray(buf.remaining()).also { buf.get(it) }
                    }
                } catch (_: Throwable) {
                } finally {
                    try { image?.close() } catch (_: Throwable) { }
                }
                finish(bytes?.let { downscaleToBase64(it, sensorOrientation) })
            }, h)

            // plasa de siguranta: daca hardware-ul nu raspunde, nu blocam conversatia
            h.postDelayed({ finish(null) }, 2200)

            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(cam: CameraDevice) {
                    device = cam
                    if (done.get()) { finish(null); return }
                    try {
                        @Suppress("DEPRECATION")
                        cam.createCaptureSession(
                            listOf(imageReader.surface),
                            object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(s: CameraCaptureSession) {
                                    session = s
                                    if (done.get()) { finish(null); return }
                                    try {
                                        val req = cam.createCaptureRequest(
                                            CameraDevice.TEMPLATE_STILL_CAPTURE
                                        ).apply {
                                            addTarget(imageReader.surface)
                                            set(
                                                CaptureRequest.CONTROL_AE_MODE,
                                                CaptureRequest.CONTROL_AE_MODE_ON
                                            )
                                            set(
                                                CaptureRequest.CONTROL_AF_MODE,
                                                CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                                            )
                                            set(CaptureRequest.JPEG_ORIENTATION, 0)
                                        }
                                        s.capture(req.build(), null, h)
                                    } catch (_: Throwable) {
                                        finish(null)
                                    }
                                }

                                override fun onConfigureFailed(s: CameraCaptureSession) {
                                    session = s
                                    finish(null)
                                }
                            },
                            h
                        )
                    } catch (_: Throwable) {
                        finish(null)
                    }
                }

                override fun onDisconnected(cam: CameraDevice) {
                    device = cam
                    finish(null)
                }

                override fun onError(cam: CameraDevice, error: Int) {
                    device = cam
                    finish(null)
                }
            }, h)
        } catch (_: SecurityException) {
            finish(null)
        } catch (_: Throwable) {
            finish(null)
        }
    }

    fun shutdown() {
        try { thread?.quitSafely() } catch (_: Throwable) { }
        thread = null
        handler = null
    }

    private fun frontCameraId(manager: CameraManager): String? = try {
        manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
        }
    } catch (_: Throwable) {
        null
    }

    /** Cea mai mica rezolutie JPEG rezonabila: rapid de capturat si de trimis. */
    private fun pickSmallJpegSize(map: StreamConfigurationMap?): Size {
        val sizes = try { map?.getOutputSizes(ImageFormat.JPEG) } catch (_: Throwable) { null }
        if (sizes.isNullOrEmpty()) return Size(640, 480)
        return sizes
            .filter { it.width in 320..1280 }
            .minByOrNull { it.width.toLong() * it.height }
            ?: sizes.minByOrNull { it.width.toLong() * it.height }
            ?: Size(640, 480)
    }

    private fun downscaleToBase64(jpeg: ByteArray, sensorOrientation: Int): String? = try {
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(jpeg, NexusConfig.VISION_FRAME_WIDTH)
        }
        var bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, opts)
        if (bmp == null) {
            null
        } else {
            val target = NexusConfig.VISION_FRAME_WIDTH
            if (bmp.width > target) {
                val ratio = target.toFloat() / bmp.width
                val scaled = Bitmap.createScaledBitmap(
                    bmp, target, (bmp.height * ratio).toInt().coerceAtLeast(1), true
                )
                if (scaled != bmp) bmp.recycle()
                bmp = scaled
            }
            if (sensorOrientation % 360 != 0) {
                val m = Matrix().apply {
                    postRotate(sensorOrientation.toFloat())
                    postScale(-1f, 1f) // camera frontala este oglindita
                }
                val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
                if (rotated != bmp) bmp.recycle()
                bmp = rotated
            }
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, NexusConfig.VISION_JPEG_QUALITY, out)
            bmp.recycle()
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
    } catch (_: Throwable) {
        null
    }

    private fun sampleSizeFor(jpeg: ByteArray, targetWidth: Int): Int = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= targetWidth) sample *= 2
        sample
    } catch (_: Throwable) {
        1
    }
}
