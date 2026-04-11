#!/bin/bash
# scripts/setup.sh - Complete setup script

echo "🚀 Setting up DeepSeek Automation API"

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install Playwright browser
npm run postinstall

echo "✅ Setup complete!"
echo ""
echo "To start the server:"
echo "  npm start"
echo ""
echo "To run examples:"
echo "  node examples/basic.js"