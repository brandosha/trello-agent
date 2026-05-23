import { logger } from "./Logger.js"
import { TrelloWebhookRequest, makeTrelloApiRequest } from "./trello.js";

export async function trelloWebhookHandler(request: TrelloWebhookRequest) {
  logger.info(`Trello webhook received:\n${JSON.stringify({
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
}