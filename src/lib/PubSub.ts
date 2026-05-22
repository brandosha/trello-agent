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

  subscribe(callback: (event: T) => void): () => void {
    this.history.forEach(ev => callback(ev));
    return super.subscribe(callback)
  }

  publish(event: T): void {
    this.history.push(event)
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
