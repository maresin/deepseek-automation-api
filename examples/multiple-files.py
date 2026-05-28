import requests
import json

api_key = "YOUR_API_KEY"
url = "http://localhost:3000/v1/chat/completions"

files = [
    ('files', ('basic.js', open('examples/basic.js', 'rb'), 'application/javascript')),
    ('files', ('basic.py', open('examples/basic.py', 'rb'), 'text/x-python'))
]
data = {
    'data': json.dumps({
        "messages": [{"role": "user", "content": "Сравните эти два файла"}],
        "extra_body": {"deepthink": False, "web_search": False}
    })
}

response = requests.post(url, headers={"Authorization": f"Bearer {api_key}"}, files=files, data=data)
print(response.json()['choices'][0]['message']['content'])