package com.example.remotesimgateway.sms

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

object IncomingSmsQueue {
    private const val PREFS_NAME = "remote_sim_gateway_sms_queue"
    private const val KEY_QUEUE = "queued_sms"
    private const val MAX_QUEUE_SIZE = 200

    @Synchronized
    fun enqueue(context: Context, from: String, body: String, timestamp: Long) {
        val payload = JSONObject()
            .put("from", from)
            .put("body", body)
            .put("timestamp", timestamp)
            .put("queuedAt", System.currentTimeMillis())

        enqueue(context, payload)
    }

    @Synchronized
    fun enqueue(context: Context, payload: JSONObject) {
        val queue = readQueue(context)
        val normalized = JSONObject(payload.toString())

        if (!normalized.has("queuedAt")) {
            normalized.put("queuedAt", System.currentTimeMillis())
        }

        queue.put(normalized)
        writeQueue(context, trimQueue(queue))
        Log.i("IncomingSmsQueue", "Queued incoming SMS. Queue size: ${queue.length()}")
    }

    @Synchronized
    fun flush(context: Context, sender: (JSONObject) -> Boolean): Int {
        val queue = readQueue(context)
        if (queue.length() == 0) return 0

        val remaining = JSONArray()
        var sentCount = 0

        for (index in 0 until queue.length()) {
            val payload = queue.optJSONObject(index)
            if (payload == null) {
                continue
            }

            if (sender(payload)) {
                sentCount += 1
            } else {
                remaining.put(payload)
            }
        }

        writeQueue(context, remaining)
        Log.i("IncomingSmsQueue", "Flushed $sentCount queued SMS. Remaining: ${remaining.length()}")
        return sentCount
    }

    private fun readQueue(context: Context): JSONArray {
        val raw = context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_QUEUE, "[]") ?: "[]"

        return try {
            JSONArray(raw)
        } catch (e: Exception) {
            Log.w("IncomingSmsQueue", "SMS queue was invalid; resetting", e)
            JSONArray()
        }
    }

    private fun writeQueue(context: Context, queue: JSONArray) {
        context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_QUEUE, queue.toString())
            .apply()
    }

    private fun trimQueue(queue: JSONArray): JSONArray {
        if (queue.length() <= MAX_QUEUE_SIZE) {
            return queue
        }

        val trimmed = JSONArray()
        val start = queue.length() - MAX_QUEUE_SIZE

        for (index in start until queue.length()) {
            queue.optJSONObject(index)?.let { trimmed.put(it) }
        }

        return trimmed
    }
}
