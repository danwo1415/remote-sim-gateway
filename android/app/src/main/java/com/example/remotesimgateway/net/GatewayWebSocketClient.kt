package com.example.remotesimgateway.net

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.remotesimgateway.phone.PhoneController
import com.example.remotesimgateway.sim.SimProfileReporter
import com.example.remotesimgateway.sms.IncomingSmsQueue
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
    private var shouldReconnect = true
    private var reconnectAttempts = 0
    private var reconnectScheduled = false
    private var isConnecting = false
    private var isConnected = false

    private val reconnectRunnable = Runnable {
        reconnectScheduled = false
        if (shouldReconnect && !isConnected) {
            connect()
        }
    }

    fun connect() {
        shouldReconnect = true
        if (isConnected || isConnecting) {
            return
        }

        mainHandler.removeCallbacks(reconnectRunnable)
        reconnectScheduled = false
        isConnecting = true
        updateStatus("Connecting...\n$serverUrl")

        try {
            val request = Request.Builder()
                .url(serverUrl)
                .addHeader("X-Device-Id", deviceId)
                .addHeader("X-Device-Key", deviceKey)
                .build()

            webSocket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    webSocket = ws
                    isConnecting = false
                    isConnected = true
                    reconnectAttempts = 0
                    Log.i("GatewayWS", "Connected")
                    updateStatus("Connected\n$serverUrl")
                    sendEvent("device_online", JSONObject().put("deviceId", deviceId))
                    sendSimProfiles()
                    flushQueuedSms()
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

                    isConnecting = false
                    isConnected = false
                    webSocket = null
                    Log.e("GatewayWS", errorText, t)
                    updateStatus(errorText)
                    scheduleReconnect()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    isConnecting = false
                    isConnected = false
                    webSocket = null
                    val text = "Closed\nCode: $code\nReason: $reason"
                    Log.i("GatewayWS", text)
                    updateStatus(text)
                    scheduleReconnect()
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
            isConnecting = false
            isConnected = false
            webSocket = null
            Log.e("GatewayWS", errorText, e)
            updateStatus(errorText)
            scheduleReconnect()
        }
    }

    fun close() {
        shouldReconnect = false
        isConnecting = false
        isConnected = false
        reconnectScheduled = false
        mainHandler.removeCallbacks(reconnectRunnable)
        updateStatus("Closing WebSocket")
        webSocket?.close(1000, "Service stopped")
        webSocket = null
    }

    fun sendEvent(type: String, payload: JSONObject): Boolean {
        val body = JSONObject()
            .put("type", type)
            .put("payload", payload)
            .put("timestamp", System.currentTimeMillis())

        val success = if (isConnected) {
            webSocket?.send(body.toString()) ?: false
        } else {
            false
        }

        if (!success) {
            updateStatus("Send failed\n$type")
            Log.w("GatewayWS", "Send failed: $type")
        } else {
            Log.i("GatewayWS", "Sent event: $type")
        }

        return success
    }

    fun flushQueuedSms() {
        val sentCount = IncomingSmsQueue.flush(context) { payload ->
            sendEvent("incoming_sms", payload)
        }

        if (sentCount > 0) {
            updateStatus("Connected\nFlushed $sentCount queued SMS")
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        if (reconnectScheduled) return

        reconnectAttempts += 1
        val delayMs = when {
            reconnectAttempts <= 5 -> 3_000L
            reconnectAttempts <= 20 -> 10_000L
            else -> 30_000L
        }

        updateStatus("Disconnected\nReconnect in ${delayMs / 1000}s\nAttempt: $reconnectAttempts")
        Log.i("GatewayWS", "Scheduling reconnect in $delayMs ms")

        reconnectScheduled = true
        mainHandler.postDelayed(reconnectRunnable, delayMs)
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
                    val profileId = payload.optString("profileId", "default")
                    val subscriptionId = payload.optionalInt("subscriptionId")
                    val slotIndex = payload.optionalInt("slotIndex")
                    val result = try {
                        SmsSender.send(context, to, text, subscriptionId, slotIndex)
                    } catch (error: Exception) {
                        sendEvent(
                            "sms_send_failed",
                            JSONObject()
                                .put("to", to)
                                .put("profileId", profileId)
                                .put("subscriptionId", subscriptionId)
                                .put("slotIndex", slotIndex)
                                .put("error", error.message ?: error.javaClass.simpleName)
                        )
                        return
                    }

                    if (result.ok) {
                        sendEvent(
                            "sms_send_submitted",
                            JSONObject()
                                .put("to", to)
                                .put("profileId", profileId)
                                .put("subscriptionId", result.subscriptionId)
                                .put("usedDefaultSim", result.usedDefaultSim)
                        )
                    } else {
                        sendEvent(
                            "sms_send_failed",
                            JSONObject()
                                .put("to", to)
                                .put("profileId", profileId)
                                .put("subscriptionId", subscriptionId)
                                .put("slotIndex", slotIndex)
                                .put("error", result.error ?: "send_failed")
                        )
                    }
                }

                "refresh_sim_profiles" -> {
                    sendSimProfiles()
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

    private fun sendSimProfiles() {
        sendEvent("sim_profiles", SimProfileReporter.buildPayload(context, deviceId))
    }

    private fun JSONObject.optionalInt(name: String): Int? {
        if (!has(name) || isNull(name)) {
            return null
        }

        val value = opt(name)
        return when (value) {
            is Number -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        }
    }
}
