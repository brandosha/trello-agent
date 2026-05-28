import { codex } from "./codex.js";
import { logger } from "./logger.js"
import { permissions } from "./permissions.js";
import { TrelloWebhookRequest, getThreadUrl, makeTrelloApiRequest } from "./trello.js";
import { multilineString } from "./utils.js";

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

  const clientIdentifier = request.headers["x-trello-client-identifier"];
  if (clientIdentifier === "TrelloAgent/webhook") {
    return; // Ignore webhooks sent by actions triggered by this webhook
  }

  const cardId = request.body.action.data.card?.id;
  if (!cardId) {
    console.warn("Trello webhook does not contain card information, skipping");
    return;
  }

  const threadId = `trello-card-${cardId}`;
  if (clientIdentifier === `TrelloAgent/mcp/thread/${threadId}`) {
    return; // Don't prompt if the webhook is triggered by an action that was just taken by the agent
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

  const username = request.body.action.memberCreator?.username;
  if (typeof username !== "string" || !username) {
    console.warn("Trello webhook action does not contain memberCreator.username, skipping");
    return;
  }

  if (!await permissions.forUser(username).has("thread.prompt")) {
    console.log(`Trello webhook action owner ${username} does not have thread.prompt, skipping`);
    return;
  }

  const threadUrl = await getThreadUrl(threadId);
  const attachments = await makeTrelloApiRequest({
    method: 'GET',
    endpoint: `cards/${cardId}/attachments?fields=url,name`,
  });
  const hasThreadAttachment = attachments.some((attachment: any) => attachment.url === threadUrl);
  if (!hasThreadAttachment) {
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
    endpoint: `organizations/${orgId}?fields=displayName`,
  });
  const orgName = organization.displayName;
  
  const thread = codex.thread(threadId);

  const isNew = await thread.isNew();
  if (await thread.isNew()) {
    console.log(`Created a new thread for Trello card ${cardId}`);
  }

  thread.promptImmediately(multilineString(
    `[system/webhook/trello]`,
    `Trello action for card "${cardName}" in list "${listName}" on board "${boardName}" in organization "${orgName}":`,
    `X-Trello-Client-Identifier: ${clientIdentifier ?? "none"}`,
    JSON.stringify(request.body.action),
    ``,
    `Next steps:`,
    isNew && `- Set up your workspace for this thread. Follow the instructions in the workspace_setup_instructions.json resource.`,
    `- Analyze the action and determine what, if anything, needs to be done in response based on the card's current state and project guidelines.`,
  ), "system/webhook/trello");

  // const actionType = request.body.action.type;
  // console.log(`Handling Trello action of type ${actionType} for card "${cardName}" in list "${listName}" on board "${boardName}" in organization "${orgName}"`);
}
