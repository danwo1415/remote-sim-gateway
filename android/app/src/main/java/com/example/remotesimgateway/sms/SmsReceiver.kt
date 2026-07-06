package com.example.remotesimgateway.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.example.remotesimgateway.GatewayEventBus

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isEmpty()) return

        val from = messages.firstOrNull()?.displayOriginatingAddress
            ?: messages.firstOrNull()?.originatingAddress
            ?: "unknown"

        val body = messages.joinToString(separator = "") {
            it.displayMessageBody ?: it.messageBody ?: ""
        }

        val timestamp = messages.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()

        Log.i("SmsReceiver", "Incoming SMS from $from: $body")

        val sent = GatewayEventBus.sendIncomingSms(
            context = context,
            from = from,
            body = body,
            timestamp = timestamp
        )

        if (!sent) {
            Log.w("SmsReceiver", "Incoming SMS was queued because gateway is offline")
        }
    }
}
