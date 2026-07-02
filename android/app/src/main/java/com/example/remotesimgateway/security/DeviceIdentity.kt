package com.example.remotesimgateway.security

import android.content.Context
import java.security.SecureRandom
import java.util.UUID
import android.util.Base64

data class Identity(
    val deviceId: String,
    val deviceKey: String
)

object DeviceIdentity {
    private const val PREFS = "remote_sim_gateway_identity"
    private const val DEVICE_ID = "device_id"
    private const val DEVICE_KEY = "device_key"

    fun getOrCreate(context: Context): Identity {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var deviceId = prefs.getString(DEVICE_ID, null)
        var deviceKey = prefs.getString(DEVICE_KEY, null)

        if (deviceId == null || deviceKey == null) {
            deviceId = UUID.randomUUID().toString()
            deviceKey = generateKey()
            prefs.edit()
                .putString(DEVICE_ID, deviceId)
                .putString(DEVICE_KEY, deviceKey)
                .apply()
        }

        return Identity(deviceId, deviceKey)
    }

    private fun generateKey(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
