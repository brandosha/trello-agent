import crypto from "crypto";

export function verifyTrelloWebhookRequest(request: any, secret: string, callbackURL: string) {
  var base64Digest = function (s: string) {
    return crypto.createHmac("sha1", secret).update(s).digest("base64");
  };
  var content = JSON.stringify(request.body) + callbackURL;
  var doubleHash = base64Digest(content);
  var headerHash = request.headers["x-trello-webhook"];
  return doubleHash == headerHash;
}