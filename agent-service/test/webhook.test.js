const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const webhookPath = path.join(__dirname, '..', 'api', 'webhook.js');
const farcasterPath = require.resolve('../lib/farcaster');
const openaiPath = require.resolve('../lib/openai');
const followEvalPath = require.resolve('../lib/follow-eval');

function signedPayload(body, secret = 'test-webhook-secret') {
  const payload = JSON.stringify(body);
  return {
    payload,
    signature: crypto.createHmac('sha512', secret).update(payload).digest('hex')
  };
}

function createCastEvent(text = '@claudeagent hello') {
  return {
    type: 'cast.created',
    data: {
      author: { fid: 111, username: 'alice' },
      text,
      hash: '0x1234',
      embeds: []
    }
  };
}

function createResponse() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function loadWebhook() {
  const calls = {
    generateResponse: 0,
    postCast: 0,
    followUser: 0,
    unfollowUser: 0
  };

  delete require.cache[webhookPath];
  require.cache[farcasterPath] = {
    id: farcasterPath,
    filename: farcasterPath,
    loaded: true,
    exports: {
      postCast: async () => {
        calls.postCast += 1;
        return { hash: '0xbeef' };
      },
      followUser: async () => {
        calls.followUser += 1;
      },
      unfollowUser: async () => {
        calls.unfollowUser += 1;
      }
    }
  };
  require.cache[openaiPath] = {
    id: openaiPath,
    filename: openaiPath,
    loaded: true,
    exports: {
      generateResponse: async () => {
        calls.generateResponse += 1;
        return '@alice hello back';
      }
    }
  };
  require.cache[followEvalPath] = {
    id: followEvalPath,
    filename: followEvalPath,
    loaded: true,
    exports: {
      evaluateFollow: async () => ({ shouldFollow: false, alreadyFollowing: false, reason: 'no' }),
      evaluateUnfollow: async () => ({ shouldUnfollow: false, reason: 'no' }),
      incrementFollowCount: () => {},
      getFollowsRemaining: () => 0
    }
  };

  return { handler: require(webhookPath), calls };
}

test.beforeEach(() => {
  process.env.NEYNAR_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.AGENT_FID = '2634873';
});

test('rejects missing Neynar signature before any agent action can run', async () => {
  const { handler, calls } = loadWebhook();
  const res = createResponse();

  await handler(
    {
      method: 'POST',
      headers: {},
      body: createCastEvent()
    },
    res
  );

  assert.equal(res.statusCode, 401);
  assert.equal(calls.generateResponse, 0);
  assert.equal(calls.postCast, 0);
  assert.equal(calls.followUser, 0);
  assert.equal(calls.unfollowUser, 0);
});

test('rejects invalid Neynar signature before any agent action can run', async () => {
  const { handler, calls } = loadWebhook();
  const res = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { 'x-neynar-signature': 'not-a-valid-signature' },
      body: createCastEvent()
    },
    res
  );

  assert.equal(res.statusCode, 401);
  assert.equal(calls.generateResponse, 0);
  assert.equal(calls.postCast, 0);
  assert.equal(calls.followUser, 0);
  assert.equal(calls.unfollowUser, 0);
});

test('accepts a valid Neynar HMAC signature and processes the cast', async () => {
  const { handler, calls } = loadWebhook();
  const event = createCastEvent();
  const { payload, signature } = signedPayload(event);
  const res = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { 'x-neynar-signature': signature },
      body: payload
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.castHash, '0xbeef');
  assert.equal(calls.generateResponse, 1);
  assert.equal(calls.postCast, 1);
});
