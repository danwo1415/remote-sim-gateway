package com.example.remotesimgateway

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.example.remotesimgateway.net.GatewayWebSocketClient
import com.example.remotesimgateway.security.DeviceIdentity

class GatewayService : Service() {
    private var wsClient: GatewayWebSocketClient? = null

    override fun onCreate() {
        super.onCreate()

        Log.i("GatewayService", "Service created")

        val identity = DeviceIdentity.getOrCreate(this)

        wsClient = GatewayWebSocketClient(
            context = this,
            serverUrl = "wss://YOUR_DOMAIN_HERE/ws/device",
            deviceId = identity.deviceId,
            deviceKey = identity.deviceKey
        )

        wsClient?.connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i("GatewayService", "Service started")
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i("GatewayService", "Service destroyed")
        wsClient?.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
