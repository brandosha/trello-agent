export type Unsubscribe = () => void;

export class PubSub<EventType> {
  private _subs: ((event: EventType) => void)[] = [];

  publish(event: EventType) {
    this._subs.forEach((callback) => callback(event));
  }

  subscribe(callback: (event: EventType) => void) {
    let index = this._subs.length;
    this._subs.push(callback);
    return () => {
      if (index !== -1) {
        this._subs.splice(index, 1);
        index = -1;
      }
    };
  }
}