package com.example.remotesimgateway

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
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
import com.example.remotesimgateway.security.Identity

class MainActivity : AppCompatActivity() {
    private lateinit var statusText: TextView
    private lateinit var serverUrlInput: EditText
    private lateinit var identity: Identity

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        identity = DeviceIdentity.getOrCreate(this)
        val savedServerUrl = GatewaySettings.getServerUrl(this)

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
                if (requestMissingPermissions()) {
                    autoStartGateway()
                }
            }
        }

        val startButton = Button(this).apply {
            text = "Save & Start Gateway Service"
            setOnClickListener {
                val serverUrl = serverUrlInput.text.toString().trim()

                if (!GatewaySettings.isUsableServerUrl(serverUrl)) {
                    statusText.text = buildStatusText(
                        identity.deviceId,
                        identity.deviceKey,
                        "Enter your VPS WebSocket URL first"
                    )
                    return@setOnClickListener
                }

                val started = GatewayServiceStarter.start(this@MainActivity, serverUrl)

                statusText.text = buildStatusText(
                    identity.deviceId,
                    identity.deviceKey,
                    if (started) {
                        "Gateway service started\nServer: $serverUrl\n\nFuture app opens and phone boots will auto-connect."
                    } else {
                        "Gateway service was not started"
                    }
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

        if (requestMissingPermissions()) {
            autoStartGateway()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == REQUEST_PERMISSIONS && hasRequiredPermissions()) {
            autoStartGateway()
        }
    }

    private fun requestMissingPermissions(): Boolean {
        val missing = requiredPermissions().filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQUEST_PERMISSIONS)
            return false
        }

        return true
    }

    private fun hasRequiredPermissions(): Boolean {
        return requiredPermissions().all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requiredPermissions(): Array<String> {
        val permissions = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.ANSWER_PHONE_CALLS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }

        return permissions.toTypedArray()
    }

    private fun autoStartGateway() {
        val serverUrl = GatewaySettings.getServerUrl(this)

        if (!GatewaySettings.isUsableServerUrl(serverUrl)) {
            statusText.text = buildStatusText(
                identity.deviceId,
                identity.deviceKey,
                "Permissions granted\nEnter your VPS WebSocket URL and tap Save & Start once."
            )
            return
        }

        val started = GatewayServiceStarter.start(this, serverUrl)

        statusText.text = buildStatusText(
            identity.deviceId,
            identity.deviceKey,
            if (started) {
                "Auto-started gateway service\nServer: $serverUrl"
            } else {
                "Auto-start skipped\nEnter your VPS WebSocket URL and tap Save & Start once."
            }
        )
    }

    private fun buildStatusText(deviceId: String, deviceKey: String, status: String): String {
        return "Device ID:\n$deviceId\n\nDevice Key:\n$deviceKey\n\nStatus:\n$status"
    }

    companion object {
        private const val REQUEST_PERMISSIONS = 1001
    }
}
