/**
 * 全局流缓冲区管理。
 *
 * 每个 activeStream 对应一条正在流式生成的助手消息。
 * POST messages 路由写入 buffer，GET stream 路由订阅读取。
 */

type ActiveStream = {
  buffer: string[];
  completed: boolean;
  startedAt: number;
  subscribers: Array<{
    push: (data: string) => void;
    close: () => void;
  }>;
};

const streams = new Map<string, ActiveStream>();

export function registerStream(messageId: string) {
  streams.set(messageId, { buffer: [], completed: false, startedAt: Date.now(), subscribers: [] });
}

export function emitDelta(messageId: string, delta: string) {
  const stream = streams.get(messageId);
  if (!stream) return;
  stream.buffer.push(delta);
  for (const sub of stream.subscribers) {
    sub.push(delta);
  }
}

export function completeStream(messageId: string) {
  const stream = streams.get(messageId);
  if (!stream) return;
  stream.completed = true;
  for (const sub of stream.subscribers) {
    sub.close();
  }
  // 延迟清理，给 subscriber 时间读完
  setTimeout(() => streams.delete(messageId), 60_000);
}

export function failStream(messageId: string) {
  const stream = streams.get(messageId);
  if (!stream) return;
  stream.completed = true;
  for (const sub of stream.subscribers) {
    sub.close();
  }
  setTimeout(() => streams.delete(messageId), 60_000);
}

export function isStreamActive(messageId: string): boolean {
  const stream = streams.get(messageId);
  return !!stream && !stream.completed;
}

/**
 * 返回超时的流 ID 列表。用于定期清理卡住的 streaming 消息。
 */
export function getStaleStreamIds(timeoutMs: number): string[] {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, stream] of streams) {
    if (!stream.completed && now - stream.startedAt > timeoutMs) {
      staleIds.push(id);
    }
  }
  return staleIds;
}

/**
 * 订阅一个活跃的流。返回已有的 buffer 内容 + 后续实时推送。
 * 返回 { existingDeltas, onDelta, onDone, unsubscribe }
 */
export function subscribeStream(
  messageId: string
): { existingDeltas: string[]; onDelta: (cb: (delta: string) => void) => void; onDone: (cb: () => void) => void; unsubscribe: () => void } | null {
  const stream = streams.get(messageId);
  if (!stream) return null;

  let deltaCallback: ((delta: string) => void) | null = null;
  let doneCallback: (() => void) | null = null;

  const subscriber = {
    push: (data: string) => {
      if (deltaCallback) deltaCallback(data);
    },
    close: () => {
      if (doneCallback) doneCallback();
    }
  };

  stream.subscribers.push(subscriber);

  return {
    existingDeltas: [...stream.buffer],
    onDelta: (cb) => { deltaCallback = cb; },
    onDone: (cb) => {
      doneCallback = cb;
      // 注册 onDone 时如果已完成，立即触发
      if (stream.completed) cb();
    },
    unsubscribe: () => {
      const idx = stream.subscribers.indexOf(subscriber);
      if (idx >= 0) stream.subscribers.splice(idx, 1);
    }
  };
}
