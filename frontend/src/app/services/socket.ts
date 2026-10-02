import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket as IoSocket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: IoSocket;
  private destroy$ = new Subject<void>();

  constructor() {
    this.socket = io('http://localhost:3000', { autoConnect: true });
  }

  on<T>(event: string): Observable<T> {
    return new Observable((observer) => {
      this.socket.on(event, (data: T) => observer.next(data));
      return () => this.socket.off(event);
    });
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
