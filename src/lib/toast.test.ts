import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  success: vi.fn(() => "toast-1"),
  error: vi.fn(() => "toast-2"),
  info: vi.fn(() => "toast-3"),
  warning: vi.fn(() => "toast-4"),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: sonner }));

import { toast } from "./toast";

describe("toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards success with message and options", () => {
    const id = toast.success("已保存", { duration: 2000 });
    expect(sonner.success).toHaveBeenCalledWith("已保存", { duration: 2000 });
    expect(id).toBe("toast-1");
  });

  it("forwards error with message", () => {
    const id = toast.error("出错了");
    expect(sonner.error).toHaveBeenCalledWith("出错了", undefined);
    expect(id).toBe("toast-2");
  });

  it("forwards info with message", () => {
    const id = toast.info("提示信息");
    expect(sonner.info).toHaveBeenCalledWith("提示信息", undefined);
    expect(id).toBe("toast-3");
  });

  it("forwards warning with message", () => {
    const id = toast.warning("警告");
    expect(sonner.warning).toHaveBeenCalledWith("警告", undefined);
    expect(id).toBe("toast-4");
  });

  it("forwards dismiss without id", () => {
    toast.dismiss();
    expect(sonner.dismiss).toHaveBeenCalledWith(undefined);
  });

  it("forwards dismiss with id", () => {
    toast.dismiss("toast-1");
    expect(sonner.dismiss).toHaveBeenCalledWith("toast-1");
  });
});
