package com.skacyba.anataradio.radio

interface NewsAudioPlayer {
    fun play(audioUrl: String, onComplete: () -> Unit, onError: (String) -> Unit)
    fun stop()
}
