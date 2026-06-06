package com.skacyba.anataradio

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds
import com.skacyba.anataradio.radio.AndroidNewsAudioPlayer
import com.skacyba.anataradio.radio.HttpRadioApiClient
import com.skacyba.anataradio.radio.RadioOrchestrator
import com.skacyba.anataradio.radio.YouTubeWebViewPlayer

private val EraOptions = listOf("1960s", "1970s", "1980s", "1990s")

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MobileAds.initialize(this)
        setContent {
            AiradioTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF0F172A)) {
                    RadioScreen()
                }
            }
        }
    }
}

@Composable
fun AiradioTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}

@Composable
fun RadioScreen() {
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    val webView = remember { WebView(context) }
    var uiState by remember { mutableStateOf(RadioOrchestrator.RadioUiState()) }

    val newsAudioPlayer = remember { AndroidNewsAudioPlayer(context.applicationContext) }
    val youTubePlayer = remember { YouTubeWebViewPlayer(webView) }
    val orchestrator = remember {
        RadioOrchestrator(
            youTubePlayer = youTubePlayer,
            newsAudioPlayer = newsAudioPlayer,
            radioApiClient = HttpRadioApiClient(BuildConfig.RADIO_API_BASE_URL),
            scope = coroutineScope,
            onUiStateChanged = { uiState = it }
        ).also { youTubePlayer.listener = it }
    }

    DisposableEffect(Unit) {
        onDispose {
            newsAudioPlayer.release()
            youTubePlayer.destroy()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("AI Radio", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        AdMobBanner(
            adUnitId = BuildConfig.ADMOB_BANNER_AD_UNIT_ID,
            modifier = Modifier.fillMaxWidth()
        )

        EraSelector(
            selectedEra = uiState.selectedEra,
            onEraSelected = orchestrator::startSession
        )

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)), shape = RoundedCornerShape(16.dp)) {
            AndroidView(
                factory = { webView },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .padding(8.dp)
            )
        }

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937)), shape = RoundedCornerShape(16.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Now Playing", color = Color(0xFF93C5FD), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Era: ${uiState.selectedEra}", color = Color.White, fontSize = 16.sp)
                Text("Title: ${uiState.nowPlaying?.title ?: "-"}", color = Color.White, fontSize = 16.sp)
                Text("Artist: ${uiState.nowPlaying?.artist ?: "-"}", color = Color.White, fontSize = 16.sp)
                Text("State: ${uiState.playbackState}", color = Color(0xFF86EFAC), fontSize = 14.sp)
                Text(uiState.statusMessage, color = Color(0xFFD1D5DB), fontSize = 14.sp)
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937)), shape = RoundedCornerShape(16.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Interlude News TTS", color = Color(0xFFFCD34D), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(uiState.newsHeadline ?: "曲間で年代ニュースをTTS再生します。", color = Color.White, fontSize = 16.sp)
                Text(uiState.newsScript ?: "最初の1曲が終わると、Backendの /next からニュース音声URLを取得してExoPlayerで再生します。", color = Color(0xFFD1D5DB), fontSize = 14.sp)
            }
        }

        uiState.errorMessage?.let { message ->
            Text("Error: $message", color = Color(0xFFFCA5A5), fontSize = 13.sp)
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Button(
                onClick = orchestrator::stop,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569))
            ) { Text("STOP") }
            Spacer(modifier = Modifier.width(12.dp))
            Button(
                onClick = orchestrator::playNext,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16A34A))
            ) { Text("NEWS / NEXT") }
        }
    }
}

@Composable
private fun AdMobBanner(adUnitId: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val adView = remember(adUnitId) {
        AdView(context).apply {
            setAdSize(AdSize.BANNER)
            this.adUnitId = adUnitId
            loadAd(AdRequest.Builder().build())
        }
    }

    DisposableEffect(adView) {
        onDispose { adView.destroy() }
    }

    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)), shape = RoundedCornerShape(12.dp)) {
        Box(
            modifier = modifier
                .height(66.dp)
                .padding(8.dp),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(
                factory = { adView },
                modifier = Modifier
                    .width(320.dp)
                    .height(50.dp)
            )
        }
    }
}

@Composable
private fun EraSelector(selectedEra: String, onEraSelected: (String) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        EraOptions.forEach { era ->
            Button(
                onClick = { onEraSelected(era) },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (era == selectedEra) Color(0xFF2563EB) else Color(0xFF334155)
                )
            ) {
                Text(era)
            }
        }
    }
}
