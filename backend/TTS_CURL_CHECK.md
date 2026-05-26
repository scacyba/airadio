# Gemini TTS base64返却チェック（WSL / curl）

この手順は、Gemini TTS API から **base64音声データ**（`inlineData.data`）が返ることを確認するための最小検証です。

## 0. 前提
- WSL上で `curl` と `jq` が使えること
- Gemini APIキーを取得済みであること

```bash
# 必要ならインストール
sudo apt-get update && sudo apt-get install -y curl jq
```

## 1. 環境変数を設定

```bash
export GEMINI_API_KEY='YOUR_GEMINI_API_KEY'
export GEMINI_TTS_MODEL='gemini-2.5-flash-preview-tts'
export GEMINI_TTS_VOICE='Kore'
```

## 2. リクエストJSONを作成

```bash
cat > /tmp/gemini_tts_request.json <<'JSON'
{
  "contents": [
    {
      "parts": [
        {
          "text": "テストです。AIラジオのニュース読み上げ音声を生成してください。"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "voiceConfig": {
        "prebuiltVoiceConfig": {
          "voiceName": "Kore"
        }
      }
    }
  }
}
JSON
```

## 3. curlでAPI実行し、レスポンスを保存

```bash
curl -sS -X POST \
  -H 'Content-Type: application/json' \
  "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}" \
  -d @/tmp/gemini_tts_request.json \
  > /tmp/gemini_tts_response.json
```

## 4. base64データ有無を確認

```bash
jq -r '.candidates[0].content.parts[] | select(.inlineData.data != null) | .inlineData.mimeType' /tmp/gemini_tts_response.json
jq -r '.candidates[0].content.parts[] | select(.inlineData.data != null) | .inlineData.data | length' /tmp/gemini_tts_response.json
```

- 1つ目のコマンドで `audio/*` 系の MIME type が表示される
- 2つ目のコマンドで `0` より大きい数値が表示される

## 5. base64をデコードしてファイル保存（任意）

```bash
jq -r '.candidates[0].content.parts[] | select(.inlineData.data != null) | .inlineData.data' /tmp/gemini_tts_response.json \
  | base64 -d > /tmp/gemini_tts_output.wav

file /tmp/gemini_tts_output.wav
```

> APIレスポンスの `mimeType` が `audio/L16` などの場合、拡張子は `.wav` でも中身がPCMのことがあります。

## 6. ワンライナー検証（成功/失敗のみ）

```bash
if jq -e '.candidates[0].content.parts[] | select(.inlineData.data != null) | .inlineData.data | length > 0' /tmp/gemini_tts_response.json >/dev/null; then
  echo 'OK: base64 audio payload detected'
else
  echo 'NG: base64 audio payload not found'
fi
```
