package com.example.remotesimgateway.sim

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

object SimProfileReporter {
    fun buildPayload(context: Context, deviceId: String): JSONObject {
        val payload = JSONObject()
            .put("deviceId", deviceId)
            .put("profiles", JSONArray())

        if (!hasPhoneStatePermission(context)) {
            return payload.put("error", "READ_PHONE_STATE_NOT_GRANTED")
        }

        val profiles = JSONArray()
        val subscriptions = activeSubscriptions(context)
        val defaultSmsSubscriptionId = SubscriptionManager.getDefaultSmsSubscriptionId()
        val defaultVoiceSubscriptionId = SubscriptionManager.getDefaultVoiceSubscriptionId()

        for (subscription in subscriptions) {
            profiles.put(
                JSONObject()
                    .put("profileId", buildProfileId(deviceId, subscription.subscriptionId))
                    .put("subscriptionId", subscription.subscriptionId)
                    .put("iccId", safeIccId(subscription))
                    .put("carrierName", subscription.carrierName?.toString().orEmpty())
                    .put("displayName", displayName(subscription))
                    .put("country", subscription.countryIso?.uppercase(Locale.ROOT).orEmpty())
                    .put("phoneNumber", safePhoneNumber(subscription))
                    .put("slotIndex", subscription.simSlotIndex)
                    .put("isEnabled", true)
                    .put("isDefaultSms", subscription.subscriptionId == defaultSmsSubscriptionId)
                    .put("isDefaultVoice", subscription.subscriptionId == defaultVoiceSubscriptionId)
                    .put("lastSeen", System.currentTimeMillis())
            )
        }

        return payload.put("profiles", profiles)
    }

    fun findSubscriptionIdBySlotIndex(context: Context, slotIndex: Int): Int? {
        if (!hasPhoneStatePermission(context)) {
            return null
        }

        return activeSubscriptions(context)
            .firstOrNull { it.simSlotIndex == slotIndex }
            ?.subscriptionId
    }

    fun isActiveSubscription(context: Context, subscriptionId: Int): Boolean {
        if (!hasPhoneStatePermission(context)) {
            return false
        }

        return activeSubscriptions(context).any { it.subscriptionId == subscriptionId }
    }

    private fun activeSubscriptions(context: Context): List<SubscriptionInfo> {
        val manager = context.getSystemService(SubscriptionManager::class.java)

        return try {
            manager.activeSubscriptionInfoList.orEmpty()
        } catch (error: SecurityException) {
            emptyList()
        }
    }

    private fun hasPhoneStatePermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun buildProfileId(deviceId: String, subscriptionId: Int): String {
        return "$deviceId:subscription:$subscriptionId"
    }

    private fun displayName(subscription: SubscriptionInfo): String {
        val displayName = subscription.displayName?.toString()?.trim().orEmpty()
        if (displayName.isNotEmpty()) {
            return displayName
        }

        val carrierName = subscription.carrierName?.toString()?.trim().orEmpty()
        if (carrierName.isNotEmpty()) {
            return carrierName
        }

        return "Profile ${subscription.subscriptionId}"
    }

    private fun safeIccId(subscription: SubscriptionInfo): String {
        return try {
            subscription.iccId.orEmpty()
        } catch (error: SecurityException) {
            ""
        }
    }

    private fun safePhoneNumber(subscription: SubscriptionInfo): String {
        return try {
            subscription.number.orEmpty()
        } catch (error: SecurityException) {
            ""
        }
    }
}
