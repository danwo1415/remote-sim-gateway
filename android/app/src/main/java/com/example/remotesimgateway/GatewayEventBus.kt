package com.example.remotesimgateway

import android.util.Log
import com.example.remotesimgateway.net.GatewayWebSocketClient
import org.json.JSONObject

object GatewayEventBus {
    @Volatile
    private var wsClient: GatewayWebSocketClient? = null

    fun attach(client: GatewayWebSocketClient) {
        wsClient = client
        Log.i("GatewayEventBus", "WebSocket client attached")
    }

    fun detach(client: GatewayWebSocketClient) {
        if (wsClient === client) {
            wsClient = null
            Log.i("GatewayEventBus", "WebSocket client detached")
        }
    }

    fun sendIncomingSms(from: String, body: String, timestamp: Long): Boolean {
        val client = wsClient
        if (client == null) {
            Log.w("GatewayEventBus", "Cannot send incoming_sms: WebSocket client is null")
            return false
        }

        val payload = JSONObject()
            .put("from", from)
            .put("body", body)
            .put("timestamp", timestamp)

        return client.sendEvent("incoming_sms", payload)
    }
}
