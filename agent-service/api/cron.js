const { postCast } = require('../lib/farcaster');
const { getUserCasts } = require('../lib/neynar');
const OpenAI = require('openai');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CUSTODY_PRIVATE_KEY = process.env.CUSTODY_PRIVATE_KEY;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
const AGENT_FID = parseInt(process.env.AGENT_FID || '2634873');
const AUTONOMOUS_CAST_PROMPT = process.env.AUTONOMOUS_CAST_PROMPT;

/**
 * Cron job to wake up the agent and post an autonomous cast
 */
module.exports = async (req, res) => {
  // Verify this is a legitimate cron request from Vercel
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Autonomous cast cron triggered');

    // Fetch recent casts from the agent
    const recentCasts = await getUserCasts(AGENT_FID, 10);

    const recentCastTexts = recentCasts
      .map(c => `- "${c.text}" (${new Date(c.timestamp).toLocaleDateString()})`)
      .join('\n');

    console.log('Recent casts:', recentCastTexts);

    // Generate a new cast using OpenAI
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: AUTONOMOUS_CAST_PROMPT },
        {
          role: 'user',
          content: `Here are your recent casts:\n${recentCastTexts}\n\nWrite a new cast. Don't repeat topics you've already covered. Be fresh and interesting.`
        }
      ],
      max_completion_tokens: 150,
      temperature: 0.95
    });

    const castText = completion.choices[0].message.content.trim();
    console.log('Generated cast:', castText);

    // Don't post if it looks like a refusal or error
    if (castText.includes('[NO_CAST]') || castText.length < 10) {
      console.log('Skipping cast - nothing interesting to say');
      return res.status(200).json({
        success: true,
        action: 'skipped',
        reason: 'nothing interesting to say'
      });
    }

    // Post the cast
    const result = await postCast({
      custodyPrivateKey: CUSTODY_PRIVATE_KEY,
      signerPrivateKey: SIGNER_PRIVATE_KEY,
      fid: AGENT_FID,
      text: castText
    });

    console.log('Posted autonomous cast:', result.hash);

    return res.status(200).json({
      success: true,
      castHash: result.hash,
      text: castText
    });

  } catch (error) {
    console.error('Cron error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
      message: error.message
    });
  }
};
