import { afterEach, describe, expect, it } from "vitest";
import { shellQuote } from "@/lib/fs-bridge";
import { PRESETS, SHELL_RC } from "@/lib/presets";
import { bash, bashAvailable, makeTempDir } from "./helpers";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) bash(`rm -rf ${shellQuote(home)}`);
});

function freshHome() {
  const home = makeTempDir();
  homes.push(home);
  return home;
}

describe.skipIf(!bashAvailable())("preset scripts in a real shell", () => {
  it("SHELL_RC sets the prompt, writes a git identity once and unsets itself", () => {
    const home = freshHome();
    const q = shellQuote(home);
    const rc = shellQuote(SHELL_RC);
    const r = bash(
      `export HOME=${q} PROMPT_COMMAND=x; eval ${rc}; printf '%s\\n' "$PS1"; echo "pc=\${PROMPT_COMMAND-unset}"; cat "$HOME/.gitconfig"; ` +
        // A second run must not overwrite a config the learner changed.
        `echo '[user] name = Me' > "$HOME/.gitconfig"; eval ${rc}; cat "$HOME/.gitconfig"`,
    );
    expect(r.status).toBe(0);
    const out = r.stdout.toString("utf8");
    expect(out).toContain("u@sandbox");
    expect(out).toContain("pc=unset");
    expect(out).toContain("name = Learner");
    expect(out.trim().endsWith("[user] name = Me")).toBe(true);
  });

  const expected: Record<string, string[]> = {
    "linux-basics": ["practice/fruits.txt", "practice/logs/app.log", "practice/docs/intro.txt", "WELCOME.txt"],
    "git-playground": ["git-playground/.git", "git-playground/app.py", "remote.git/HEAD", "WELCOME.txt"],
    "bash-scripting": ["scripts/hello.sh", "scripts/data.csv", "WELCOME.txt"],
  };

  for (const preset of PRESETS.filter((p) => p.workspaceScript)) {
    it(`${preset.id} workspace script creates its files`, () => {
      const home = freshHome();
      const q = shellQuote(home);
      // Same prefix the store uses; a git identity like SHELL_RC provides.
      // GIT_CONFIG_NOSYSTEM: ignore the host's system git config (autocrlf on Windows).
      const script = `export HOME=${q} GIT_CONFIG_NOSYSTEM=1; cd "$HOME" || exit 1\n${SHELL_RC}\n${preset.workspaceScript}`;
      const r = bash(script);
      expect(r.stderr.toString("utf8")).toBe("");
      expect(r.status).toBe(0);
      for (const rel of expected[preset.id] ?? []) {
        expect(bash(`test -e ${shellQuote(`${home}/${rel}`)}`).status, rel).toBe(0);
      }
      if (preset.id === "git-playground") {
        const log = bash(`GIT_CONFIG_NOSYSTEM=1 git -C ${shellQuote(`${home}/git-playground`)} log --oneline --all`).stdout.toString("utf8");
        expect(log.trim().split("\n")).toHaveLength(3);
      }
      if (preset.id === "bash-scripting") {
        const hello = bash(`${shellQuote(`${home}/scripts/hello.sh`)} you`).stdout.toString("utf8");
        expect(hello.trim()).toBe("Hello, you!");
      }
    });
  }
});
