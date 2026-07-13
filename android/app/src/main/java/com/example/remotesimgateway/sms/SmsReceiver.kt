package com.example.remotesimgateway.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.util.Log
import com.example.remotesimgateway.GatewayEventBus
import com.example.remotesimgateway.sim.SimProfileReporter

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
        val subscriptionId = readOptionalIntExtra(
            intent,
            SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX,
            "subscription",
            "android.telephony.extra.SUBSCRIPTION_INDEX"
        )
        val slotIndex = readOptionalIntExtra(
            intent,
            "slot",
            "slotIndex",
            "simSlotIndex",
            "phone",
            "simId",
            "simSlot",
            "slotId",
            "android.telephony.extra.SLOT_INDEX"
        )
        val effectiveSubscriptionId = subscriptionId
            ?: slotIndex?.let { SimProfileReporter.findSubscriptionIdBySlotIndex(context, it) }
        val carrierName = SimProfileReporter.carrierNameForSubscription(context, effectiveSubscriptionId)
        val simNumber = SimProfileReporter.phoneNumberForSubscription(context, effectiveSubscriptionId)

        Log.i(
            "SmsReceiver",
            "Incoming SMS from $from subscriptionId=$effectiveSubscriptionId slotIndex=$slotIndex"
        )

        val sent = GatewayEventBus.sendIncomingSms(
            context = context,
            from = from,
            body = body,
            timestamp = timestamp,
            subscriptionId = effectiveSubscriptionId,
            slotIndex = slotIndex,
            carrierName = carrierName,
            simNumber = simNumber
        )

        if (!sent) {
            Log.w("SmsReceiver", "Incoming SMS was queued because gateway is offline")
        }
    }

    private fun readOptionalIntExtra(intent: Intent, vararg names: String): Int? {
        for (name in names) {
            if (!intent.hasExtra(name)) {
                continue
            }

            val value = intent.extras?.get(name)
            when (value) {
                is Int -> return value
                is Long -> return value.toInt()
                is String -> value.toIntOrNull()?.let { return it }
            }
        }

        return null
    }
}
