import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SentinelCommandRunner,
  ShellFileSystem,
  base64ToBytes,
  basename,
  bytesToBase64,
  dirname,
  joinPath,
  listCommand,
  normalizePath,
  parseFindOutput,
  shellQuote,
  splitSentinelCapture,
  validateName,
} from "@/lib/fs-bridge";
import { LocalBashRunner, bash, bashAvailable, bashTransport, makeTempDir } from "./helpers";

const NASTY = [
  "plain",
  "with space",
  "it's",
  `"double"`,
  "$(touch /tmp/pwned)",
  "`id`",
  "semi;colon && echo hi",
  "back\\slash",
  "new\nline",
  "tab\there",
  "-rf",
  "--",
  "*.txt",
  "~user",
  "ünïcødé ✓",
  "!bang",
  "",
];

describe("shellQuote", () => {
  it("wraps unsafe strings in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
  });

  it("leaves obviously safe strings alone but always quotes a leading dash", () => {
    expect(shellQuote("/home/user/file.txt")).toBe("/home/user/file.txt");
    expect(shellQuote("-rf")).toBe("'-rf'");
  });

  it("rejects NUL bytes", () => {
    expect(() => shellQuote("a\0b")).toThrow();
  });

  it.skipIf(!bashAvailable())("round-trips every nasty string through a real shell unchanged", () => {
    for (const value of NASTY) {
      const r = bash(`printf '%s' ${shellQuote(value)}`);
      expect(r.status).toBe(0);
      expect(r.stdout.toString("utf8")).toBe(value);
    }
  });
});

