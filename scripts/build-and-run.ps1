Write-Host "🔧 DeepSeek Automation API - Build & Run Script" -ForegroundColor Green

try { node --version } catch { Write-Host "❌ Node.js not found" -ForegroundColor Red; exit 1 }
Write-Host "✅ Node.js $(node -v)" -ForegroundColor Green

Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "❌ npm install failed" -ForegroundColor Red; exit 1 }

Write-Host "🔨 Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Build failed" -ForegroundColor Red; exit 1 }

Write-Host "🌐 Installing Chromium browser..." -ForegroundColor Yellow
npm run postinstall
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Browser installation failed" -ForegroundColor Red; exit 1 }

if (-not (Test-Path .env)) {
    Write-Host "📝 Creating .env file..." -ForegroundColor Yellow
    @"
PORT=3000
DEEPSEEK_EMAIL=
DEEPSEEK_PASSWORD=
RESTORE_SESSION=false
ENABLE_RAG=true
RAG_CHUNK_SIZE=2000
RAG_FRAGMENT_MAX_CHARS=1200
DEEPSEEK_DEEPTHINK_MULTIPLIER=2.5
DEEPSEEK_MAX_CONTEXT_CHARS=2400000
DEEPSEEK_STATE_PATH=./state.json
DEEPSEEK_API_KEY_PATH=./.api-key
DEEPSEEK_SYSTEM_PROMPT_PATH=./prompts/system_prompt.txt
"@ | Out-File -FilePath .env -Encoding utf8
    Write-Host "✅ Created .env" -ForegroundColor Green
}

Write-Host "🚀 Starting server..." -ForegroundColor Green
npm start