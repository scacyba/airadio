package com.skacyba.anataradio.radio

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import org.json.JSONObject

private const val NETWORK_TIMEOUT_MS = 15_000

data class SessionTrack(
    val trackId: String,
    val videoId: String,
    val title: String,
    val artist: String,
    val era: String
)

data class CreatedSession(
    val sessionId: String,
    val track: SessionTrack
)

data class NewsUnit(
    val newsId: String,
    val headline: String,
    val script: String,
    val audioUrl: String
)

data class NextPlaybackUnit(
    val news: NewsUnit,
    val track: SessionTrack
)

interface RadioApiClient {
    suspend fun createSession(era: String): CreatedSession
    suspend fun next(
        sessionId: String,
        afterTrackId: String,
        skipTrackId: String? = null,
        reason: String? = null
    ): NextPlaybackUnit
}

class HttpRadioApiClient(
    baseUrl: String
) : RadioApiClient {
    private val baseUrl = baseUrl.trimEnd('/')

    override suspend fun createSession(era: String): CreatedSession {
        val response = requestJson(
            method = "POST",
            path = "/radio/session/create",
            body = JSONObject()
                .put("era", era)
                .put("locale", "ja-JP")
                .toString()
        )

        return CreatedSession(
            sessionId = response.getString("sessionId"),
            track = response.getJSONObject("playback").getJSONObject("track").toSessionTrack()
        )
    }

    override suspend fun next(
        sessionId: String,
        afterTrackId: String,
        skipTrackId: String?,
        reason: String?
    ): NextPlaybackUnit {
        val query = mutableListOf("afterTrackId=${URLEncoder.encode(afterTrackId, "UTF-8")}")
        skipTrackId?.let { query += "skipTrackId=${URLEncoder.encode(it, "UTF-8")}" }
        reason?.let { query += "reason=${URLEncoder.encode(it, "UTF-8")}" }
        val response = requestJson(
            method = "GET",
            path = "/radio/session/$sessionId/next?${query.joinToString("&")}"
        )
        val playbackUnit = response.getJSONObject("playbackUnit")
        val news = playbackUnit.getJSONObject("news")
        val audio = news.getJSONObject("audio")

        return NextPlaybackUnit(
            news = NewsUnit(
                newsId = news.getString("newsId"),
                headline = news.getString("headline"),
                script = news.getString("script"),
                audioUrl = audio.getString("url")
            ),
            track = playbackUnit.getJSONObject("track").toSessionTrack()
        )
    }

    private fun requestJson(method: String, path: String, body: String? = null): JSONObject {
        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = NETWORK_TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }

        try {
            if (body != null) {
                connection.outputStream.use { output ->
                    output.write(body.toByteArray(Charsets.UTF_8))
                }
            }

            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }
            val responseText = stream.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).readText()
            }

            if (connection.responseCode !in 200..299) {
                val message = runCatching {
                    JSONObject(responseText).getJSONObject("error").getString("message")
                }.getOrDefault(responseText.take(160))
                error("Radio API error ${connection.responseCode}: $message")
            }

            return JSONObject(responseText)
        } finally {
            connection.disconnect()
        }
    }

    private fun JSONObject.toSessionTrack(): SessionTrack = SessionTrack(
        trackId = getString("trackId"),
        videoId = getString("videoId"),
        title = optString("title", "Unknown title"),
        artist = optString("artist", "Unknown artist"),
        era = optString("era", "")
    )
}
