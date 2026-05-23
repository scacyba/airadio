package com.airadio.radio

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient

class YouTubeWebViewPlayer(
    private val webView: WebView,
    private val listener: Listener
) {
    interface Listener {
        fun onReady()
        fun onStateChange(state: String)
        fun onVideoEnded(trackId: String?)
        fun onError(code: String)
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun initialize() {
        webView.settings.javaScriptEnabled = true
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(Bridge(listener), "AndroidBridge")
        webView.loadUrl("file:///android_asset/youtube_player.html")
    }

    fun play(videoId: String) {
        webView.evaluateJavascript("window.playVideoById('$videoId');", null)
    }

    fun pause() {
        webView.evaluateJavascript("window.pauseVideo();", null)
    }

    private class Bridge(private val listener: Listener) {
        @JavascriptInterface fun onReady() = listener.onReady()
        @JavascriptInterface fun onStateChange(state: String) = listener.onStateChange(state)
        @JavascriptInterface fun onVideoEnded(trackId: String?) = listener.onVideoEnded(trackId)
        @JavascriptInterface fun onError(code: String) = listener.onError(code)
    }
}
