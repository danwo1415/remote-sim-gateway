package com.example.remotesimgateway

import android.content.Context

object GatewaySettings {
    const val PREFS_NAME = "remote_sim_gateway_settings"
    const val KEY_SERVER_URL = "server_url"
    const val DEFAULT_SERVER_URL = "ws://YOUR_VPS_IP:3000/ws/device"

    fun getServerUrl(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: DEFAULT_SERVER_URL
    }

    fun saveServerUrl(context: Context, serverUrl: String) {
        context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, serverUrl.trim())
            .apply()
    }

    fun isUsableServerUrl(serverUrl: String): Boolean {
        val normalized = serverUrl.trim()
        return normalized.isNotEmpty() &&
            !normalized.contains("YOUR_", ignoreCase = true) &&
            !normalized.contains("your-vps", ignoreCase = true)
    }
}
