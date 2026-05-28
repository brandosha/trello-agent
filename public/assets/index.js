function readTrelloTokenFromHash() {
  if (!window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (!token) return null;
  window.history.replaceState({}, document.title, window.location.pathname);
  return token;
}

var pendingTrelloToken = readTrelloTokenFromHash();
var app = PetiteVue.reactive({
  route: location.pathname,
  backend: new BackendClient(),
});

function timeLabel(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const ONE_MINUTE = 60 * 1000;
  if (diff < ONE_MINUTE) {
    return 'Just now';
  }

  const ONE_HOUR = 60 * ONE_MINUTE;
  if (diff < ONE_HOUR) {
    return `${Math.floor(diff / (60 * 1000))} minutes ago`;
  } else if (diff < 24 * ONE_HOUR) {
    return date.toLocaleTimeString();
  }

  return date.toLocaleString();
}

var ansi = new AnsiUp();


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
    'CodexLogin',
    'ServerKey',
    'TrelloBoards',
    'thread-events/DefaultThreadEvent',
    'thread-events/AgentMessageEvent',
    'thread-events/CommandExecutionEvent',
    'thread-events/McpToolCallEvent',
    'thread-events/PromptEvent',
    'thread-events/ThreadEvent',
    'Thread',
  ].map(importComponent));

  PetiteVue.createApp({
    app,
    timeLabel,
  }).mount();
});
