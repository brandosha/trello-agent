import { codex } from "./lib/codex.js";

async function test() {
  const thread = codex.thread("test-thread");
  for await (const event of thread.pastEvents()) {
    console.log("Past event:", event);
  }

  // thread.subscribe(event => {
  //   console.log("Received event:", event);
  // });

  // thread.queueInput("Hello, codex.", "test");
}

test().catch(console.error);