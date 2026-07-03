package com.example.remotesimgateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
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

    private lateinit var statusText: TextView
    private lateinit var serverUrlInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val identity = DeviceIdentity.getOrCreate(this)
        val prefs = getSharedPreferences("remote_sim_gateway_settings", Context.MODE_PRIVATE)
        val savedServerUrl = prefs.getString(
            "server_url",
            "ws://YOUR_VPS_IP:3000/ws/device"
        ) ?: "ws://YOUR_VPS_IP:3000/ws/device"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(42, 52, 42, 42)
        }

        val title = TextView(this).apply {
            text = "Remote SIM Gateway"
            textSize = 24f
        }

        statusText = TextView(this).apply {
            text = buildStatusText(identity.deviceId, identity.deviceKey, "Ready")
            textSize = 14f
            setPadding(0, 28, 0, 20)
        }

        val serverLabel = TextView(this).apply {
            text = "Server WebSocket URL"
            textSize = 14f
        }

        serverUrlInput = EditText(this).apply {
            setText(savedServerUrl)
            hint = "ws://your-vps-ip:3000/ws/device"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }

        val grantButton = Button(this).apply {
            text = "Grant Permissions"
            setOnClickListener {
                requestMissingPermissions(identity)
            }
        }

        val startButton = Button(this).apply {
            text = "Start Gateway Service"
            setOnClickListener {
                val serverUrl = serverUrlInput.text.toString().trim()

                if (serverUrl.isEmpty()) {
                    statusText.text = buildStatusText(
                        identity.deviceId,
                        identity.deviceKey,
                        "Server URL is empty"
                    )
                    return@setOnClickListener
                }

                prefs.edit().putString("server_url", serverUrl).apply()

                val intent = Intent(this@MainActivity, GatewayService::class.java).apply {
                    putExtra(GatewayService.EXTRA_SERVER_URL, serverUrl)
                }

                startService(intent)

                statusText.text = buildStatusText(
                    identity.deviceId,
                    identity.deviceKey,
                    "Gateway service started\nServer: $serverUrl\n\nCheck /api/device/status on VPS."
                )
            }
        }

        root.addView(title)
        root.addView(statusText)
        root.addView(serverLabel)
        root.addView(serverUrlInput)
        root.addView(grantButton)
        root.addView(startButton)

        setContentView(root)

        requestMissingPermissions(identity)
    }

    private fun requestMissingPermissions(identity: com.example.remotesimgateway.security.Identity) {
        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1001)
        } else {
            statusText.text = buildStatusText(
                identity.deviceId,
                identity.deviceKey,
                "Permissions granted"
            )
        }
    }

    private fun buildStatusText(deviceId: String, deviceKey: String, status: String): String {
        return "Device ID:\n$deviceId\n\nDevice Key:\n$deviceKey\n\nStatus:\n$status"
    }
}
