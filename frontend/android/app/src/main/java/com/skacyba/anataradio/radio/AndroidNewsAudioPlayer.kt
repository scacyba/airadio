package com.skacyba.anataradio.radio

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

class AndroidNewsAudioPlayer(context: Context) : NewsAudioPlayer {
    private val player = ExoPlayer.Builder(context).build()
    private var activeListener: Player.Listener? = null

    override fun play(audioUrl: String, onComplete: () -> Unit, onError: (String) -> Unit) {
        activeListener?.let(player::removeListener)
        activeListener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    cleanupListener()
                    onComplete()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                cleanupListener()
                onError(error.message ?: "news audio playback failed")
            }
        }

        player.addListener(activeListener!!)
        player.setMediaItem(MediaItem.fromUri(audioUrl))
        player.prepare()
        player.playWhenReady = true
    }

    override fun stop() {
        player.stop()
        cleanupListener()
    }

    fun release() {
        cleanupListener()
        player.release()
    }

    private fun cleanupListener() {
        activeListener?.let(player::removeListener)
        activeListener = null
    }
}
