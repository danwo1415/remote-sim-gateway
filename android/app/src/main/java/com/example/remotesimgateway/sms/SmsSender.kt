package com.example.remotesimgateway.sms

import android.content.Context
import android.telephony.SmsManager
import com.example.remotesimgateway.sim.SimProfileReporter

object SmsSender {
    data class Result(
        val ok: Boolean,
        val subscriptionId: Int?,
        val usedDefaultSim: Boolean,
        val error: String? = null
    )

    fun send(
        context: Context,
        to: String,
        text: String,
        subscriptionId: Int?,
        slotIndex: Int?
    ): Result {
        val resolvedSubscriptionId = resolveSubscriptionId(context, subscriptionId, slotIndex)

        if ((subscriptionId != null || slotIndex != null) && resolvedSubscriptionId == null) {
            return Result(
                ok = false,
                subscriptionId = null,
                usedDefaultSim = true,
                error = "subscription_not_available"
            )
        }

        val smsManager = if (resolvedSubscriptionId != null) {
            SmsManager.getSmsManagerForSubscriptionId(resolvedSubscriptionId)
        } else {
            context.getSystemService(SmsManager::class.java)
        }

        val parts = smsManager.divideMessage(text)
        smsManager.sendMultipartTextMessage(to, null, parts, null, null)

        return Result(
            ok = true,
            subscriptionId = resolvedSubscriptionId,
            usedDefaultSim = resolvedSubscriptionId == null
        )
    }

    private fun resolveSubscriptionId(
        context: Context,
        subscriptionId: Int?,
        slotIndex: Int?
    ): Int? {
        if (subscriptionId != null) {
            return if (SimProfileReporter.isActiveSubscription(context, subscriptionId)) {
                subscriptionId
            } else {
                null
            }
        }

        if (slotIndex != null) {
            return SimProfileReporter.findSubscriptionIdBySlotIndex(context, slotIndex)
        }

        return null
    }
}
