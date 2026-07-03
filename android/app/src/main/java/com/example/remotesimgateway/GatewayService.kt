package com.example.remotesimgateway

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.example.remotesimgateway.net.GatewayWebSocketClient
import com.example.remotesimgateway.security.DeviceIdentity

class GatewayService : Service() {
    private var wsClient: GatewayWebSocketClient? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i("GatewayService", "Service started")

        val identity = DeviceIdentity.getOrCreate(this)
        val prefs = getSharedPreferences("remote_sim_gateway_settings", Context.MODE_PRIVATE)

        val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
            ?: prefs.getString("server_url", null)
            ?: "ws://YOUR_VPS_IP:3000/ws/device"

        wsClient?.close()

        wsClient = GatewayWebSocketClient(
            context = this,
            serverUrl = serverUrl,
            deviceId = identity.deviceId,
            deviceKey = identity.deviceKey
        ) { status ->
            Log.i("GatewayService", status)
        }

        wsClient?.connect()

        Log.i("GatewayService", "Connecting to $serverUrl as ${identity.deviceId}")

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i("GatewayService", "Service destroyed")
        wsClient?.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
    }
}
