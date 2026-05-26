package com.airadio.radio

data class SessionTrack(
    val trackId: String,
    val videoId: String
)

data class CreatedSession(
    val sessionId: String,
    val track: SessionTrack
)

data class NewsUnit(
    val audioUrl: String
)

data class NextPlaybackUnit(
    val news: NewsUnit,
    val track: SessionTrack
)

class RadioApiException(
    val code: String,
    message: String
) : RuntimeException(message)

interface RadioApiClient {
    fun createSession(era: String): CreatedSession
    fun next(sessionId: String, afterTrackId: String? = null): NextPlaybackUnit
}
