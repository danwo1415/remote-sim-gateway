package com.example.remotesimgateway.net

import android.content.Context
import android.util.Log
import com.example.remotesimgateway.phone.PhoneController
import com.example.remotesimgateway.sms.SmsSender
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class GatewayWebSocketClient(
    private val context: Context,
    private val serverUrl: String,
    private val deviceId: String,
    private val deviceKey: String
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null

    fun connect() {
        val request = Request.Builder()
            .url(serverUrl)
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Device-Key", deviceKey)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i("GatewayWS", "Connected")
                sendEvent("device_online", JSONObject().put("deviceId", deviceId))
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleCommand(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e("GatewayWS", "WebSocket failure", t)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i("GatewayWS", "Closed: $code $reason")
            }
        })
    }

    fun close() {
        webSocket?.close(1000, "Service stopped")
    }

    fun sendEvent(type: String, payload: JSONObject) {
        val body = JSONObject()
            .put("type", type)
            .put("payload", payload)
            .put("timestamp", System.currentTimeMillis())
        webSocket?.send(body.toString())
    }

    private fun handleCommand(raw: String) {
        try {
            val json = JSONObject(raw)
            val type = json.getString("type")
            val payload = json.optJSONObject("payload") ?: JSONObject()

            when (type) {
                "send_sms" -> {
                    val to = payload.getString("to")
                    val text = payload.getString("text")
                    SmsSender.send(context, to, text)
                    sendEvent("sms_send_submitted", JSONObject().put("to", to))
                }
                "dial_call" -> {
                    val number = payload.getString("number")
                    PhoneController.dial(context, number)
                    sendEvent("call_dial_submitted", JSONObject().put("number", number))
                }
                "hangup_call" -> {
                    PhoneController.hangup(context)
                    sendEvent("call_hangup_submitted", JSONObject())
                }
                "answer_call" -> {
                    PhoneController.answer(context)
                    sendEvent("call_answer_submitted", JSONObject())
                }
                else -> {
                    sendEvent("unknown_command", JSONObject().put("command", type))
                }
            }
        } catch (e: Exception) {
            Log.e("GatewayWS", "Failed to handle command", e)
            sendEvent("command_error", JSONObject().put("error", e.message))
        }
    }
}
