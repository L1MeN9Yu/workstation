import { describe, expect, it, vi } from "vitest";
import { currentLogFile } from "./logging";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("currentLogFile", () => {
  it("resolves the current log file path from invoke", async () => {
    invokeMock.mockResolvedValue("/tmp/logs/workstation.log");
    await expect(currentLogFile()).resolves.toBe("/tmp/logs/workstation.log");
    expect(invokeMock).toHaveBeenCalledWith("current_log_file");
  });

  it("propagates invoke errors", async () => {
    invokeMock.mockRejectedValue(new Error("cannot resolve app log dir"));
    await expect(currentLogFile()).rejects.toThrow("cannot resolve app log dir");
  });
});