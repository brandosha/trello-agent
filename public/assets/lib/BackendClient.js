class BackendClient {
  constructor() {
    const ws = this._ws = new RobustWebsocket("/ws");

    this.auth = {
      email: null,
      permissions: [],
      _token: window.localStorage.getItem('trelloAgentAuthToken') || undefined,
      hasPermission(permission) {
        const { permissions } = this;
        if (!permissions) {
          return false;
        }
      
        if (permissions.includes('*') || permissions.includes(permission)) {
          return true;
        }
      
        let parts = permission.split('.');
        while (parts.length > 2) {
          parts.pop();
          const permToCheck = parts.join('.');
          if (permissions.includes(permToCheck)) {
            return true;
          }
        }
      }
    }

    this.listen('trello.status', ({ configured }) => {
      this.configured = configured;

      if (configured) {
        if (pendingTrelloToken) {
          this.send('trello.auth', { token: pendingTrelloToken });
          pendingTrelloToken = null;
        } else {
          this.send('auth', { authToken: this.auth._token });
        }
      } else if (location.pathname !== '/console') {
        location.assign('/console');
      }
    });

    this.listen('auth', ({ authToken }) => {
      this.auth._token = authToken;
      window.localStorage.setItem('trelloAgentAuthToken', authToken);
    });

    this.listen('auth.success', ({ email }) => {
      this.auth.email = email;

      // If there are any active thread listeners, re-subscribe to ensure we continue receiving updates after a reconnect or auth change
      Object.entries(this._threadListeners).forEach(([threadId, listeners]) => {
        if (!listeners || !listeners.length) return;
        this.send('thread.subscribe', { threadId });
      });
    });

    this.listen('auth.permissions', ({ permissions }) => {
      this.auth.permissions = permissions || [];
    });

    this.listen('trello.auth.request', ({ key }) => {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const url = new URL('https://trello.com/1/authorize');
      url.searchParams.set('expiration', '1hour');
      url.searchParams.set('name', 'trello-agent');
      url.searchParams.set('scope', 'read,account');
      url.searchParams.set('response_type', 'token');
      url.searchParams.set('key', key);
      url.searchParams.set('return_url', returnUrl);

      debugger;
      location.assign(url.toString());
    });


    this._threadListeners = {};
    this._threadPageListeners = {};

    this.listen('thread.event', ({ threadId, event }) => {
      const listeners = this._threadListeners[threadId];
      if (!listeners || !listeners.length) return;
      listeners.forEach((listener) => listener(event));
    });

    this.listen('thread.events', (page) => {
      const listeners = this._threadPageListeners[page.threadId];
      if (!listeners || !listeners.length) return;
      listeners.forEach((listener) => listener(page));
    });
  }

  send(messageType, payload = {}) {
    this._ws.send({ type: messageType, ...payload });
  }

  listen(messageType, handler) {
    const listener = (data) => {
      if (data.type === messageType) {
        handler(data);
      }
    };

    return this._ws.listen(listener);
  }

  subscribeThread(threadId, handler, pageHandler) {
    const listeners = this._threadListeners[threadId] || [];
    listeners.push(handler);
    this._threadListeners[threadId] = listeners;

    if (pageHandler) {
      const pageListeners = this._threadPageListeners[threadId] || [];
      pageListeners.push(pageHandler);
      this._threadPageListeners[threadId] = pageListeners;
    }

    this.send('thread.subscribe', { threadId });

    return () => {
      const current = this._threadListeners[threadId] || [];
      this._threadListeners[threadId] = current.filter((listener) => listener !== handler);

      if (pageHandler) {
        const currentPageListeners = this._threadPageListeners[threadId] || [];
        this._threadPageListeners[threadId] = currentPageListeners.filter((listener) => listener !== pageHandler);
      }
    };
  }

  requestThreadEvents(threadId, { limit = 50, offset = 0 } = {}) {
    this.send('thread.events.list', { threadId, limit, offset });
  }
}


class RobustWebsocket {
  _url;
  _ws = null;
  _closed = false;

  _messageQueue = [];
  _listeners = [];

  _retryTimeout = 3000;

  constructor(url) {
    this._url = url;
    this._connect();
  }

  _connect() {
    if (this._ws) {
      return;
    }

    const ws = this._ws = new WebSocket(this._url);
    this._closed = false;

    this._setupWebsocket(ws);
  }

  _attemptReconnect(timeout) {
    if (this._closed) {
      return;
    }

    if (this._ws && this._ws.readyState === WebSocket.CLOSED) {
      this._ws = null;
    }

    setTimeout(() => {
      this._connect();
    }, timeout);
  }

  _setupWebsocket(ws) {
    ws.onopen = () => {
      this._connectListeners.forEach((l) => l());
      this._messageQueue.forEach((msg) => ws.send(msg));
      this._messageQueue = [];
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this._listeners.forEach((listener) => listener(data));
    };

    ws.onerror = (event) => {
      console.error("WebSocket error:", event);
      this._attemptReconnect(this._retryTimeout);
    };

    ws.onclose = () => {
      this._ws = null;
      this._attemptReconnect(this._retryTimeout);
    };
  }

  close() {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
    }
  }

  send(data) {
    const message = JSON.stringify(data);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(message);
    } else {
      this._messageQueue.push(message);
    }
  }

  listen(listener) {
    this._listeners.push(listener);

    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  _connectListeners = [];
  onConnect(listener) {
    this._connectListeners.push(listener);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      listener();
    }

    return () => {
      this._connectListeners = this._connectListeners.filter((l) => l !== listener);
    };
  }
}
