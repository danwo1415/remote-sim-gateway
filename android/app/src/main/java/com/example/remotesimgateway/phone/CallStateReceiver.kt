package com.example.remotesimgateway.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.util.Log
import com.example.remotesimgateway.GatewayEventBus
import com.example.remotesimgateway.sim.SimProfileReporter
import org.json.JSONObject
import java.time.Instant

class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
            ?: activeNumber
            ?: "unknown"
        val subscriptionId = readOptionalIntExtra(
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
        val effectiveSlotIndex = slotIndex
            ?: subscriptionId?.let { SimProfileReporter.slotIndexForSubscription(context, it) }
        val effectiveSubscriptionId = subscriptionId
            ?: effectiveSlotIndex?.let { SimProfileReporter.findSubscriptionIdBySlotIndex(context, it) }
            ?: SimProfileReporter.singleActiveSubscriptionId(context)

        Log.i(
            "CallState",
            "State $state number=$number subscriptionId=$effectiveSubscriptionId slotIndex=$effectiveSlotIndex extras=${describeExtras(intent)}"
        )

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                Log.i("CallState", "Incoming ringing: $number")
                activeNumber = number
                activeStartedAtMillis = System.currentTimeMillis()
                activeAnsweredAtMillis = null
                activeSubscriptionId = effectiveSubscriptionId
                activeSlotIndex = effectiveSlotIndex

                val payload = JSONObject()
                    .put("number", number)
                    .put("startedAt", iso(activeStartedAtMillis))

                if (effectiveSubscriptionId != null) {
                    payload.put("subscriptionId", effectiveSubscriptionId)
                    val carrierName = SimProfileReporter.carrierNameForSubscription(context, effectiveSubscriptionId)
                    if (carrierName.isNotBlank()) {
                        payload.put("carrierName", carrierName)
                    }
                    val simNumber = SimProfileReporter.phoneNumberForSubscription(context, effectiveSubscriptionId)
                    if (simNumber.isNotBlank()) {
                        payload.put("simNumber", simNumber)
                    }
                }

                if (effectiveSlotIndex != null) {
                    payload.put("slotIndex", effectiveSlotIndex)
                }

                GatewayEventBus.sendCallEvent(context, "incoming_call", payload)
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                Log.i("CallState", "Call active")
                if (activeStartedAtMillis == null) {
                    return
                }

                val answeredAt = System.currentTimeMillis()
                activeAnsweredAtMillis = answeredAt

                GatewayEventBus.sendCallEvent(
                    context,
                    "call_answered",
                    JSONObject()
                        .put("number", number)
                        .put("answeredAt", iso(answeredAt))
                        .putOptional("subscriptionId", activeSubscriptionId)
                        .putOptional("slotIndex", activeSlotIndex)
                )
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                Log.i("CallState", "Call idle")
                val startedAt = activeStartedAtMillis
                if (startedAt == null) {
                    activeNumber = null
                    activeAnsweredAtMillis = null
                    activeSubscriptionId = null
                    activeSlotIndex = null
                    return
                }

                val endedAt = System.currentTimeMillis()
                val answeredAt = activeAnsweredAtMillis
                val ringEndedAt = answeredAt ?: endedAt
                val ringDurationSeconds = ((ringEndedAt - startedAt).coerceAtLeast(0L) / 1000L).toInt()
                val status = if (answeredAt == null) "missed" else "answered"

                GatewayEventBus.sendCallEvent(
                    context,
                    "call_ended",
                    JSONObject()
                        .put("number", number)
                        .put("endedAt", iso(endedAt))
                        .put("status", status)
                        .put("ringDurationSeconds", ringDurationSeconds)
                        .putOptional("subscriptionId", activeSubscriptionId)
                        .putOptional("slotIndex", activeSlotIndex)
                )

                activeNumber = null
                activeStartedAtMillis = null
                activeAnsweredAtMillis = null
                activeSubscriptionId = null
                activeSlotIndex = null
            }
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

    private fun describeExtras(intent: Intent): String {
        val extras = intent.extras ?: return "{}"
        return extras.keySet().joinToString(prefix = "{", postfix = "}") { key ->
            val value = extras.get(key)
            val printable = when (value) {
                is IntArray -> "IntArray(${value.size})"
                is LongArray -> "LongArray(${value.size})"
                is ByteArray -> "ByteArray(${value.size})"
                is Array<*> -> "Array(${value.size})"
                else -> value?.toString()?.take(80) ?: "null"
            }
            "$key=$printable"
        }
    }

    private fun iso(value: Long?): String {
        return Instant.ofEpochMilli(value ?: System.currentTimeMillis()).toString()
    }

    private fun JSONObject.putOptional(name: String, value: Int?): JSONObject {
        if (value != null) {
            put(name, value)
        }

        return this
    }

    companion object {
        @Volatile
        private var activeNumber: String? = null

        @Volatile
        private var activeStartedAtMillis: Long? = null

        @Volatile
        private var activeAnsweredAtMillis: Long? = null

        @Volatile
        private var activeSubscriptionId: Int? = null

        @Volatile
        private var activeSlotIndex: Int? = null
    }
}
