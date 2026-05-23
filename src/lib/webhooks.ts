import { codex } from "./codex.js";
import { logger } from "./Logger.js"
import { TrelloWebhookRequest, getThreadUrl, makeTrelloApiRequest } from "./trello.js";

export async function trelloWebhookHandler(request: TrelloWebhookRequest) {
  console.log(`Trello webhook received:\n${JSON.stringify({
    headers: request.headers,
    board: {
      name: request.body.model.name,
      url: request.body.model.url,
    },
    action: {
      type: request.body.action.type,
      data: request.body.action.data,
      creator: request.body.action.memberCreator,
    }
  }, null, 2)}`);

  if (request.headers["x-trello-client-identifier"] !== "TrelloAgent/webhook") {
    return; // Ignore webhooks sent by TrelloAgent itself to avoid loops
  }

  const cardId = request.body.action.data.card?.id;
  if (!cardId) {
    console.warn("Trello webhook does not contain card information, skipping");
    return;
  }

  const cardDetails = await makeTrelloApiRequest({
    method: 'GET',
    endpoint: `cards/${cardId}?fields=labels,idList`,
  });
  const { labels } = cardDetails;
  if (!Array.isArray(labels)) {
    console.warn("Trello API response does not contain labels array, skipping");
    return;
  }

  const hasAgentLabel = labels.some((label: any) => label.name.toLowerCase().includes("agent"));
  if (!hasAgentLabel) {
    console.log("Trello card does not have an agent label, skipping");
    return;
  }
  
  const cardName = request.body.action.data.card.name;
  const boardName = request.body.model.name;

  const list = await makeTrelloApiRequest({
    method: 'GET',
    endpoint: `lists/${cardDetails.idList}?fields=name`,
  });
  const listName = list.name;

  const orgId = request.body.model.idOrganization;
  const organization = await makeTrelloApiRequest({
    method: 'GET',
    endpoint: `organizations/${orgId}?fields=name`,
  });
  const orgName = organization.name;

  const threadId = `trello-card-${cardId}`;
  const thread = codex.thread(threadId, {
    sandboxMode: 'workspace-write',
  });

  if (await thread.isNew()) {
    console.log(`Creating new thread for Trello card ${cardId}`);
    const managerThread = codex.thread("default");
    managerThread.queueInput([
      `[system/webhook/trello]`,
      `New agent thread created for Trello card "${cardName}" in list "${listName}" on board "${boardName}" in organization "${orgName}".`,
      `Card ID: ${cardId}`,
      `Thread ID: ${threadId}`,
      ``,
      `Next steps:`,
      `- Set up the agent's workspace according to the project guidelines`,
      `- Prompt the agent to analyze the card and determine what actions to take`,
    ].join('\n'), "system/webhook/trello");

    const threadUrl = await getThreadUrl(threadId);
    await makeTrelloApiRequest({
      method: 'POST',
      endpoint: `cards/${cardId}/attachments`,
      body: {
        name: `Agent Thread`,
        url: threadUrl
      },
      clientIdentifier: `TrelloAgent/webhook`
    });
  }

  const actionType = request.body.action.type;
  console.log(`Handling Trello action of type ${actionType} for card "${cardName}" in list "${listName}" on board "${boardName}" in organization "${orgName}"`);
}