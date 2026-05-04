function chunkText(text, maxChars = null) {
    const chunkSize = maxChars || parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

module.exports = { chunkText };