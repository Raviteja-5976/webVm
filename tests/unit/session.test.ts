import { describe, expect, it } from "vitest";
import { cheerpxDatabaseName } from "@/lib/emulator/cheerpx-adapter";
import { MemoryFileSystem } from "@/lib/emulator/memory-fs";
import { sessionIdFromDbName } from "@/lib/session";

const ID = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";

describe("sessionIdFromDbName", () => {
  it("recognises plain and CheerpX-style session databases", () => {
    expect(sessionIdFromDbName(`sandbox-${ID}`)).toBe(ID);
    expect(sessionIdFromDbName(cheerpxDatabaseName(`sandbox-${ID}`))).toBe(ID);
    expect(sessionIdFromDbName(cheerpxDatabaseName(`sandbox-${ID}-bridge`))).toBe(ID);
    expect(cheerpxDatabaseName(`sandbox-${ID}`)).toBe(`cjFS_/sandbox-${ID}/`);
  });

  it("never matches unrelated databases", () => {
    expect(sessionIdFromDbName("sandbox-settings")).toBeNull();
    expect(sessionIdFromDbName("cjFS_/block_webvm/")).toBeNull();
    expect(sessionIdFromDbName("some-other-app")).toBeNull();
    expect(sessionIdFromDbName(`sandbox-${ID}-x/extra`)).toBeNull();
  });
});

describe("MemoryFileSystem (mock engine)", () => {
  it("supports the full VmFileSystem contract", async () => {
    const fs = new MemoryFileSystem({ "/home/user/": "" });
    await fs.mkdir("/home/user/a/b");
    await fs.write("/home/user/a/b/f.txt", "hi");
    expect((await fs.list("/home/user/a")).map((e) => e.name)).toEqual(["b"]);
    await fs.rename("/home/user/a", "/home/user/z");
    expect(new TextDecoder().decode(await fs.read("/home/user/z/b/f.txt"))).toBe("hi");
    await expect(fs.remove("/home/user/z")).rejects.toThrow(/Is a directory/);
    await fs.remove("/home/user/z", { recursive: true });
    expect(await fs.list("/home/user")).toEqual([]);
  });
});
