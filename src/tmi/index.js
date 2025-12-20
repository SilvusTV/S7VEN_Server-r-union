// Create TMI.js client
import {BOT_USERNAME, CHANNEL_NAME, OAUTH_TOKEN} from "../config.js";
import tmi from 'tmi.js';

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN,
  },
  channels: [CHANNEL_NAME],
  connection: {
    reconnect: true,
    secure: true,
  },
});

export async function startTmiClient() {
  try {
    await client.connect();
    console.log('[BOT] Connected to Twitch chat.');
  } catch (e) {
    console.error('[BOT] Failed to connect:', e?.message || e);
  }
}
export default client;