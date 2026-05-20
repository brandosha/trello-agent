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

function getOrCreateAuthToken() {
  const existing = window.localStorage.getItem('trelloAgentAuthToken');
  if (existing) return existing;
  const created = generateAuthToken();
  window.localStorage.setItem('trelloAgentAuthToken', created);
  return created;
}

function initializeWebSocket(authToken) {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket('/ws');
    const callbacks = { __all: [] };

    const api = {
      subscribe: (threadId, callback) => {
        if (!callbacks[threadId]) {
          callbacks[threadId] = [];
        }
        callbacks[threadId].push(callback);
        websocket.send(JSON.stringify({ type: 'subscribe', threadId }));
      },
      sendPrompt: (threadId, prompt) => {
        websocket.send(JSON.stringify({ type: 'prompt', threadId, prompt }));
      },
      abort: (threadId) => {
        websocket.send(JSON.stringify({ type: 'abort', threadId }));
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
      requestTrelloOAuth: (payload) => {
        websocket.send(JSON.stringify({ type: 'trello.oauth.request', ...payload }));
      },
      sendPermissionsUpdate: (payload) => {
        websocket.send(JSON.stringify({ type: 'trello.permissions.set', ...payload }));
      },
      requestPermissions: () => {
        websocket.send(JSON.stringify({ type: 'trello.permissions.list' }));
      },
      onOpen: (handler) => websocket.addEventListener('open', handler),
      onClose: (handler) => websocket.addEventListener('close', handler),
      onError: (handler) => websocket.addEventListener('error', handler),
      onMessage: (handler) => callbacks.__all.push(handler),
    };

    websocket.addEventListener('open', () => {
      console.log('WebSocket connection established');
      if (authToken) {
        api.sendAuth(authToken);
      }
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

  const authToken = getOrCreateAuthToken();
  const api = await initializeWebSocket(authToken);

  const app = PetiteVue.reactive({
    route: '',
    api,
    authToken,
    trelloStatus: {
      configured: false,
      ownerId: null,
    },
    trelloAuth: {
      authorized: false,
      owner: false,
      memberId: null,
      permissions: { view: false, edit: false },
    },
    trelloPermissions: {},
  })
  window.app = app; // Expose app for debugging

  app.route = location.pathname;

  api.onMessage((message) => {
    if (message?.type === 'trello.status') {
      app.trelloStatus = {
        configured: !!message.configured,
        ownerId: message.ownerId || null,
      };
    }
    if (message?.type === 'trello.auth.status') {
      app.trelloAuth = {
        authorized: !!message.authorized,
        owner: !!message.owner,
        memberId: message.memberId || null,
        permissions: message.permissions || { view: false, edit: false },
      };
    }
    if (message?.type === 'trello.permissions') {
      app.trelloPermissions = message.permissions || {};
    }
  });

  PetiteVue.createApp({ app }).mount();
});