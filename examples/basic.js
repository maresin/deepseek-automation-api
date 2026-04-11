#!/usr/bin/env node

/**
 * Basic example - first request with auto-login and subsequent requests with API key
 */

const BASE_URL = "http://localhost:3000";
const fs = require('fs');
const path = require('path');

const API_KEY_FILE = path.join(__dirname, '.example-api-key');

async function main() {
    console.log("=".repeat(50));
    console.log("DeepSeek API - Basic Example");
    console.log("=".repeat(50));

    let apiKey = null;

    // Try to load existing API key
    if (fs.existsSync(API_KEY_FILE)) {
        apiKey = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
        console.log(`\n✓ Loaded existing API key: ${apiKey}`);
    }

    // Step 1: First request with email/password (if no API key)
    if (!apiKey) {
        console.log("\n1. Sending first request with email/password...");
        
        const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "your@email.com",      // Replace with your DeepSeek email
                password: "yourpassword",      // Replace with your DeepSeek password
                messages: [{ role: "user", content: "Say 'Hello, API!'" }]
            })
        });

        if (!response.ok) {
            console.error(`Error: ${response.status}`);
            const error = await response.text();
            console.error(error);
            process.exit(1);
        }

        // Get API key from response headers
        apiKey = response.headers.get("X-API-Key");
        console.log(`✓ API key received: ${apiKey}`);

        const data = await response.json();
        console.log(`✓ Response: ${data.choices[0].message.content}`);

        // Save API key for future use
        fs.writeFileSync(API_KEY_FILE, apiKey);
        console.log("\n✓ API key saved to .example-api-key");
    }

    // Step 2: Subsequent request with API key
    console.log("\n2. Sending second request with API key...");
    
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "Tell me a short joke" }]
        })
    });

    const data = await response.json();
    console.log(`✓ Response: ${data.choices[0].message.content}`);

    console.log("\n" + "=".repeat(50));
    console.log("Basic example completed!");
    console.log("=".repeat(50));
}

main().catch(console.error);