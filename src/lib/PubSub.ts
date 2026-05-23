export type Unsubscribe = () => void;

export class PubSub<EventType> {
  private _subs: ((event: EventType) => void)[] = [];

  publish(event: EventType) {
    this._subs.forEach((callback) => callback(event));
  }

  subscribe(callback: (event: EventType) => void) {
    this._subs.push(callback);
    return () => {
      this._subs = this._subs.filter((cb) => cb !== callback);
    };
  }
}

export class HistorySub<T> extends PubSub<T> {
  history: T[] = []
  limit?: number;

  constructor(limit?: number) {
    super();
    this.limit = limit;
  }

  subscribe(callback: (event: T) => void, limit?: number): () => void {
    if (limit === undefined) limit = this.limit;
    if (limit) {
      this.history.slice(-limit).forEach(callback);
    } else {
      this.history.forEach(callback);
    }

    return super.subscribe(callback)
  }

  publish(event: T): void {
    this.history.push(event);
    if (this.limit && this.history.length >= this.limit * 2) {
      this.history = this.history.slice(-this.limit);
    }

    super.publish(event)
  }
}

export class ValueSub<T> extends PubSub<T> {
  value: T;

  constructor(v: T) {
    super()
    this.value = v;
  }

  subscribe(callback: (event: T) => void): () => void {
    callback(this.value);
    return super.subscribe(callback);
  }

  set(v: T) {
    this.value = v;
    super.publish(v)
  }
}
