package com.example.remotesimgateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.example.remotesimgateway.net.GatewayWebSocketClient
import com.example.remotesimgateway.security.DeviceIdentity

class GatewayService : Service() {
    private var wsClient: GatewayWebSocketClient? = null
    private var currentServerUrl: String? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startAsForeground("Remote SIM Gateway running")
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i("GatewayService", "Service started")

        val identity = DeviceIdentity.getOrCreate(this)

        val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
            ?: GatewaySettings.getServerUrl(this)

        if (!GatewaySettings.isUsableServerUrl(serverUrl)) {
            updateNotification("Configure VPS WebSocket URL")
            Log.w("GatewayService", "Service start skipped: server URL is not configured")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        GatewaySettings.saveServerUrl(this, serverUrl)

        if (wsClient != null && currentServerUrl == serverUrl) {
            wsClient?.connect()
            wsClient?.flushQueuedSms()
            Log.i("GatewayService", "Service already running for $serverUrl")
            return START_STICKY
        }

        wsClient?.let {
            GatewayEventBus.detach(it)
            it.close()
        }

        val newClient = GatewayWebSocketClient(
            context = this,
            serverUrl = serverUrl,
            deviceId = identity.deviceId,
            deviceKey = identity.deviceKey
        ) { status ->
            Log.i("GatewayService", status)
            updateNotification(status.lines().firstOrNull() ?: "Remote SIM Gateway running")
        }

        wsClient = newClient
        currentServerUrl = serverUrl
        GatewayEventBus.attach(newClient)
        newClient.connect()

        Log.i("GatewayService", "Connecting to $serverUrl as ${identity.deviceId}")

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i("GatewayService", "Service destroyed")
        wsClient?.let {
            GatewayEventBus.detach(it)
            it.close()
        }
        wsClient = null
        currentServerUrl = null
        unregisterNetworkCallback()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Remote SIM Gateway",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps Remote SIM Gateway connected"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun startAsForeground(content: String) {
        val notification = buildNotification(content)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val foregroundServiceType =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                }

            startForeground(
                NOTIFICATION_ID,
                notification,
                foregroundServiceType
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun registerNetworkCallback() {
        val connectivityManager = getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i("GatewayService", "Network available; requesting WebSocket reconnect")
                wsClient?.connect()
            }
        }

        try {
            connectivityManager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: Exception) {
            Log.w("GatewayService", "Unable to register network callback", e)
        }
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        val connectivityManager = getSystemService(ConnectivityManager::class.java)

        try {
            connectivityManager.unregisterNetworkCallback(callback)
        } catch (e: Exception) {
            Log.w("GatewayService", "Unable to unregister network callback", e)
        } finally {
            networkCallback = null
        }
    }

    private fun updateNotification(content: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(content))
    }

    private fun buildNotification(content: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("Remote SIM Gateway")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"

        private const val CHANNEL_ID = "remote_sim_gateway"
        private const val NOTIFICATION_ID = 1001
    }
}
