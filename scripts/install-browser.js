const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BROWSERS_DIR = path.join(__dirname, '..', 'browsers');

console.log('📦 Installing Chromium...');

if (!fs.existsSync(BROWSERS_DIR)) {
    fs.mkdirSync(BROWSERS_DIR, { recursive: true });
}

process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;

try {
    execSync('npx playwright-core install chromium', {
        stdio: 'inherit',
        env: process.env
    });
    
    fs.writeFileSync(
        path.join(BROWSERS_DIR, '.installed'),
        new Date().toISOString()
    );
    
    console.log('✅ Chromium installed');
} catch (error) {
    console.error('❌ Installation failed:', error.message);
    process.exit(1);
}