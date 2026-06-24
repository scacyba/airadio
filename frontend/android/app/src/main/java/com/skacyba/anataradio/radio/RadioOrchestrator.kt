package com.skacyba.anataradio.radio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class RadioOrchestrator(
    private val youTubePlayer: YouTubeWebViewPlayer,
    private val newsAudioPlayer: NewsAudioPlayer,
    private val radioApiClient: RadioApiClient,
    private val scope: CoroutineScope,
    private val onUiStateChanged: (RadioUiState) -> Unit
) : YouTubeWebViewPlayer.Listener {

    enum class PlaybackState {
        IDLE,
        INITIALIZING,
        PLAYING_TRACK,
        FETCHING_NEXT,
        PLAYING_NEWS,
        RECOVERING,
        ERROR
    }

    data class RadioUiState(
        val selectedEra: String = "1990s",
        val playbackState: PlaybackState = PlaybackState.IDLE,
        val nowPlaying: SessionTrack? = null,
        val newsHeadline: String? = null,
        val newsScript: String? = null,
        val statusMessage: String = "年代を選択してください。",
        val errorMessage: String? = null,
        val familyProfile: FamilyProfile = FamilyProfile()
    )

    private var uiState = RadioUiState()
    private var sessionId: String? = null
    private var currentTrack: SessionTrack? = null
    private var pendingTrack: SessionTrack? = null
    private var state: PlaybackState = PlaybackState.IDLE
    private var consecutiveYouTubeErrors = 0

    fun startSession(era: String) {
        newsAudioPlayer.stop()
        pendingTrack = null
        consecutiveYouTubeErrors = 0
        setState(
            uiState.copy(
                selectedEra = era,
                playbackState = PlaybackState.INITIALIZING,
                nowPlaying = null,
                newsHeadline = null,
                newsScript = null,
                statusMessage = "${era} stationを準備中...",
                errorMessage = null
            )
        )
        state = PlaybackState.INITIALIZING
        youTubePlayer.initialize()

        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { radioApiClient.createSession(era) }
            }.onSuccess { created ->
                sessionId = created.sessionId
                currentTrack = created.track
                state = PlaybackState.PLAYING_TRACK
                setState(
                    uiState.copy(
                        playbackState = PlaybackState.PLAYING_TRACK,
                        nowPlaying = created.track,
                        statusMessage = "${created.track.title} を再生しています。",
                        errorMessage = null
                    )
                )
                youTubePlayer.play(created.track.videoId)
            }.onFailure { throwable ->
                state = PlaybackState.ERROR
                setState(
                    uiState.copy(
                        playbackState = PlaybackState.ERROR,
                        statusMessage = "セッション作成に失敗しました。",
                        errorMessage = throwable.message
                    )
                )
            }
        }
    }

    fun stop() {
        youTubePlayer.pause()
        newsAudioPlayer.stop()
        state = PlaybackState.IDLE
        setState(uiState.copy(playbackState = PlaybackState.IDLE, statusMessage = "停止しました。"))
    }

    fun updateFamilyProfile(familyProfile: FamilyProfile) {
        setState(uiState.copy(familyProfile = familyProfile))
    }

    fun playNext() {
        if (state == PlaybackState.PLAYING_NEWS || state == PlaybackState.FETCHING_NEXT) return
        fetchNextAndPlayNews()
    }

    override fun onReady() {
        setState(uiState.copy(statusMessage = "YouTubeプレイヤーの準備ができました。"))
    }

    override fun onStateChange(state: String) = Unit

    override fun onVideoEnded(trackId: String?) {
        if (state != PlaybackState.PLAYING_TRACK) return
        consecutiveYouTubeErrors = 0
        fetchNextAndPlayNews()
    }

    override fun onError(code: String) {
        if (state == PlaybackState.PLAYING_NEWS || state == PlaybackState.FETCHING_NEXT) return
        val failedTrack = currentTrack
        if (failedTrack == null || consecutiveYouTubeErrors >= MAX_CONSECUTIVE_YOUTUBE_ERRORS) {
            state = PlaybackState.ERROR
            setState(uiState.copy(playbackState = PlaybackState.ERROR, errorMessage = "YouTube error: $code"))
            return
        }

        consecutiveYouTubeErrors += 1
        fetchNextAndPlayNews(skipTrackId = failedTrack.trackId, reason = "youtube_error")
    }

    private fun fetchNextAndPlayNews(skipTrackId: String? = null, reason: String? = null) {
        val sid = sessionId ?: return
        val afterTrackId = currentTrack?.trackId ?: return
        val clientRequestId = UUID.randomUUID().toString()
        state = PlaybackState.FETCHING_NEXT
        val loadingMessage = if (reason == "youtube_error") "再生できない動画をスキップしています..." else "次の曲とニュースを取得中..."
        setState(uiState.copy(playbackState = PlaybackState.FETCHING_NEXT, statusMessage = loadingMessage))

        scope.launch {
            val nextUnit = runCatching {
                withContext(Dispatchers.IO) { radioApiClient.next(sid, afterTrackId, clientRequestId, skipTrackId, reason, uiState.familyProfile) }
            }.getOrElse { firstError ->
                state = PlaybackState.RECOVERING
                setState(uiState.copy(playbackState = PlaybackState.RECOVERING, statusMessage = "再同期しています..."))
                runCatching {
                    withContext(Dispatchers.IO) { radioApiClient.next(sid, currentTrack?.trackId ?: afterTrackId, clientRequestId, skipTrackId, reason, uiState.familyProfile) }
                }.getOrElse { secondError ->
                    state = PlaybackState.ERROR
                    setState(
                        uiState.copy(
                            playbackState = PlaybackState.ERROR,
                            statusMessage = "次の再生単位の取得に失敗しました。",
                            errorMessage = secondError.message ?: firstError.message
                        )
                    )
                    return@launch
                }
            }

            pendingTrack = nextUnit.track
            currentTrack = nextUnit.track
            state = PlaybackState.PLAYING_NEWS
            setState(
                uiState.copy(
                    playbackState = PlaybackState.PLAYING_NEWS,
                    nowPlaying = nextUnit.track,
                    newsHeadline = nextUnit.news.headline,
                    newsScript = nextUnit.news.script,
                    statusMessage = "ニュースTTSを再生しています。",
                    errorMessage = null
                )
            )

            newsAudioPlayer.play(
                nextUnit.news.audioUrl,
                onComplete = { playPendingTrack() },
                onError = { message ->
                    setState(uiState.copy(statusMessage = "ニュース音声をスキップします。", errorMessage = message))
                    playPendingTrack()
                }
            )
        }
    }

    private fun playPendingTrack() {
        val track = pendingTrack ?: return
        pendingTrack = null
        state = PlaybackState.PLAYING_TRACK
        setState(
            uiState.copy(
                playbackState = PlaybackState.PLAYING_TRACK,
                nowPlaying = track,
                statusMessage = "${track.title} を再生しています。"
            )
        )
        youTubePlayer.play(track.videoId)
    }

    private fun setState(nextState: RadioUiState) {
        uiState = nextState
        onUiStateChanged(nextState)
    }
}

private const val MAX_CONSECUTIVE_YOUTUBE_ERRORS = 3
