package com.airadio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AiradioTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF0F172A)) {
                    Week3MockScreen()
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
fun Week3MockScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("AI Radio - Week3 UI Mock", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1D4ED8)), shape = RoundedCornerShape(16.dp)) {
            Text(
                "90s Station   ▶ Playing",
                color = Color.White,
                modifier = Modifier.padding(16.dp),
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
        }

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937)), shape = RoundedCornerShape(16.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Now Playing", color = Color(0xFF93C5FD), fontSize = 18.sp)
                Text("Title: Sample Song", color = Color.White, fontSize = 18.sp)
                Text("Artist: Sample Artist", color = Color.White, fontSize = 18.sp)
                Text("State: PLAYING_TRACK", color = Color(0xFF86EFAC), fontSize = 16.sp)
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937)), shape = RoundedCornerShape(16.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Interlude News", color = Color(0xFFFCD34D), fontSize = 18.sp)
                Text("1990sを振り返るトピック", color = Color.White, fontSize = 18.sp)
                Text("ここで当時のニュースをひとつ...", color = Color(0xFFD1D5DB), fontSize = 16.sp)
                Text("State: PLAYING_NEWS / RECOVERING", color = Color(0xFFFCA5A5), fontSize = 16.sp)
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF374151)), shape = RoundedCornerShape(16.dp)) {
            Text(
                "Error handling: retry once, then continue",
                color = Color.White,
                modifier = Modifier.padding(16.dp),
                fontSize = 14.sp
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Button(
                onClick = {},
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB))
            ) { Text("STOP") }
            Spacer(modifier = Modifier.width(12.dp))
            Button(
                onClick = {},
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16A34A))
            ) { Text("NEXT") }
        }

        Text(
            "※ API/再生制御は未接続のため、この画面はMock UIです。",
            color = Color(0xFF9CA3AF),
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 8.dp)
        )
    }
}
