package com.example.remotesimgateway

import android.content.Context
import android.util.Log
import com.example.remotesimgateway.net.GatewayWebSocketClient
import com.example.remotesimgateway.sms.IncomingSmsQueue
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

    fun sendIncomingSms(context: Context, from: String, body: String, timestamp: Long): Boolean {
        val appContext = context.applicationContext
        val client = wsClient
        val payload = JSONObject()
            .put("from", from)
            .put("body", body)
            .put("timestamp", timestamp)

        if (client?.sendEvent("incoming_sms", payload) == true) {
            return true
        }

        IncomingSmsQueue.enqueue(appContext, payload)
        GatewayServiceStarter.start(appContext)
        Log.w("GatewayEventBus", "incoming_sms queued because gateway is offline")
        return false
    }

    fun sendCallEvent(context: Context, type: String, payload: JSONObject): Boolean {
        val appContext = context.applicationContext
        val client = wsClient

        if (client?.sendEvent(type, payload) == true) {
            return true
        }

        GatewayServiceStarter.start(appContext)
        Log.w("GatewayEventBus", "$type not sent because gateway is offline")
        return false
    }
}
