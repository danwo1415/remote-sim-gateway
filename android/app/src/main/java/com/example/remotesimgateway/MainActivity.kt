package com.example.remotesimgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.example.remotesimgateway.security.DeviceIdentity

class MainActivity : AppCompatActivity() {
    private val requiredPermissions = arrayOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.CALL_PHONE,
        Manifest.permission.ANSWER_PHONE_CALLS
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val identity = DeviceIdentity.getOrCreate(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(42, 52, 42, 42)
        }

        val title = TextView(this).apply {
            text = "Remote SIM Gateway"
            textSize = 24f
        }

        val status = TextView(this).apply {
            text = "Device ID:\n${identity.deviceId}\n\nStatus:\nReady to connect"
            textSize = 14f
            setPadding(0, 28, 0, 28)
        }

        val grantButton = Button(this).apply {
            text = "Grant Permissions"
            setOnClickListener { requestMissingPermissions() }
        }

        val startButton = Button(this).apply {
            text = "Start Gateway Service"
            setOnClickListener {
                ContextCompat.startForegroundService(
                    this@MainActivity,
                    Intent(this@MainActivity, GatewayService::class.java)
                )
                status.text = "Device ID:\n${identity.deviceId}\n\nStatus:\nGateway service started"
            }
        }

        root.addView(title)
        root.addView(status)
        root.addView(grantButton)
        root.addView(startButton)
        setContentView(root)

        requestMissingPermissions()
    }

    private fun requestMissingPermissions() {
        val missing = requiredPermissions.filter {
            ActivityCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1001)
        }
    }
}
