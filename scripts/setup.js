const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up DeepSeek Automation API\n');

// Install dependencies
console.log('📦 Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build TypeScript
console.log('\n🔨 Building TypeScript...');
execSync('npm run build', { stdio: 'inherit' });

// Install browser
console.log('\n🌐 Installing browser...');
execSync('npm run postinstall', { stdio: 'inherit' });

console.log('\n✅ Setup complete!\n');
console.log('To start the server:');
console.log('  npm start\n');