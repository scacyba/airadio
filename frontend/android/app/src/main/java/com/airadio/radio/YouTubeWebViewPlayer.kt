package com.airadio.radio

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient

class YouTubeWebViewPlayer(
    private val webView: WebView
) {
    interface Listener {
        fun onReady()
        fun onStateChange(state: String)
        fun onVideoEnded(trackId: String?)
        fun onError(code: String)
    }

    var listener: Listener? = null
    private var initialized = false
    private var ready = false
    private var pendingVideoId: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun initialize() {
        if (initialized) return
        initialized = true
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(Bridge(this), "AndroidBridge")
        webView.loadUrl("file:///android_asset/youtube_player.html")
    }

    fun play(videoId: String) {
        pendingVideoId = videoId
        if (!ready) return
        webView.post {
            val escapedVideoId = videoId.replace("\\", "\\\\").replace("'", "\\'")
            webView.evaluateJavascript("window.playVideoById('$escapedVideoId');", null)
            pendingVideoId = null
        }
    }

    fun pause() {
        webView.post { webView.evaluateJavascript("window.pauseVideo();", null) }
    }

    fun destroy() {
        ready = false
        initialized = false
        pendingVideoId = null
        webView.destroy()
    }

    private fun handleReady() {
        ready = true
        listener?.onReady()
        pendingVideoId?.let(::play)
    }

    private class Bridge(private val player: YouTubeWebViewPlayer) {
        @JavascriptInterface
        fun onReady() = player.webView.post { player.handleReady() }

        @JavascriptInterface
        fun onStateChange(state: String) = player.webView.post { player.listener?.onStateChange(state) }

        @JavascriptInterface
        fun onVideoEnded(trackId: String?) = player.webView.post { player.listener?.onVideoEnded(trackId) }

        @JavascriptInterface
        fun onError(code: String) = player.webView.post { player.listener?.onError(code) }
    }
}
