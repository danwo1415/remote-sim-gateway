package com.example.remotesimgateway.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsMessage
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
        val intentSubscriptionId = readOptionalIntExtra(
            intent,
            SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX,
            "subscription",
            "subscriptionId",
            "subscription_id",
            "subId",
            "sub_id",
            "simSubscriptionId",
            "android.telephony.extra.SUBSCRIPTION_INDEX",
            "android.telephony.extra.SUBSCRIPTION_ID"
        )
        val messageSubscriptionId = readMessageSubscriptionId(messages)
        val slotIndex = readOptionalIntExtra(
            intent,
            "slot",
            "slotIndex",
            "slotIdx",
            "slot_index",
            "simSlotIndex",
            "sim_slot_index",
            "phone",
            "phoneId",
            "phone_id",
            "simId",
            "simSlot",
            "slotId",
            "android.telephony.extra.SLOT_INDEX",
            "android.telephony.extra.PHONE_ID"
        )
        val effectiveSubscriptionId = intentSubscriptionId
            ?: messageSubscriptionId
            ?: slotIndex?.let { SimProfileReporter.findSubscriptionIdBySlotIndex(context, it) }
            ?: SimProfileReporter.singleActiveSubscriptionId(context)
        val effectiveSlotIndex = slotIndex
            ?: SimProfileReporter.slotIndexForSubscription(context, effectiveSubscriptionId)
        val carrierName = SimProfileReporter.carrierNameForSubscription(context, effectiveSubscriptionId)
        val simNumber = SimProfileReporter.phoneNumberForSubscription(context, effectiveSubscriptionId)

        Log.i(
            "SmsReceiver",
            "Incoming SMS from $from subscriptionId=$effectiveSubscriptionId slotIndex=$effectiveSlotIndex extras=${describeExtras(intent)}"
        )

        val sent = GatewayEventBus.sendIncomingSms(
            context = context,
            from = from,
            body = body,
            timestamp = timestamp,
            subscriptionId = effectiveSubscriptionId,
            slotIndex = effectiveSlotIndex,
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
            normalizeInt(value)?.let { return it }
        }

        return null
    }

    private fun readMessageSubscriptionId(messages: Array<SmsMessage>): Int? {
        val methodNames = listOf("getSubscriptionId", "getSubId")

        for (message in messages) {
            for (methodName in methodNames) {
                val value = try {
                    message.javaClass.methods
                        .firstOrNull { it.name == methodName && it.parameterTypes.isEmpty() }
                        ?.invoke(message)
                } catch (error: ReflectiveOperationException) {
                    null
                } catch (error: SecurityException) {
                    null
                }

                normalizeInt(value)?.let { return it }
            }
        }

        return null
    }

    private fun normalizeInt(value: Any?): Int? {
        return when (value) {
            is Int -> value
            is Long -> value.toInt()
            is Short -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        }
    }

    private fun describeExtras(intent: Intent): String {
        val extras = intent.extras ?: return "none"
        return extras.keySet().sorted().joinToString(separator = ",") { key ->
            "$key=${formatExtraValue(extras.get(key))}"
        }
    }

    private fun formatExtraValue(value: Any?): String {
        return when (value) {
            null -> "null"
            is Array<*> -> "Array(${value.size})"
            is ByteArray -> "ByteArray(${value.size})"
            is IntArray -> "IntArray(${value.size})"
            is LongArray -> "LongArray(${value.size})"
            else -> value.toString().take(80)
        }
    }
}