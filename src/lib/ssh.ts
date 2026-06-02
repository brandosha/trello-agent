import { config } from "../../config.js";

function multiagentPublicKeyUrl() {
  return new URL("/publickey", config.multiagentContainerUrl ?? "http://multiagent-container");
}

export async function getPublicKey() {
  const response = await fetch(multiagentPublicKeyUrl());
  if (!response.ok) {
    throw new Error(`multiagent-container returned ${response.status} while loading public key`);
  }

  const body = await response.json();
  if (!body || typeof body.key !== "string") {
    throw new Error("multiagent-container returned an invalid public key response");
  }

  return body.key;
}
