const { RagManager } = require('../rag-manager.js');

const sessions = new Map();

function getRagManager(apiKey) {
    if (!sessions.has(apiKey)) {
        sessions.set(apiKey, new RagManager(apiKey));
    }
    return sessions.get(apiKey);
}

function generateMockResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    if (lower.includes('теория относительности')) {
        return 'Теория относительности Эйнштейна включает специальную и общую теорию. Специальная теория (1905) постулирует постоянство скорости света и относительность одновременности. Общая теория (1915) описывает гравитацию как искривление пространства-времени.';
    }
    if (lower.includes('квантовая механика')) {
        return 'Квантовая механика описывает поведение частиц на микроуровне. Основные принципы: суперпозиция, квантовая запутанность, корпускулярно-волновой дуализм.';
    }
    if (lower.includes('rag')) {
        return 'RAG (Retrieval-Augmented Generation) — метод улучшения ответов LLM с помощью поиска по внешней базе знаний.';
    }
    return `Интересный вопрос: "${userMessage}". Я ещё учусь, но обязательно запомню этот диалог.`;
}

module.exports = async function chatMockRoute(req, res) {
    const apiKey = req.headers.authorization?.replace('Bearer ', '') || 'mock-session';
    const rag = getRagManager(apiKey);
    const { messages, tools } = req.body;
    const userMsg = messages.find(m => m.role === 'user')?.content || '';
    
    // Сохраняем сообщение пользователя
    await rag.addMessage('user', userMsg);
    
    const hasRagTool = tools?.some(t => t.function?.name === 'search_conversation');
    let assistantReply;
    
    if (hasRagTool && userMsg.toLowerCase().includes('найди')) {
        // Извлекаем поисковый запрос, убирая стоп-слова
        let searchQuery = userMsg.replace(/найди|информацию|о|про|и|какую|сообщи|покажи|найти|поищи/gi, '').trim();
        if (!searchQuery) searchQuery = userMsg;
        const results = await rag.search(searchQuery, 3);
        if (results.length === 0) {
            assistantReply = 'Не найдено релевантной информации.';
        } else {
            assistantReply = `Найденные фрагменты:\n${results.map((r, i) => `${i+1}. ${r.content}`).join('\n')}`;
        }
    } else {
        assistantReply = generateMockResponse(userMsg);
    }
    
    await rag.addMessage('assistant', assistantReply);
    res.json({ choices: [{ message: { role: 'assistant', content: assistantReply } }] });
};