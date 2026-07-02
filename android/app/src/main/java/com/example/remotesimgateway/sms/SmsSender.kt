package com.example.remotesimgateway.sms

import android.content.Context
import android.telephony.SmsManager

object SmsSender {
    fun send(context: Context, to: String, text: String) {
        val smsManager = context.getSystemService(SmsManager::class.java)
        val parts = smsManager.divideMessage(text)
        smsManager.sendMultipartTextMessage(to, null, parts, null, null)
    }
}
