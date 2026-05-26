package com.airadio.radio

class RadioOrchestrator(
    private val youTubePlayer: YouTubeWebViewPlayer,
    private val newsAudioPlayer: NewsAudioPlayer,
    private val radioApiClient: RadioApiClient
) : YouTubeWebViewPlayer.Listener {

    enum class PlaybackState {
        IDLE,
        MUSIC_LOADING,
        MUSIC_PLAYING,
        WAITING_NEXT_UNIT,
        NEWS_LOADING,
        NEWS_PLAYING,
        ERROR
    }

    private var state: PlaybackState = PlaybackState.IDLE
    private var sessionId: String? = null
    private var currentTrackId: String? = null
    private var pendingTrackVideoId: String? = null
    private var pendingTrackId: String? = null

    fun getState(): PlaybackState = state

    fun startSession(era: String) {
        state = PlaybackState.MUSIC_LOADING
        val created = radioApiClient.createSession(era)
        sessionId = created.sessionId
        currentTrackId = created.track.trackId

        youTubePlayer.initialize()
        youTubePlayer.play(created.track.videoId)
    }

    override fun onReady() = Unit

    override fun onStateChange(state: String) {
        this.state = when (state) {
            "PLAYING" -> PlaybackState.MUSIC_PLAYING
            "BUFFERING", "CUED", "UNSTARTED" -> PlaybackState.MUSIC_LOADING
            else -> this.state
        }
    }

    override fun onVideoEnded(trackId: String?) {
        val sid = sessionId ?: return
        val afterTrackId = trackId ?: currentTrackId ?: return
        state = PlaybackState.WAITING_NEXT_UNIT

        val nextUnit = try {
            radioApiClient.next(sid, afterTrackId)
        } catch (e: RadioApiException) {
            if (e.code == "SESSION_STATE_MISMATCH") {
                // Week3: 自動復旧（afterTrackIdを省略した再取得）
                radioApiClient.next(sid, null)
            } else {
                state = PlaybackState.ERROR
                return
            }
        }

        pendingTrackVideoId = nextUnit.track.videoId
        pendingTrackId = nextUnit.track.trackId
        currentTrackId = nextUnit.track.trackId
        state = PlaybackState.NEWS_LOADING

        newsAudioPlayer.play(
            nextUnit.news.audioUrl,
            onComplete = {
                state = PlaybackState.MUSIC_LOADING
                currentTrackId = pendingTrackId
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
                pendingTrackId = null
            },
            onError = {
                // Week3: 音声失敗時はニュースをスキップして次曲へ
                state = PlaybackState.MUSIC_LOADING
                currentTrackId = pendingTrackId
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
                pendingTrackId = null
            }
        )
        state = PlaybackState.NEWS_PLAYING
    }

    override fun onError(code: String) {
        state = PlaybackState.ERROR
    }
}
