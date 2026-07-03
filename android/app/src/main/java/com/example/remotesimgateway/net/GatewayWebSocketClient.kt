package com.example.remotesimgateway.net

import android.content.Context
import android.os.Handler
import android.os.Looper
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
    private val deviceKey: String,
    private val statusCallback: ((String) -> Unit)? = null
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null

    fun connect() {
        updateStatus("Connecting...\n$serverUrl")

        try {
            val request = Request.Builder()
                .url(serverUrl)
                .addHeader("X-Device-Id", deviceId)
                .addHeader("X-Device-Key", deviceKey)
                .build()

            webSocket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    Log.i("GatewayWS", "Connected")
                    updateStatus("Connected\n$serverUrl")
                    sendEvent("device_online", JSONObject().put("deviceId", deviceId))
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    Log.i("GatewayWS", "Message: $text")
                    handleCommand(text)
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    val code = response?.code
                    val message = response?.message
                    val errorText = buildString {
                        append("WebSocket failure\n")
                        append("URL: ").append(serverUrl).append("\n")
                        append("Error: ").append(t.javaClass.simpleName).append("\n")
                        append("Message: ").append(t.message ?: "no message").append("\n")
                        if (code != null) {
                            append("HTTP: ").append(code).append(" ").append(message ?: "").append("\n")
                        }
                    }

                    Log.e("GatewayWS", errorText, t)
                    updateStatus(errorText)
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    val text = "Closed\nCode: $code\nReason: $reason"
                    Log.i("GatewayWS", text)
                    updateStatus(text)
                }

                override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                    val text = "Closing\nCode: $code\nReason: $reason"
                    Log.i("GatewayWS", text)
                    updateStatus(text)
                    ws.close(code, reason)
                }
            })
        } catch (e: Exception) {
            val errorText = "Connect exception\n${e.javaClass.simpleName}\n${e.message ?: "no message"}"
            Log.e("GatewayWS", errorText, e)
            updateStatus(errorText)
        }
    }

    fun close() {
        updateStatus("Closing WebSocket")
        webSocket?.close(1000, "Service stopped")
        webSocket = null
    }

    fun sendEvent(type: String, payload: JSONObject): Boolean {
        val body = JSONObject()
            .put("type", type)
            .put("payload", payload)
            .put("timestamp", System.currentTimeMillis())

        val success = webSocket?.send(body.toString()) ?: false

        if (!success) {
            updateStatus("Send failed\n$type")
            Log.w("GatewayWS", "Send failed: $type")
        } else {
            Log.i("GatewayWS", "Sent event: $type")
        }

        return success
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

                "server_hello" -> {
                    updateStatus("Connected\nServer accepted device")
                }

                else -> {
                    sendEvent("unknown_command", JSONObject().put("command", type))
                }
            }
        } catch (e: Exception) {
            Log.e("GatewayWS", "Failed to handle command", e)
            updateStatus("Command error\n${e.javaClass.simpleName}\n${e.message ?: "no message"}")
            sendEvent("command_error", JSONObject().put("error", e.message))
        }
    }

    private fun updateStatus(message: String) {
        mainHandler.post {
            statusCallback?.invoke(message)
        }
    }
}
