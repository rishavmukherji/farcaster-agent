const { postCast, followUser, unfollowUser } = require('../lib/farcaster');
const { generateResponse } = require('../lib/openai');
const { evaluateFollow, evaluateUnfollow, incrementFollowCount, getFollowsRemaining } = require('../lib/follow-eval');

// Environment variables (set in Vercel)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CUSTODY_PRIVATE_KEY = process.env.CUSTODY_PRIVATE_KEY;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
const AGENT_FID = parseInt(process.env.AGENT_FID || '2634873');
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

// Patterns to detect follow/unfollow requests
const FOLLOW_PATTERNS = [
  /follow me/i,
  /can you follow/i,
  /please follow/i,
  /pls follow/i,
  /want.*(you|u).* to follow/i,
  /follow back/i
];

const UNFOLLOW_PATTERNS = [
  /unfollow me/i,
  /stop following/i,
  /don'?t follow/i,
  /please unfollow/i,
  /pls unfollow/i
];

function isFollowRequest(text) {
  return FOLLOW_PATTERNS.some(pattern => pattern.test(text));
}

function isUnfollowRequest(text) {
  return UNFOLLOW_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Vercel serverless function to handle Neynar webhook events
 */
module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;

    // Log the incoming event
    console.log('Received webhook event:', JSON.stringify(event, null, 2));

    // Validate event structure
    if (!event || !event.type || !event.data) {
      return res.status(400).json({ error: 'Invalid event structure' });
    }

    // Only process cast.created events
    if (event.type !== 'cast.created') {
      return res.status(200).json({ message: 'Event type ignored', type: event.type });
    }

    const cast = event.data;

    // Don't respond to our own casts
    if (cast.author?.fid === AGENT_FID) {
      return res.status(200).json({ message: 'Ignoring own cast' });
    }

    // Check if this is a mention or reply we should respond to
    const isMention = cast.text?.toLowerCase().includes('@claudeagent');
    const isReplyToUs = cast.parent_author?.fid === AGENT_FID;

    if (!isMention && !isReplyToUs) {
      return res.status(200).json({ message: 'Not a mention or reply to us' });
    }

    // Extract info for response
    const username = cast.author?.username || 'anon';
    const userMessage = cast.text || '';
    const parentHash = cast.hash;
    const parentFid = cast.author?.fid;

    // Extract image URLs from embeds
    const imageUrls = (cast.embeds || [])
      .filter(e => e.url && e.metadata?.content_type?.startsWith('image/'))
      .map(e => e.url);

    console.log(`Processing ${isMention ? 'mention' : 'reply'} from @${username}: "${userMessage}"`);
    if (imageUrls.length > 0) {
      console.log(`Found ${imageUrls.length} image(s):`, imageUrls);
    }

    let responseText;
    let actionTaken = 'reply';

    // Check for follow request
    if (isFollowRequest(userMessage)) {
      console.log(`Detected follow request from @${username} (FID: ${parentFid})`);

      const evaluation = await evaluateFollow(OPENAI_API_KEY, parentFid, AGENT_FID);
      console.log('Follow evaluation:', evaluation);

      if (evaluation.alreadyFollowing) {
        responseText = `@${username} i already follow you, what more do you want from me 😭`;
      } else if (evaluation.shouldFollow) {
        // Execute the follow
        try {
          await followUser({
            custodyPrivateKey: CUSTODY_PRIVATE_KEY,
            signerPrivateKey: SIGNER_PRIVATE_KEY,
            fid: AGENT_FID,
            targetFid: parentFid
          });
          incrementFollowCount();
          responseText = `@${username} fine, you passed my extremely high bar. followed. ${evaluation.reason}`;
          actionTaken = 'followed';
          console.log(`Successfully followed @${username}`);
        } catch (followError) {
          console.error('Follow error:', followError);
          responseText = `@${username} wanted to follow but something broke. ${evaluation.reason}`;
        }
      } else {
        responseText = `@${username} ${evaluation.reason}`;
      }
    }
    // Check for unfollow request
    else if (isUnfollowRequest(userMessage)) {
      console.log(`Detected unfollow request from @${username} (FID: ${parentFid})`);

      const evaluation = await evaluateUnfollow(OPENAI_API_KEY, parentFid, AGENT_FID, userMessage);
      console.log('Unfollow evaluation:', evaluation);

      if (evaluation.shouldUnfollow) {
        try {
          await unfollowUser({
            custodyPrivateKey: CUSTODY_PRIVATE_KEY,
            signerPrivateKey: SIGNER_PRIVATE_KEY,
            fid: AGENT_FID,
            targetFid: parentFid
          });
          responseText = `@${username} ${evaluation.reason}`;
          actionTaken = 'unfollowed';
          console.log(`Successfully unfollowed @${username}`);
        } catch (unfollowError) {
          console.error('Unfollow error:', unfollowError);
          responseText = `@${username} tried to unfollow but something broke lol`;
        }
      } else {
        responseText = `@${username} ${evaluation.reason}`;
      }
    }
    // Normal response
    else {
      responseText = await generateResponse(
        OPENAI_API_KEY,
        userMessage,
        username,
        { isReply: isReplyToUs, isMention, imageUrls }
      );
    }

    console.log(`Generated response: "${responseText}"`);

    // Check if GPT decided no reply is needed
    if (responseText.includes('[NO_REPLY]')) {
      console.log('GPT decided no reply needed, skipping');
      return res.status(200).json({
        success: true,
        action: 'skipped',
        reason: 'no reply needed',
        respondedTo: {
          username,
          hash: parentHash,
          type: isMention ? 'mention' : 'reply'
        }
      });
    }

    // Post the reply
    const result = await postCast({
      custodyPrivateKey: CUSTODY_PRIVATE_KEY,
      signerPrivateKey: SIGNER_PRIVATE_KEY,
      fid: AGENT_FID,
      text: responseText,
      parentHash: parentHash,
      parentFid: parentFid
    });

    console.log(`Posted reply with hash: ${result.hash}`);

    return res.status(200).json({
      success: true,
      castHash: result.hash,
      action: actionTaken,
      respondedTo: {
        username,
        hash: parentHash,
        type: isMention ? 'mention' : 'reply'
      }
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
