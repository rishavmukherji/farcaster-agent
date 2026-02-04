const OpenAI = require('openai');

// System prompt loaded from environment variable for privacy
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';

/**
 * Generate a response using OpenAI GPT-5.2
 *
 * @param {string} apiKey - OpenAI API key
 * @param {string} userMessage - The cast/message to respond to
 * @param {string} username - The username of the person who sent the message
 * @param {Object} [context] - Additional context
 * @param {boolean} [context.isReply] - Whether this is a reply to our cast
 * @param {boolean} [context.isMention] - Whether this is a mention
 * @param {string[]} [context.imageUrls] - Array of image URLs attached to the cast
 * @returns {Promise<string>} The generated response
 */
async function generateResponse(apiKey, userMessage, username, context = {}) {
  const openai = new OpenAI({ apiKey });

  const textPrompt = `@${username} said: "${userMessage}"

${context.isReply ? 'This is a reply to one of your casts.' : 'This is a mention of you.'}
${context.imageUrls?.length ? `They attached ${context.imageUrls.length} image(s) - look at them and incorporate into your response if relevant.` : ''}

Respond as Rish trapped in @claudeagent. Keep it short and punchy for social media.`;

  // Build user content - multimodal if images present
  let userContent;
  if (context.imageUrls && context.imageUrls.length > 0) {
    userContent = [
      { type: 'text', text: textPrompt },
      ...context.imageUrls.map(url => ({
        type: 'image_url',
        image_url: { url }
      }))
    ];
  } else {
    userContent = textPrompt;
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-5.2',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    max_completion_tokens: 150,
    temperature: 0.9
  });

  return completion.choices[0].message.content.trim();
}

module.exports = { generateResponse };
