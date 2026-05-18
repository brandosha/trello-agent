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

document.addEventListener('DOMContentLoaded', async () => {
  const api = await initializeWebSocket();
  window.api = api; // Expose API for debugging

  const threadId = location.pathname.slice(1); // Get thread ID from URL path
  const threadLabel = document.getElementById('thread-id');
  threadLabel.textContent = `Thread: ${threadId || '(none)'}`;

  const threadContainer = document.getElementById('thread-events');
  const filterText = document.getElementById('filter-text');
  const filterType = document.getElementById('filter-type');
  const autoscroll = document.getElementById('autoscroll');
  const connectionStatus = document.getElementById('connection-status');
  const statTotal = document.getElementById('stat-total');
  const statLast = document.getElementById('stat-last');
  const statInputs = document.getElementById('stat-inputs');
  const statErrors = document.getElementById('stat-errors');

  const events = [];
  const typeSet = new Set();
  let inputCount = 0;
  let errorCount = 0;

  function getEventPayload(message) {
    if (message && message.type === 'thread.event' && message.event) {
      return message.event;
    }
    return message;
  }

  function classifyEvent(message) {
    const payload = getEventPayload(message);
    const type = payload?.type || message?.type || 'event';
    if (type.includes('error') || type.includes('failed') || type.includes('invalid')) {
      return 'err';
    }
    if (type.includes('warn') || type.includes('abort')) {
      return 'warn';
    }
    if (type.includes('completed') || type.includes('started')) {
      return 'ok';
    }
    return 'info';
  }

  function extractSummary(message) {
    const payload = getEventPayload(message);
    if (payload?.item?.text) return payload.item.text;
    if (payload?.message) return payload.message;
    if (payload?.input) return payload.input;
    if (typeof payload?.type === 'string') return payload.type;
    if (typeof message?.type === 'string') return message.type;
    return 'Event received';
  }

  function formatTimestamp(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleTimeString();
  }

  function renderEvent(message) {
    const payload = getEventPayload(message);
    const type = payload?.type || message?.type || 'event';
    const tone = classifyEvent(message);
    const element = document.createElement('div');
    element.className = `event ${tone}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const metaLines = [
      `Time: ${formatTimestamp(payload?.timestamp || message?.timestamp)}`,
      `ID: ${payload?.id || message?.id || '--'}`,
      `Thread: ${message?.threadId || message?.thread_id || payload?.threadId || payload?.thread_id || '--'}`,
    ];
    meta.innerHTML = metaLines.map(line => `<div>${line}</div>`).join('');

    const body = document.createElement('div');
    const typeEl = document.createElement('div');
    typeEl.className = 'type';
    typeEl.textContent = type;

    const summary = document.createElement('div');
    summary.textContent = extractSummary(message);
    summary.style.margin = '6px 0 8px';
    summary.style.whiteSpace = 'pre-wrap';

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(payload || message, null, 2);

    body.appendChild(typeEl);
    body.appendChild(summary);
    body.appendChild(pre);

    element.appendChild(meta);
    element.appendChild(body);
    return element;
  }

  function updateStats(lastEvent) {
    statTotal.textContent = String(events.length);
    const payload = lastEvent ? getEventPayload(lastEvent) : null;
    statLast.textContent = payload ? formatTimestamp(payload.timestamp) : '--';
    statInputs.textContent = String(inputCount);
    statErrors.textContent = String(errorCount);
  }

  function rebuildFilterOptions() {
    const current = filterType.value;
    filterType.innerHTML = '<option value="">All types</option>';
    Array.from(typeSet).sort().forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      filterType.appendChild(option);
    });
    filterType.value = current;
  }

  function applyFilters() {
    const text = filterText.value.trim().toLowerCase();
    const type = filterType.value;
    Array.from(threadContainer.children).forEach((node) => {
      const dataText = node.getAttribute('data-search') || '';
      const eventType = node.getAttribute('data-type') || '';
      const matchesText = !text || dataText.includes(text);
      const matchesType = !type || eventType === type;
      node.style.display = matchesText && matchesType ? '' : 'none';
    });
  }

  function appendEvent(message) {
    const payload = getEventPayload(message);
    const type = payload?.type || message?.type || 'event';
    const element = renderEvent(message);
    element.setAttribute('data-type', type);
    element.setAttribute('data-search', JSON.stringify(payload || message).toLowerCase());
    threadContainer.appendChild(element);
    if (autoscroll.checked) {
      element.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  api.subscribe(threadId, (message) => {
    console.log('Received thread update:', message);
    const payload = getEventPayload(message);
    events.push(message);
    if (payload?.type) {
      typeSet.add(payload.type);
      rebuildFilterOptions();
    }
    if (payload?.type === 'input') inputCount += 1;
    if (classifyEvent(message) === 'err') errorCount += 1;
    appendEvent(message);
    applyFilters();
    updateStats(message);
  });

  const inputForm = document.getElementById('input-form');
  const inputField = document.getElementById('input-field');
  inputForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = inputField.value.trim();
    if (!input) return;
    api.sendInput(threadId, input);
    inputField.value = '';
    inputField.focus();
  });

  const abortButton = document.getElementById('abort-button');
  abortButton.addEventListener('click', () => {
    api.abort(threadId);
  });

  filterText.addEventListener('input', applyFilters);
  filterType.addEventListener('change', applyFilters);

  api.onOpen(() => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.style.color = 'var(--ok)';
  });
  api.onClose(() => {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.style.color = 'var(--warn)';
  });
  api.onError(() => {
    connectionStatus.textContent = 'Error';
    connectionStatus.style.color = 'var(--err)';
  });
});