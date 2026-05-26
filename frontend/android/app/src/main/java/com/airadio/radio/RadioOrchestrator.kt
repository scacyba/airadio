package com.airadio.radio

class RadioOrchestrator(
    private val youTubePlayer: YouTubeWebViewPlayer,
    private val newsAudioPlayer: NewsAudioPlayer,
    private val radioApiClient: RadioApiClient
) : YouTubeWebViewPlayer.Listener {

    private enum class PlaybackState {
        IDLE,
        INITIALIZING,
        PLAYING_TRACK,
        FETCHING_NEXT,
        PLAYING_NEWS,
        RECOVERING,
        ERROR
    }

    private var sessionId: String? = null
    private var currentTrackId: String? = null
    private var pendingTrackVideoId: String? = null
    private var state: PlaybackState = PlaybackState.IDLE

    fun startSession(era: String) {
        val created = radioApiClient.createSession(era)
        sessionId = created.sessionId
        currentTrackId = created.track.trackId

        state = PlaybackState.INITIALIZING
        youTubePlayer.initialize()
        state = PlaybackState.PLAYING_TRACK
        youTubePlayer.play(created.track.videoId)
    }

    override fun onReady() = Unit

    override fun onStateChange(state: String) = Unit

    override fun onVideoEnded(trackId: String?) {
        if (state != PlaybackState.PLAYING_TRACK) return

        val sid = sessionId ?: return
        val afterTrackId = trackId ?: currentTrackId ?: return

        state = PlaybackState.FETCHING_NEXT

        val nextUnit = runCatching {
            radioApiClient.next(sid, afterTrackId)
        }.getOrElse {
            // Week3: SESSION_STATE_MISMATCHなどの状態不整合を想定し、直近のtrackIdで一度リトライ
            val fallbackTrackId = currentTrackId ?: afterTrackId
            state = PlaybackState.RECOVERING
            runCatching { radioApiClient.next(sid, fallbackTrackId) }
                .getOrElse {
                    state = PlaybackState.ERROR
                    return
                }
        }

        pendingTrackVideoId = nextUnit.track.videoId
        currentTrackId = nextUnit.track.trackId
        state = PlaybackState.PLAYING_NEWS

        newsAudioPlayer.play(
            nextUnit.news.audioUrl,
            onComplete = {
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
                state = PlaybackState.PLAYING_TRACK
            },
            onError = {
                // Week3: ニュース失敗時は継続性優先で次曲へ進む
                pendingTrackVideoId?.let { youTubePlayer.play(it) }
                pendingTrackVideoId = null
                state = PlaybackState.PLAYING_TRACK
            }
        )
    }

    override fun onError(code: String) {
        // Week3: YouTubeエラー時も停止回避。ニュース再生中以外は再生継続を試行。
        if (state == PlaybackState.PLAYING_NEWS) return
        state = PlaybackState.RECOVERING
        pendingTrackVideoId?.let {
            youTubePlayer.play(it)
            pendingTrackVideoId = null
            state = PlaybackState.PLAYING_TRACK
            return
        }

        state = PlaybackState.ERROR
    }
}
