import { db, globalLogsTable } from "./database.js";
import { PubSub } from "./PubSub.js";

type LogLevel = "info" | "warn" | "error";

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

export class Logger extends PubSub<LogMessage> {
  log(level: LogLevel, message: string) {
    const logMessage: LogMessage = {
      timestamp: new Date(),
      level,
      message,
    };
    
    this.publish(logMessage);
  }

  info(message: string) {
    this.log("info", message);
  }

  warn(message: string) {
    this.log("warn", message);
  }

  error(message: string) {
    this.log("error", message);
  }
}

export const logger = new Logger();
logger.subscribe(message => {
  console.log(`[${message.timestamp.toISOString()}] [${message.level.toUpperCase()}] ${message.message}`);
  try {
    db.insert(globalLogsTable)
      .values(message)
      .run();
  } catch (err) {
    console.error("Failed to write global log to SQLite:", err);
  }
});
