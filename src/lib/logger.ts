import fs from "fs/promises";

import { dataDir } from "./paths.js";
import { PubSub } from "./PubSub.js";

type LogLevel = "info" | "warn" | "error";

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

export class Logger extends PubSub<LogMessage> {
  log(message: string, level: LogLevel = "info") {
    const logMessage: LogMessage = {
      timestamp: new Date(),
      level,
      message,
    };
    
    this.publish(logMessage);
  }

  warn(message: string) {
    this.log(message, "warn");
  }

  error(message: string) {
    this.log(message, "error");
  }
}


let _logAppendQueue = fs.open(`${dataDir}/logs.jsonl`, "a");

export const logger = new Logger();
logger.subscribe(message => {
  console.log(`[${message.timestamp.toISOString()}] [${message.level.toUpperCase()}] ${message.message}`);
  _logAppendQueue = _logAppendQueue.then(async (handle) => {
    await handle.appendFile(JSON.stringify(message) + "\n");
    return handle;
  });
});