package fr.echimine.live.core

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** Image prête à l'envoi : ses octets et leur type MIME. */
internal class ReducedImage(val bytes: ByteArray, val contentType: String)

/** Réduit une photo avant l'envoi ; injectable pour les tests (Seam 3). */
internal fun interface ImageReducer {
    /** Ramène le plus grand côté de [bytes] à [maxSide] px au plus ; `null` si l'image est illisible. */
    fun reduce(bytes: ByteArray, maxSide: Int): ReducedImage?
}

/** Réduction de production : décodage Android, JPEG en sortie. */
internal object AndroidImageReducer : ImageReducer {
    private const val JPEG_QUALITY = 85

    override fun reduce(bytes: ByteArray, maxSide: Int): ReducedImage? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        // Décodage sous-échantillonné d'abord, pour ne pas charger une photo de 48 Mpx en mémoire.
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null
        val longest = max(decoded.width, decoded.height)
        val matrix = Matrix()
        if (longest > maxSide) matrix.postScale(maxSide.toFloat() / longest, maxSide.toFloat() / longest)
        // Les photos de l'appareil sont souvent stockées couchées, avec l'orientation dans l'EXIF.
        val rotation = exifRotation(bytes)
        if (rotation != 0) matrix.postRotate(rotation.toFloat())
        val scaled = if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        if (scaled !== decoded) scaled.recycle()
        decoded.recycle()
        return ReducedImage(out.toByteArray(), "image/jpeg")
    }

    private fun exifRotation(bytes: ByteArray): Int = try {
        when (ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    } catch (_: Exception) {
        0
    }
}
