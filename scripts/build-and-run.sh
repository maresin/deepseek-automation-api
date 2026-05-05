#!/bin/bash

# Цветной вывод
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔧 DeepSeek Automation API - Build & Run Script${NC}"

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 16 or higher.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}❌ Node.js version must be >=16. Found v$NODE_VERSION${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# Проверка npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm $(npm -v)${NC}"

# Установка зависимостей
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ npm install failed.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Dependencies installed.${NC}"

# Сборка TypeScript
echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed. Check TypeScript errors.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful.${NC}"

# Установка браузера Playwright
echo -e "${YELLOW}🌐 Installing Chromium browser...${NC}"
npm run postinstall
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Browser installation failed.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Browser ready.${NC}"

# Создание .env из шаблона, если отсутствует
if [ ! -f .env ]; then
    echo -e "${YELLOW}📝 Creating .env file from template...${NC}"
    cat > .env <<EOF
# DeepSeek Automation API Configuration
PORT=3000

# Credentials (optional, for auto-login)
DEEPSEEK_EMAIL=
DEEPSEEK_PASSWORD=

# Restore last chat on server start (true/false)
RESTORE_SESSION=false

# RAG Feature
ENABLE_RAG=true
RAG_CHUNK_SIZE=2000
RAG_FRAGMENT_MAX_CHARS=1200
DEEPSEEK_DEEPTHINK_MULTIPLIER=2.5

# Context limits (characters, default 2.4 million)
DEEPSEEK_MAX_CONTEXT_CHARS=2400000

# Paths
DEEPSEEK_STATE_PATH=./state.json
DEEPSEEK_API_KEY_PATH=./.api-key
DEEPSEEK_SYSTEM_PROMPT_PATH=./prompts/system_prompt.txt
EOF
    echo -e "${GREEN}✅ Created .env file. Edit it to set your credentials.${NC}"
else
    echo -e "${GREEN}✅ .env already exists.${NC}"
fi

# Запуск сервера
echo -e "${GREEN}🚀 Starting server...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop.${NC}"
npm start