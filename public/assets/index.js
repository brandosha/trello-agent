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
      sendInput: (threadId, input) => {
        websocket.send(JSON.stringify({ type: 'input', threadId, input }));
      },
      abort: (threadId) => {
        websocket.send(JSON.stringify({ type: 'abort', threadId }));
      },
    };

    websocket.addEventListener('open', () => {
      console.log('WebSocket connection established');
      resolve(api);
    });

    websocket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      // Handle incoming messages and update the UI accordingly
      if (data.threadId && callbacks[data.threadId]) {
        callbacks[data.threadId].forEach(callback => callback(data));
      } else {
        console.warn('No callbacks found for thread ID:', data.threadId);
        console.log('Received message:', data);
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

document.addEventListener('DOMContentLoaded', async () => {
  const api = await initializeWebSocket();
  window.api = api; // Expose API for debugging

  const threadId = location.pathname.slice(1); // Get thread ID from URL path
  console.log("Thread ID:", threadId);

  const threadContainer = document.getElementById('thread-events');
  api.subscribe(threadId, (data) => {
    console.log('Received thread update:', data);
    // Update the UI with the new thread data

    const eventElement = document.createElement('pre');
    eventElement.textContent = JSON.stringify(data, null, 2);
    threadContainer.appendChild(eventElement);
    eventElement.scrollIntoView({ behavior: 'smooth' });
  });

  const inputForm = document.getElementById('input-form');
  const inputField = document.getElementById('input-field');
  inputForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = inputField.value;
    api.sendInput(threadId, input);
    inputField.value = '';
  });

  const abortButton = document.getElementById('abort-button');
  abortButton.addEventListener('click', () => {
    api.abort(threadId);
  });
  
});