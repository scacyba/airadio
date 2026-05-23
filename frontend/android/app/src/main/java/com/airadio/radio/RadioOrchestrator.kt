package com.airadio.radio

class RadioOrchestrator(
    private val youTubePlayer: YouTubeWebViewPlayer
) : YouTubeWebViewPlayer.Listener {

    private var currentTrackId: String? = null

    fun startFirstTrack(videoId: String, trackId: String) {
        currentTrackId = trackId
        youTubePlayer.initialize()
        youTubePlayer.play(videoId)
    }

    override fun onReady() = Unit

    override fun onStateChange(state: String) = Unit

    override fun onVideoEnded(trackId: String?) {
        // Week 1: hook point for /radio/session/{id}/next
    }

    override fun onError(code: String) {
        // Week 1: hook point for fallback/retry
    }
}
