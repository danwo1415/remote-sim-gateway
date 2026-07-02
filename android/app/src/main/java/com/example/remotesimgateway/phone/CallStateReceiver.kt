package com.example.remotesimgateway.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log

class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                Log.i("CallState", "Incoming ringing: $number")
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                Log.i("CallState", "Call active")
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                Log.i("CallState", "Call idle")
            }
        }
    }
}
