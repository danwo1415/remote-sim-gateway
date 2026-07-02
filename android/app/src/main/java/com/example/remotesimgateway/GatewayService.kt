package com.example.remotesimgateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.example.remotesimgateway.net.GatewayWebSocketClient
import com.example.remotesimgateway.security.DeviceIdentity

class GatewayService : Service() {
    private var wsClient: GatewayWebSocketClient? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(1, buildNotification("Gateway running"))

        val identity = DeviceIdentity.getOrCreate(this)
        wsClient = GatewayWebSocketClient(
            context = this,
            serverUrl = "wss://YOUR_DOMAIN_HERE/ws/device",
            deviceId = identity.deviceId,
            deviceKey = identity.deviceKey
        )
        wsClient?.connect()
    }

    override fun onDestroy() {
        wsClient?.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            "gateway",
            "Remote SIM Gateway",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(content: String): Notification {
        return Notification.Builder(this, "gateway")
            .setContentTitle("Remote SIM Gateway")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .build()
    }
}
