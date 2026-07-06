package com.example.remotesimgateway

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

object GatewayServiceStarter {
    fun start(context: Context, serverUrl: String? = null): Boolean {
        val appContext = context.applicationContext
        val resolvedServerUrl = serverUrl
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: GatewaySettings.getServerUrl(appContext)

        if (!GatewaySettings.isUsableServerUrl(resolvedServerUrl)) {
            Log.w("GatewayStarter", "Gateway service not started: server URL is not configured")
            return false
        }

        GatewaySettings.saveServerUrl(appContext, resolvedServerUrl)

        val intent = Intent(appContext, GatewayService::class.java).apply {
            putExtra(GatewayService.EXTRA_SERVER_URL, resolvedServerUrl)
        }

        return try {
            ContextCompat.startForegroundService(appContext, intent)
            Log.i("GatewayStarter", "Gateway service start requested")
            true
        } catch (e: Exception) {
            Log.e("GatewayStarter", "Gateway service start was rejected by Android", e)
            false
        }
    }
}
