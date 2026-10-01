/**
 * Preset environments. Each preset's workspace script (sample files, repos)
 * runs hidden, as the normal user, in the background once the prompt is up.
 * Every session starts from the pristine image, so scripts never need cleanup.
 */

export type PresetId = "linux-basics" | "git-playground" | "bash-scripting" | "blank";

export interface Preset {
  id: PresetId;
  title: string;
  tagline: string;
  /** Suggested first lesson for the sidebar. */
  lesson?: string;
  /** Sample files and repos; runs in the background once the prompt is up. */
  workspaceScript?: string;
}

/**
 * Sourced by the interactive shell right before its first prompt: friendly
 * prompt, aliases and a default git identity. Bash builtins only, so it adds
 * no process launches (each new binary costs seconds on a cold start).
 */
export const SHELL_RC = String.raw`
PS1='\[\e[1;32m\]\u@sandbox\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
alias ll='ls -alF --color=auto' la='ls -A --color=auto' ls='ls --color=auto' grep='grep --color=auto'
if [ ! -e "$HOME/.gitconfig" ]; then
  printf '[user]\n\tname = Learner\n\temail = learner@example.com\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n' > "$HOME/.gitconfig"
fi
unset PROMPT_COMMAND
`;

const LINUX_BASICS = String.raw`
mkdir -p practice/docs practice/logs practice/photos/2024 practice/photos/2025
cd practice
printf 'apple\nbanana\ncherry\napple\ndate\nbanana\napple\n' > fruits.txt
printf 'The quick brown fox\njumps over the lazy dog.\nhello from the sandbox\n' > docs/intro.txt
printf '# Notes\n\n- learn ls\n- learn grep\n' > docs/notes.md
for i in 1 2 3 4 5 6 7 8; do
  lvl=INFO; [ $((i % 3)) -eq 0 ] && lvl=ERROR; [ $((i % 4)) -eq 0 ] && lvl=WARN
  printf '2025-01-0%d 10:0%d:00 %s request %d handled\n' "$i" "$i" "$lvl" "$i"
done > logs/app.log
touch photos/2024/beach.jpg photos/2024/city.jpg photos/2025/forest.jpg
cat > "$HOME/WELCOME.txt" <<'TXT'
Linux basics workspace
----------------------
Explore ~/practice with ls, cd, cat, less, grep, wc, sort and uniq.
Open the Lessons tab for guided steps.
TXT
`;

const GIT_PLAYGROUND = String.raw`
git init -q --bare remote.git
git init -q git-playground
cd git-playground
git symbolic-ref HEAD refs/heads/main
printf '# Git playground\n\nA tiny project to practise git.\n' > README.md
git add README.md && git commit -q -m "Initial commit"
printf 'def greet(name):\n    return "Hello, " + name\n' > app.py
git add app.py && git commit -q -m "Add greet()"
git remote add origin "$HOME/remote.git"
git push -q -u origin main 2>/dev/null
git checkout -q -b feature/shout
printf '\ndef shout(name):\n    return greet(name).upper() + "!"\n' >> app.py
git commit -q -am "Add shout()"
git checkout -q main
cat > "$HOME/WELCOME.txt" <<'TXT'
Git playground
--------------
~/git-playground   a repo with history and a feature branch (feature/shout)
~/remote.git       a local bare repo used as "origin" (no internet needed)
Try: cd git-playground && git log --oneline --graph --all
TXT
`;

const BASH_SCRIPTING = String.raw`
mkdir -p scripts
cd scripts
cat > hello.sh <<'SH'
#!/bin/bash
# Usage: ./hello.sh [name]
name="${"$"}{1:-world}"
echo "Hello, $name!"
SH
cat > count.sh <<'SH'
#!/bin/bash
for i in $(seq 1 5); do
  echo "Line $i"
done
SH
printf 'name,language,stars\nalpha,python,42\nbeta,bash,7\ngamma,go,19\ndelta,bash,3\n' > data.csv
chmod +x hello.sh count.sh
cat > "$HOME/WELCOME.txt" <<'TXT'
Bash scripting workspace
------------------------
~/scripts has example scripts and a CSV to process.
Try: ./scripts/hello.sh you    and    nano scripts/count.sh
TXT
`;

export const PRESETS: Preset[] = [
  {
    id: "linux-basics",
    title: "Linux basics",
    tagline: "Files, folders, pipes and grep with a sample project",
    lesson: "navigating",
    workspaceScript: LINUX_BASICS,
  },
  {
    id: "git-playground",
    title: "Git playground",
    tagline: "A repo with history, a branch and a local remote",
    lesson: "git-basics",
    workspaceScript: GIT_PLAYGROUND,
  },
  {
    id: "bash-scripting",
    title: "Bash scripting",
    tagline: "Example scripts, loops and a CSV to crunch",
    lesson: "bash-scripting",
    workspaceScript: BASH_SCRIPTING,
  },
  {
    id: "blank",
    title: "Blank Debian",
    tagline: "Just a clean shell",
  },
];

export function getPreset(id: string | null | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
