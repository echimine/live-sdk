package fr.echimine.live.sample

import android.util.Base64
import org.json.JSONObject
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Signe un Jeton de Participant sur le téléphone, avec le secret **de test** de l'App membre
 * `demo-android`. Une vraie App membre ne fait jamais ça : son backend signe le jeton
 * (`POST /live/participant-token`, voir `examples/participant-token`) et le secret
 * ne quitte jamais le serveur.
 */
internal object DemoParticipantToken {
    fun sign(appId: String, secret: String, userId: String, name: String): String {
        val now = System.currentTimeMillis() / 1000
        val header = JSONObject().put("alg", "HS256").put("typ", "JWT")
        val claims = JSONObject()
            .put("iss", appId)
            .put("sub", userId)
            .put("name", name)
            .put("iat", now)
            .put("exp", now + 5 * 60)
        val unsigned = "${header.base64Url()}.${claims.base64Url()}"
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(secret.toByteArray(), "HmacSHA256")) }
        return "$unsigned.${mac.doFinal(unsigned.toByteArray()).base64Url()}"
    }

    private fun JSONObject.base64Url() = toString().toByteArray().base64Url()

    private fun ByteArray.base64Url() = Base64.encodeToString(this, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
