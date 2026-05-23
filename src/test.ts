// import { codex } from "./lib/codex.js";
import { threadsDir } from "./lib/paths.js";
import { addDetachedGitWorktree } from "./lib/workspaces.js";

async function test() {
  const workspaceDir = await addDetachedGitWorktree({
    location: `${threadsDir}/test-workspace/workspace`,
    repo: "https://github.com/brandosha/trello-agent.git",
    branch: "main",
  });
  console.log("Workspace set up at:", workspaceDir);

  // const thread = codex.thread("test-thread");
  // for await (const event of thread.pastEvents()) {
  //   console.log("Past event:", event);
  // }

  // thread.subscribe(event => {
  //   console.log("Received event:", event);
  // });

  // thread.queueInput("Hello, codex.", "test");
}

test().catch(console.error);