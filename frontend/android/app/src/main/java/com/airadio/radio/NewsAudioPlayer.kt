package com.airadio.radio

interface NewsAudioPlayer {
    fun play(audioUrl: String, onComplete: () -> Unit, onError: (String) -> Unit)
    fun stop()
}
