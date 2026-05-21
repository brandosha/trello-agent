function generateAuthToken() {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function getStoredAuthToken() {
  return window.localStorage.getItem('trelloAgentAuthToken');
}

function readTrelloTokenFromHash() {
  if (!window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (!token) return null;
  window.history.replaceState({}, document.title, window.location.pathname);
  return token;
}

function buildTrelloAuthUrl(key) {
  const returnUrl = `${window.location.origin}${window.location.pathname}`;
  const url = new URL('https://trello.com/1/authorize');
  url.searchParams.set('expiration', '1hour');
  url.searchParams.set('name', 'trello-agent');
  url.searchParams.set('scope', 'read,account');
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('key', key);
  url.searchParams.set('return_url', returnUrl);
  return url.toString();
}

function initializeWebSocket() {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket('/ws');
    const callbacks = { __all: [] };

    const api = {
      subscribe: (threadId, callback) => {
        if (!callbacks[threadId]) {
          callbacks[threadId] = [];
        }
        callbacks[threadId].push(callback);
        websocket.send(JSON.stringify({ type: 'thread.subscribe', threadId }));
      },
      sendPrompt: (threadId, prompt) => {
        websocket.send(JSON.stringify({ type: 'thread.prompt', threadId, prompt }));
      },
      abort: (threadId) => {
        websocket.send(JSON.stringify({ type: 'thread.abort', threadId }));
      },
      sendAuth: (token) => {
        websocket.send(JSON.stringify({ type: 'auth', authToken: token }));
      },
      sendTrelloSetup: (payload) => {
        websocket.send(JSON.stringify({ type: 'trello.setup', ...payload }));
      },
      sendTrelloAuth: (payload) => {
        websocket.send(JSON.stringify({ type: 'trello.auth', ...payload }));
      },
      requestTrelloKey: () => {
        websocket.send(JSON.stringify({ type: 'auth' }));
      },
      sendPermissionsUpdate: (payload) => {
        websocket.send(JSON.stringify({ type: 'permissions.set', ...payload }));
      },
      requestPermissions: () => {
        websocket.send(JSON.stringify({ type: 'permissions.list' }));
      },
      onOpen: (handler) => websocket.addEventListener('open', handler),
      onClose: (handler) => websocket.addEventListener('close', handler),
      onError: (handler) => websocket.addEventListener('error', handler),
      onMessage: (handler) => callbacks.__all.push(handler),
    };

    websocket.addEventListener('open', () => {
      console.log('WebSocket connection established');
      resolve(api);
    });

    websocket.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.warn('Failed to parse message:', event.data, error);
        return;
      }

      const threadId = data.threadId || data.thread_id || data.threadId === '' ? data.threadId : data.thread_id;
      callbacks.__all.forEach(callback => callback(data));
      if (threadId && callbacks[threadId]) {
        callbacks[threadId].forEach(callback => callback(data));
      } else if (threadId) {
        console.warn('No callbacks found for thread ID:', threadId);
      }
    });

    websocket.addEventListener('close', () => {
      console.log('WebSocket connection closed');
    });

    websocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

  });
}

// UI is handled by petite-vue components.

async function importComponent(path) {
  const content = await fetch(`/assets/components/${path}.html`).then(res => res.text());
  const dom = new DOMParser().parseFromString(content, 'text/html');
  console.log(`Importing component: ${path}`, dom);
  
  const template = dom.getElementsByTagName('template')[0];
  if (template) {
    document.body.appendChild(document.importNode(template, true));
  }

  const script = dom.scripts[0];
  if (script) {
    const scriptCopy = document.createElement('script');
    scriptCopy.textContent = script.textContent;
    document.body.appendChild(scriptCopy);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    'Router',
    'Console',
    'Thread',
  ].map(importComponent));

  const api = await initializeWebSocket();
  const authToken = getStoredAuthToken();

  const pendingTrelloToken = readTrelloTokenFromHash();
  if (pendingTrelloToken) {
    api.sendTrelloAuth({ token: pendingTrelloToken });
  } else {
    api.sendAuth(authToken);
  }

  const app = PetiteVue.reactive({
    route: '',
    api,
    authToken,
    trelloStatus: {
      configured: false,
      ownerId: null,
    },
    trelloKey: null,
    trelloAuth: {
      authorized: false,
      owner: false,
      memberId: null,
      permissions: { view: false, edit: false, create: false },
    },
    trelloPermissions: {},
    oauthRequested: false,
    pendingTrelloToken,
  })
  window.app = app; // Expose app for debugging

  app.consumePendingToken = () => {
    const token = app.pendingTrelloToken;
    app.pendingTrelloToken = null;
    return token;
  };

  app.route = location.pathname;

  api.onMessage((message) => {
    if (message?.type === 'trello.status') {
      const { configured } = message;
      if (!configured) {
        location.assign('/');
      }
      // app.trelloStatus = {
      //   configured: !!message.configured,
      //   ownerId: message.ownerId || null,
      // };
    }
    if (message?.type === 'trello.auth.request') {
      const key = message.key;
      window.location.assign(buildTrelloAuthUrl(key));
      // app.trelloKey = message.key || null;
      // if (app.oauthRequested && app.trelloStatus.configured && app.trelloKey) {
      //   window.location.assign(buildTrelloAuthUrl(app.trelloKey));
      // }
    }
    if (message?.type === 'auth' && message.authToken) {
      window.localStorage.setItem('trelloAgentAuthToken', message.authToken);
      app.authToken = message.authToken;
    }
    if (message?.type === 'permissions.list' || message?.type === 'trello.permissions') {
      app.trelloPermissions = message.permissions || {};
    }
  });

  PetiteVue.createApp({ app }).mount();
});