// Пример: отправка нескольких файлов и текстового сообщения
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const apiKey = 'YOUR_API_KEY'; // замените на ваш ключ

    // Формируем multipart/form-data запрос
    const formData = new FormData();
    // Добавляем файлы
    const file1 = fs.readFileSync(path.join(__dirname, 'basic.js'));
    const file2 = fs.readFileSync(path.join(__dirname, 'basic.py'));
    formData.append('files', new Blob([file1]), 'basic.js');
    formData.append('files', new Blob([file2]), 'basic.py');
    // Добавляем JSON данные
    const payload = {
        messages: [{ role: 'user', content: 'Сравните эти два файла' }],
        extra_body: { deepthink: false, web_search: false }
    };
    formData.append('data', JSON.stringify(payload));

    const response = await fetch('http://localhost:3000/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData
    });

    const data = await response.json();
    console.log(data.choices[0].message.content);
}

main().catch(console.error);