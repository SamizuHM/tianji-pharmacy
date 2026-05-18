import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerStream,
  emitDelta,
  completeStream,
  failStream,
  isStreamActive,
  getStaleStreamIds,
  subscribeStream,
} from "@/lib/active-streams";

// active-streams 使用模块级 Map，需要隔离
// 由于模块缓存，每个测试文件共享同一模块实例
// 使用唯一 messageId 避免冲突

describe("active-streams", () => {
  let idCounter = 0;
  function uniqueId() {
    return `stream-test-${Date.now()}-${++idCounter}`;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("registerStream", () => {
    it("注册后流为活跃状态", () => {
      const id = uniqueId();
      registerStream(id);
      expect(isStreamActive(id)).toBe(true);
    });
  });

  describe("emitDelta", () => {
    it("追加到 buffer", () => {
      const id = uniqueId();
      registerStream(id);
      emitDelta(id, "hello");
      emitDelta(id, " world");

      const sub = subscribeStream(id);
      expect(sub).not.toBeNull();
      expect(sub!.existingDeltas).toEqual(["hello", " world"]);
    });

    it("通知订阅者", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDelta = vi.fn();
      sub.onDelta(onDelta);

      emitDelta(id, "data");
      expect(onDelta).toHaveBeenCalledWith("data");
    });

    it("未知 ID 不报错", () => {
      expect(() => emitDelta("unknown", "data")).not.toThrow();
    });
  });

  describe("completeStream", () => {
    it("标记流为完成", () => {
      const id = uniqueId();
      registerStream(id);
      completeStream(id);
      expect(isStreamActive(id)).toBe(false);
    });

    it("调用订阅者的 close 回调", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDone = vi.fn();
      sub.onDone(onDone);

      completeStream(id);
      expect(onDone).toHaveBeenCalled();
    });

    it("未知 ID 不报错", () => {
      expect(() => completeStream("unknown")).not.toThrow();
    });
  });

  describe("failStream", () => {
    it("标记流为完成", () => {
      const id = uniqueId();
      registerStream(id);
      failStream(id);
      expect(isStreamActive(id)).toBe(false);
    });

    it("调用订阅者的 close 回调", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDone = vi.fn();
      sub.onDone(onDone);

      failStream(id);
      expect(onDone).toHaveBeenCalled();
    });
  });

  describe("isStreamActive", () => {
    it("活跃流返回 true", () => {
      const id = uniqueId();
      registerStream(id);
      expect(isStreamActive(id)).toBe(true);
    });

    it("完成流返回 false", () => {
      const id = uniqueId();
      registerStream(id);
      completeStream(id);
      expect(isStreamActive(id)).toBe(false);
    });

    it("未知流返回 false", () => {
      expect(isStreamActive("unknown")).toBe(false);
    });
  });

  describe("getStaleStreamIds", () => {
    it("返回超时的流 ID", () => {
      const id = uniqueId();
      registerStream(id);

      // 快进超过超时时间
      vi.advanceTimersByTime(60_000);
      expect(getStaleStreamIds(50_000)).toContain(id);
    });

    it("不返回已完成的流", () => {
      const id = uniqueId();
      registerStream(id);
      completeStream(id);

      vi.advanceTimersByTime(60_000);
      expect(getStaleStreamIds(50_000)).not.toContain(id);
    });
  });

  describe("subscribeStream", () => {
    it("未知流返回 null", () => {
      expect(subscribeStream("unknown")).toBeNull();
    });

    it("返回已有 buffer", () => {
      const id = uniqueId();
      registerStream(id);
      emitDelta(id, "a");
      emitDelta(id, "b");

      const sub = subscribeStream(id);
      expect(sub!.existingDeltas).toEqual(["a", "b"]);
    });

    it("接收实时 delta", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDelta = vi.fn();
      sub.onDelta(onDelta);

      emitDelta(id, "live");
      expect(onDelta).toHaveBeenCalledWith("live");
    });

    it("完成后触发 onDone 回调", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDone = vi.fn();

      completeStream(id);
      // 注册 onDone 时已完成，应立即触发
      sub.onDone(onDone);
      expect(onDone).toHaveBeenCalled();
    });

    it("取消订阅后不再接收 delta", () => {
      const id = uniqueId();
      registerStream(id);

      const sub = subscribeStream(id)!;
      const onDelta = vi.fn();
      sub.onDelta(onDelta);
      sub.unsubscribe();

      emitDelta(id, "after-unsub");
      expect(onDelta).not.toHaveBeenCalled();
    });
  });
});
