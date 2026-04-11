#!/usr/bin/env python3
"""
Register separately - get API key without sending a message
"""

import requests

BASE_URL = "http://localhost:3000"

# Auto-login registration
response = requests.post(
    f"{BASE_URL}/v1/register",
    json={
        "email": "your@email.com",
        "password": "your_password"
    }
)

if response.status_code == 200:
    data = response.json()
    print(f"API Key: {data['api_key']}")
    print(f"Message: {data['message']}")
else:
    print(f"Error: {response.status_code}")
    print(response.text)

# For manual login (opens browser, wait for user)
# response = requests.post(f"{BASE_URL}/v1/register", json={})