#!/usr/bin/env node

/**
 * Advanced example - demonstrates all features:
 * - Tool calling (function calling)
 * - DeepThink (R1) mode
 * - Web search
 * - Expert mode
 * - File upload
 */

const BASE_URL = "http://localhost:3000";
const fs = require('fs');
const path = require('path');

const API_KEY_FILE = path.join(__dirname, '.example-api-key');
let API_KEY = null;

async function main() {
    // Load or create API key
    if (fs.existsSync(API_KEY_FILE)) {
        API_KEY = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
        console.log(`✓ Loaded existing API key: ${API_KEY}`);
    } else {
        console.log("\n1. Registering new session...");
        const response = await fetch(`${BASE_URL}/v1/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "your@email.com",
                password: "yourpassword"
            })
        });

        const data = await response.json();
        API_KEY = data.api_key;
        console.log(`✓ API key received: ${API_KEY}`);
        
        fs.writeFileSync(API_KEY_FILE, API_KEY);
    }

    console.log("\n" + "=".repeat(60));
    console.log("DeepSeek API - Advanced Examples");
    console.log("=".repeat(60));

    // ============================================================
    // Example 1: Tool Calling (Function Calling)
    // ============================================================
    console.log("\n📌 Example 1: Tool Calling (Function Calling)");
    console.log("-".repeat(40));

    const tools = [{
        type: "function",
        function: {
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
                type: "object",
                properties: {
                    location: { type: "string", description: "City name" },
                    unit: { type: "string", enum: ["celsius", "fahrenheit"] }
                },
                required: ["location"]
            }
        }
    }];

    let response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "What's the weather in Moscow?" }],
            tools: tools
        })
    });

    let data = await response.json();
    const message = data.choices[0].message;

    if (message.tool_calls) {
        console.log("✓ Tool call detected:");
        message.tool_calls.forEach(tool => {
            console.log(`   Function: ${tool.function.name}`);
            console.log(`   Arguments: ${tool.function.arguments}`);
        });
    } else {
        console.log(`✓ Response: ${message.content}`);
    }

    // ============================================================
    // Example 2: DeepThink (R1) Mode
    // ============================================================
    console.log("\n📌 Example 2: DeepThink (R1) Mode");
    console.log("-".repeat(40));

    const startTime = Date.now();

    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "Explain quantum entanglement in simple terms" }],
            extra_body: { deepthink: true }
        })
    });

    data = await response.json();
    const duration = (Date.now() - startTime) / 1000;
    console.log(`✓ Response (took ${duration.toFixed(1)}s):`);
    console.log(`   ${data.choices[0].message.content.substring(0, 200)}...`);

    // ============================================================
    // Example 3: Web Search
    // ============================================================
    console.log("\n📌 Example 3: Web Search");
    console.log("-".repeat(40));

    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "What are the latest news about AI?" }],
            extra_body: { web_search: true }
        })
    });

    data = await response.json();
    console.log(`✓ Response with web search:`);
    console.log(`   ${data.choices[0].message.content.substring(0, 200)}...`);

    // ============================================================
    // Example 4: Expert Mode
    // ============================================================
    console.log("\n📌 Example 4: Expert Mode");
    console.log("-".repeat(40));

    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "Explain what is an API" }],
            extra_body: { expert_mode: true }
        })
    });

    data = await response.json();
    console.log(`✓ Expert mode response:`);
    console.log(`   ${data.choices[0].message.content.substring(0, 200)}...`);

    // ============================================================
    // Example 5: Combined Features
    // ============================================================
    console.log("\n📌 Example 5: All Features Combined");
    console.log("-".repeat(40));

    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: "Analyze the future of renewable energy" }],
            extra_body: {
                deepthink: true,
                web_search: true,
                expert_mode: true
            }
        })
    });

    data = await response.json();
    console.log(`✓ Response with all features:`);
    console.log(`   ${data.choices[0].message.content.substring(0, 200)}...`);

    // ============================================================
    // Example 6: File Upload
    // ============================================================
    console.log("\n📌 Example 6: File Upload");
    console.log("-".repeat(40));

    const fs = require('fs');
    const testFilePath = '/tmp/test_upload.txt';
    fs.writeFileSync(testFilePath, 'This is a test file for DeepSeek API.\nIt contains some sample text.\nPlease summarize this.');

    const formData = new FormData();
    const fileStream = fs.readFileSync(testFilePath);
    formData.append('file', new Blob([fileStream]), 'test_upload.txt');

    response = await fetch(`${BASE_URL}/v1/files/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${API_KEY}` },
        body: formData
    });

    if (response.ok) {
        const uploadResult = await response.json();
        console.log(`✓ File uploaded successfully:`, uploadResult);

        response = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "What was in the file I just uploaded? Please summarize." }]
            })
        });

        data = await response.json();
        console.log(`✓ Response about file:`);
        console.log(`   ${data.choices[0].message.content.substring(0, 200)}...`);
    }

    // Clean up
    fs.unlinkSync(testFilePath);

    console.log("\n" + "=".repeat(60));
    console.log("Advanced example completed!");
    console.log("=".repeat(60));
    console.log("\n💡 Tip: Run with RESTORE_SESSION=true to resume last chat");
    console.log("   RESTORE_SESSION=true node server.js");
}

main().catch(console.error);