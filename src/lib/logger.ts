import { PubSub } from "./PubSub.js";

type LogLevel = "info" | "warn" | "error";

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

class Logger extends PubSub<LogMessage> {
  log(level: LogLevel, message: string) {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date(),
    };
    
    this.publish(logMessage);
  }
}

export const logger = new Logger();