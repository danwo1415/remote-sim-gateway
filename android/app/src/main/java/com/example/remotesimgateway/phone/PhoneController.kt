package com.example.remotesimgateway.phone

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.telecom.TelecomManager
import androidx.core.app.ActivityCompat

object PhoneController {
    fun dial(context: Context, number: String) {
        val intent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:$number")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            context.startActivity(intent)
        }
    }

    fun answer(context: Context) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS)
            != PackageManager.PERMISSION_GRANTED
        ) return

        val telecom = context.getSystemService(TelecomManager::class.java)
        telecom.acceptRingingCall()
    }

    fun hangup(context: Context) {
        // Android public APIs for hanging up are limited and device/version dependent.
        // For V0.1 this is a placeholder. Later versions may use TelecomManager on supported
        // Android versions, AccessibilityService, or device-owner mode depending on target device.
    }
}
