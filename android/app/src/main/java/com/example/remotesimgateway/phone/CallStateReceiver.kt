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
            "android.telephony.extra.SUBSCRIPTION_INDEX"
        )
        val slotIndex = readOptionalIntExtra(intent, "slot", "slotIndex", "simSlotIndex")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                Log.i("CallState", "Incoming ringing: $number")
                activeNumber = number
                activeStartedAtMillis = System.currentTimeMillis()
                activeAnsweredAtMillis = null

                val payload = JSONObject()
                    .put("number", number)
                    .put("startedAt", iso(activeStartedAtMillis))

                if (subscriptionId != null) {
                    payload.put("subscriptionId", subscriptionId)
                    val carrierName = SimProfileReporter.carrierNameForSubscription(context, subscriptionId)
                    if (carrierName.isNotBlank()) {
                        payload.put("carrierName", carrierName)
                    }
                }

                if (slotIndex != null) {
                    payload.put("slotIndex", slotIndex)
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
                )
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                Log.i("CallState", "Call idle")
                val startedAt = activeStartedAtMillis
                if (startedAt == null) {
                    activeNumber = null
                    activeAnsweredAtMillis = null
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
                )

                activeNumber = null
                activeStartedAtMillis = null
                activeAnsweredAtMillis = null
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

    private fun iso(value: Long?): String {
        return Instant.ofEpochMilli(value ?: System.currentTimeMillis()).toString()
    }

    companion object {
        @Volatile
        private var activeNumber: String? = null

        @Volatile
        private var activeStartedAtMillis: Long? = null

        @Volatile
        private var activeAnsweredAtMillis: Long? = null
    }
}