describe("paths", () => {
  it("normalizes absolute paths", () => {
    expect(normalizePath("/home//user/./a/../b/")).toBe("/home/user/b");
    expect(normalizePath("/..")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("rejects relative paths", () => {
    expect(() => normalizePath("home/user")).toThrow();
  });

  it("joins, splits and validates names", () => {
    expect(joinPath("/home/user", "a b.txt")).toBe("/home/user/a b.txt");
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(() => joinPath("/home", "a/b")).toThrow();
    expect(dirname("/home/user/x")).toBe("/home/user");
    expect(dirname("/x")).toBe("/");
    expect(basename("/home/user/x.txt")).toBe("x.txt");
    expect(validateName("ok.txt")).toBeNull();
    expect(validateName("")).not.toBeNull();
    expect(validateName("..")).not.toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName("x".repeat(256))).not.toBeNull();
  });
});

describe("parseFindOutput", () => {
  it("parses NUL-separated find -printf records", () => {
    const out =
      "d\td\t4096\t1700000000.5\tprojects\0" +
      "f\tf\t12\t1700000001.25\tnotes.txt\0" +
      "l\td\t7\t1700000002\tlink-to-dir\0" +
      "l\tf\t9\t1700000003\tlink-to-file\0" +
      "f\tf\t3\t1700000004\tname\twith\ttabs\0" +
      "f\tf\t0\t1700000005\tline\nbreak\0";
    const entries = parseFindOutput(out, "/home/user");
    expect(entries.map((e) => e.name)).toEqual([
      "link-to-dir",
      "projects",
      "line\nbreak",
      "link-to-file",
      "name\twith\ttabs",
      "notes.txt",
    ]);
    const notes = entries.find((e) => e.name === "notes.txt")!;
    expect(notes).toMatchObject({ path: "/home/user/notes.txt", type: "file", size: 12, mtime: 1700000001250 });
    expect(entries.find((e) => e.name === "link-to-dir")).toMatchObject({ type: "symlink", linkToDir: true });
    expect(entries.find((e) => e.name === "link-to-file")).toMatchObject({ type: "symlink", linkToDir: false });
    expect(entries.find((e) => e.name === "projects")!.type).toBe("dir");
  });

  it("builds paths correctly at the root and ignores malformed records", () => {
    const entries = parseFindOutput("d\td\t0\t0\tetc\0garbage\0", "/");
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/etc");
  });

  it("quotes the directory in the list command", () => {
    expect(listCommand("/home/user/my dir")).toContain("'/home/user/my dir'");
  });
});

describe("encoding helpers", () => {
  it("round-trips binary data through base64", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("splits a sentinel-terminated capture", () => {
    const enc = new TextEncoder();
    const data = enc.encode("hello\n__END_abc__:3\n");
    const parsed = splitSentinelCapture(data, "abc")!;
    expect(new TextDecoder().decode(parsed.stdout)).toBe("hello");
    expect(parsed.status).toBe(3);
    expect(splitSentinelCapture(enc.encode("partial output"), "abc")).toBeNull();
    // stdout that happens to contain a different sentinel is kept intact
    const tricky = splitSentinelCapture(enc.encode("x\n__END_zzz__:0\n\n__END_abc__:0\n"), "abc")!;
    expect(new TextDecoder().decode(tricky.stdout)).toBe("x\n__END_zzz__:0\n");
  });
});

describe.skipIf(!bashAvailable())("ShellFileSystem against a real shell", () => {
  let dir: string;
  const runner = new LocalBashRunner();
  // Tiny chunks force the multi-command chunked base64 upload path.
  const fs = new ShellFileSystem(runner, { chunkChars: 64 });

  beforeAll(() => {
    dir = makeTempDir();
  });
  afterAll(() => {
    bash(`rm -rf ${shellQuote(dir)}`);
  });

  it("writes, lists and reads text and binary files", async () => {
    await fs.write(`${dir}/hello.txt`, "hello world\n");
    const binary = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff);
    await fs.write(`${dir}/blob.bin`, binary);
    await fs.write(`${dir}/empty.txt`, "");

    const entries = await fs.list(dir);
    expect(entries.map((e) => e.name).sort()).toEqual(["blob.bin", "empty.txt", "hello.txt"]);
    expect(entries.find((e) => e.name === "blob.bin")!.size).toBe(1000);
    expect(new TextDecoder().decode(await fs.read(`${dir}/hello.txt`))).toBe("hello world\n");
    expect(await fs.read(`${dir}/blob.bin`)).toEqual(binary);
    expect((await fs.read(`${dir}/empty.txt`)).length).toBe(0);
    // 1000 bytes in 48-byte raw chunks => many separate commands
    expect(runner.scripts.filter((s) => s.includes("base64 -d")).length).toBeGreaterThan(10);
  });

  it("handles hostile file names without executing anything", async () => {
    // A Windows host (Git Bash on NTFS) cannot store "\" in a file name; Linux can.
    const hostCanStore = (n: string) => process.platform !== "win32" || !n.includes("\\");
    const names = NASTY.filter((n) => n && validateName(n) === null && hostCanStore(n));
    for (const name of names) await fs.write(`${dir}/${name}`, name);
    const listed = (await fs.list(dir)).map((e) => e.name);
    for (const name of names) {
      expect(listed).toContain(name);
      expect(new TextDecoder().decode(await fs.read(`${dir}/${name}`))).toBe(name);
    }
    expect(bash("test -e /tmp/pwned").status).not.toBe(0);
    for (const name of names) await fs.remove(`${dir}/${name}`);
    const after = (await fs.list(dir)).map((e) => e.name);
    for (const name of names) expect(after).not.toContain(name);
  });

  it("creates folders, renames, refuses to overwrite and removes recursively", async () => {
    await fs.mkdir(`${dir}/a/b/c`);
    await fs.write(`${dir}/a/b/c/deep.txt`, "deep");
    await fs.rename(`${dir}/a/b`, `${dir}/a/renamed`);
    expect((await fs.list(`${dir}/a`)).map((e) => e.name)).toEqual(["renamed"]);

    await fs.write(`${dir}/a/other.txt`, "x");
    await expect(fs.rename(`${dir}/a/other.txt`, `${dir}/a/renamed`)).rejects.toThrow(/already exists/);
    await expect(fs.rename(`${dir}/a`, `${dir}/a/renamed/inside`)).rejects.toThrow(/into itself/);

    await fs.remove(`${dir}/a`, { recursive: true });
    expect((await fs.list(dir)).map((e) => e.name)).not.toContain("a");
  });

  it("reports errors from the shell", async () => {
    await expect(fs.list(`${dir}/does-not-exist`)).rejects.toThrow(/No such file/);
    await expect(fs.read(`${dir}/nope.txt`)).rejects.toThrow();
  });

  it("archives a folder as tar.gz", async () => {
    await fs.mkdir(`${dir}/pack`);
    await fs.write(`${dir}/pack/a.txt`, "A");
    const tgz = await fs.archive(`${dir}/pack`);
    expect(tgz[0]).toBe(0x1f); // gzip magic
    expect(tgz[1]).toBe(0x8b);
  });
});

describe.skipIf(!bashAvailable())("SentinelCommandRunner over a stream", () => {
  it("frames stdout, stderr and status and ignores surrounding noise", async () => {
    const transport = bashTransport();
    transport.send("echo noise-before\n");
    const runner = new SentinelCommandRunner(transport, 15_000);
    try {
      const ok = await runner.exec("printf 'line1\\nline2\\n'; echo err >&2");
      expect(new TextDecoder().decode(ok.stdout)).toBe("line1\nline2\n");
      expect(ok.status).toBe(0);

      const fail = await runner.exec("echo boom >&2; exit 3");
      expect(fail.status).toBe(3);
      expect(fail.stderr.trim()).toBe("boom");

      // Binary output survives the text transport; queued calls run in order.
      const [a, b] = await Promise.all([runner.exec("printf '\\x00\\xff\\x01'"), runner.exec("echo second")]);
      expect(Array.from(a.stdout)).toEqual([0, 255, 1]);
      expect(new TextDecoder().decode(b.stdout)).toBe("second\n");

      // The whole file system works on top of it.
      const dir = makeTempDir();
      const fs = new ShellFileSystem(runner);
      await fs.write(`${dir}/x.txt`, "via serial");
      expect(new TextDecoder().decode(await fs.read(`${dir}/x.txt`))).toBe("via serial");
      await fs.remove(dir, { recursive: true });
    } finally {
      transport.close();
    }
  });
});
