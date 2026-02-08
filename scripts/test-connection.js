import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const url = process.argv[2] || 'ws://localhost:8080';
const token = process.argv[3] || '';
const sessionKeyArg = process.argv[4] || '';
const chatMessageArg = process.argv[5] || '';

console.log(`Testing connection to: ${url}`);
console.log('----------------------------------------');

// Ignore self-signed certs for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ws = new WebSocket(url, {
  headers: {
    'Origin': 'http://localhost:5173',
    'User-Agent': 'ClawControl/1.0.0'
  }
});

let handshakeDone = false;
let sentChat = false;
let closeTimer = null;

ws.on('open', () => {
  console.log('✅ WebSocket Connected! Waiting for challenge...');
});

ws.on('message', (data) => {
  const raw = data.toString();
  let response;
  try {
    response = JSON.parse(raw);
  } catch (err) {
    console.log('📩 Received (non-JSON):', raw);
    return;
  }

  // Compact one-line summary, with full JSON below for copy/paste.
  if (response && typeof response === 'object') {
    if (response.type === 'event') {
      const summary = response.event ? `event:${response.event}` : 'event'
      console.log(`📩 Received (${summary})`);
    } else if (response.type === 'res') {
      console.log(`📩 Received (res:${response.id} ok:${String(response.ok)})`);
    } else {
      console.log('📩 Received');
    }
  }
  console.log(JSON.stringify(response, null, 2));

  // Handle Challenge
  if (response.event === 'connect.challenge') {
    console.log('Received challenge, attempting authentication...');
    const connectMsg = {
      type: 'req',
      id: '1',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role: 'operator',
        client: {
          id: 'gateway-client',
          displayName: 'ClawControl',
          version: '1.0.0',
          platform: 'web',
          mode: 'backend'
        },
        auth: token ? { token } : undefined
      }
    };
    const connectMsgForLog = {
      ...connectMsg,
      params: {
        ...connectMsg.params,
        auth: token ? { token: '<redacted>' } : undefined
      }
    };
    console.log('Sending connect frame:', JSON.stringify(connectMsgForLog));
    ws.send(JSON.stringify(connectMsg));
    return;
  }

  // Handle Response
  if (response.type === 'res' && response.id === '1') {
    if (!response.ok) {
      console.error('❌ Handshake Failed:', JSON.stringify(response.error, null, 2));
    } else {
      handshakeDone = true;
      console.log('✅ Handshake Successful!');
      console.log('Server Hello:', JSON.stringify(response.payload, null, 2));

      if (!sentChat && chatMessageArg) {
        const sessionKey = sessionKeyArg || `session-${Date.now()}`;
        const chatReq = {
          type: 'req',
          id: '2',
          method: 'chat.send',
          params: {
            sessionKey,
            message: chatMessageArg,
            idempotencyKey: randomUUID()
          }
        };
        sentChat = true;
        console.log('Sending chat.send frame:', JSON.stringify(chatReq));
        ws.send(JSON.stringify(chatReq));
        console.log('Waiting for streaming events (chat delta/final, agent assistant/lifecycle)...');
      } else {
        console.log('Connected. Pass `[sessionKey] [message]` args to send chat and observe streaming.');
      }
    }
  }

  // Auto-close after we see a chat final, or shortly after lifecycle complete.
  if (response.type === 'event' && response.event === 'chat' && response.payload?.state === 'final') {
    console.log('✅ Saw chat final. Closing socket.');
    ws.close();
  }

  if (response.type === 'event' && response.event === 'agent' && response.payload?.stream === 'lifecycle') {
    const phase = response.payload?.data?.phase;
    const state = response.payload?.data?.state;
    if ((phase === 'end' || phase === 'error' || state === 'complete' || state === 'error') && !closeTimer) {
      closeTimer = setTimeout(() => {
        console.log('✅ Saw agent lifecycle end. Closing socket.');
        ws.close();
      }, 1500);
    }
  }
});

ws.on('error', (err) => {
  console.error('❌ Connection Error:', err.message);
});

ws.on('close', () => {
  console.log('----------------------------------------');
  console.log('Connection Closed');
});

function listAgents() {
  console.log('Requesting agent list...');
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'agents.list',
    id: 2
  }));
}
