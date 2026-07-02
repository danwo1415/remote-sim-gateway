package com.example.remotesimgateway.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import org.json.JSONObject

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        for (msg in messages) {
            val from = msg.displayOriginatingAddress ?: msg.originatingAddress ?: "unknown"
            val body = msg.displayMessageBody ?: msg.messageBody ?: ""
            val timestamp = msg.timestampMillis

            Log.i("SmsReceiver", "SMS from $from: $body")

            // V0.1: For simplicity this only logs locally.
            // Next step: publish to GatewayService WebSocket via an internal event bus or local broadcast.
            val payload = JSONObject()
                .put("from", from)
                .put("body", body)
                .put("timestamp", timestamp)

            Log.i("SmsReceiver", "incoming_sms payload: $payload")
        }
    }
}
