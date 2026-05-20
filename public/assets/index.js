function initializeWebSocket() {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket('/ws');
    const callbacks = {};

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
      onOpen: (handler) => websocket.addEventListener('open', handler),
      onClose: (handler) => websocket.addEventListener('close', handler),
      onError: (handler) => websocket.addEventListener('error', handler),
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
      if (threadId && callbacks[threadId]) {
        callbacks[threadId].forEach(callback => callback(data));
      } else {
        callbacks.__all?.forEach(callback => callback(data));
        if (threadId) {
          console.warn('No callbacks found for thread ID:', threadId);
        }
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

  const app = PetiteVue.reactive({
    route: '',
    api,
  })
  window.app = app; // Expose app for debugging

  app.route = location.pathname;

  PetiteVue.createApp({ app }).mount();
});