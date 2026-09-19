// server-modules/chunking.js
/**
 * @file server-modules/chunking.js
 * Plain-text splitting helper used by the RAG indexing path.
 *
 * Chunks are produced by slicing the input string every `chunkSize`
 * characters. There is no attempt to align on word or sentence
 * boundaries: the embedding model (Xenova/all-MiniLM-L6-v2) has a
 * hard 512-token limit, and a fixed-character slice guarantees that
 * every chunk is comfortably below it, regardless of language.
 */

/**
 * Split text into fixed-size character chunks.
 *
 * @param {string} text - Text to split.
 * @param {number} [maxChars] - Chunk size in characters. Falls back to
 *                              the RAG_CHUNK_SIZE environment variable,
 *                              which defaults to 2000.
 * @returns {string[]} Array of chunks, each at most `chunkSize` characters.
 */
function chunkText(text, maxChars = null) {
    const chunkSize = maxChars || parseInt(process.env.RAG_CHUNK_SIZE || '2000', 10);
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

module.exports = { chunkText };