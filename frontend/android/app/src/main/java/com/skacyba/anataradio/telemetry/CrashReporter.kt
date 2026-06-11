package com.skacyba.anataradio.telemetry

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.crashlytics.FirebaseCrashlytics

object CrashReporter {
    private var initialized = false
    private var enabled = false

    fun initialize(context: Context, configured: Boolean) {
        if (initialized) return
        initialized = true
        enabled = configured && FirebaseApp.getApps(context).isNotEmpty()
        if (enabled) {
            FirebaseCrashlytics.getInstance().setCustomKey("crashlytics_configured", true)
            log("Crashlytics initialized")
        }
    }

    fun log(message: String) {
        if (!enabled) return
        FirebaseCrashlytics.getInstance().log(message)
    }

    fun setKey(key: String, value: String) {
        if (!enabled) return
        FirebaseCrashlytics.getInstance().setCustomKey(key, value)
    }

    fun setKey(key: String, value: Int) {
        if (!enabled) return
        FirebaseCrashlytics.getInstance().setCustomKey(key, value)
    }

    fun recordNonFatal(message: String, cause: Throwable? = null) {
        if (!enabled) return
        FirebaseCrashlytics.getInstance().recordException(
            cause ?: IllegalStateException(message)
        )
    }
}
