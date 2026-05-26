package com.airadio.radio

class RadioOrchestrator(
    private val youTubePlayer: YouTubeWebViewPlayer,
    private val newsAudioPlayer: NewsAudioPlayer,
    private val radioApiClient: RadioApiClient
) : YouTubeWebViewPlayer.Listener {

    private var sessionId: String? = null
    private var currentTrackId: String? = null
    private var pendingTrackVideoId: String? = null

    fun startSession(era: String) {
        val created = radioApiClient.createSession(era)
        sessionId = created.sessionId
        currentTrackId = created.track.trackId

        youTubePlayer.initialize()
        youTubePlayer.play(created.track.videoId)
    }

    override fun onReady() = Unit

    override fun onStateChange(state: String) = Unit

    override fun onVideoEnded(trackId: String?) {
        val sid = sessionId ?: return
        val afterTrackId = trackId ?: currentTrackId ?: return

        val nextUnit = radioApiClient.next(sid, afterTrackId)
        pendingTrackVideoId = nextUnit.track.videoId
        currentTrackId = nextUnit.track.trackId

        newsAudioPlayer.play(
            nextUnit.news.audioUrl,
            onComplete = {
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
            },
            onError = {
                // Week2: 音声失敗時はニュースをスキップして次曲を継続再生
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
            }
        )
    }

    override fun onError(code: String) {
        // Week2: YouTube側失敗のハンドリングはWeek3でステートマシン化
    }
}
