/**
 * Built-in lessons. Step text supports `inline code` and **bold**.
 * `cmd` steps get a "Run in sandbox" button that types the command into the
 * terminal. `check` is run hidden in the VM; exit status 0 means done.
 */

export interface LessonStep {
  text: string;
  cmd?: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  steps: LessonStep[];
  task?: { goal: string; check: string };
}

export const LESSONS: Lesson[] = [
  {
    id: "navigating",
    title: "Navigating the filesystem",
    summary: "Where am I, what is here, and how do I move around?",
    steps: [
      { text: "`pwd` prints the directory you are in. Your home is `/home/user`, also written `~`.", cmd: "pwd" },
      { text: "`ls` lists files. `-l` shows details and `-a` includes hidden dotfiles.", cmd: "ls -la" },
      { text: "Move into a directory with `cd`. `cd ..` goes up one level and plain `cd` goes home.", cmd: "cd ~/practice && ls" },
      { text: "`tree` (or `find .`) shows everything below the current directory.", cmd: "find ~/practice | head -20" },
      { text: "Create a directory with `mkdir -p` and an empty file with `touch`.", cmd: "mkdir -p ~/projects && touch ~/projects/readme.txt" },
      { text: "Watch the **Files** panel: new files show up there too. Remove files with `rm` and folders with `rm -r`." },
    ],
    task: {
      goal: "Create the folder ~/projects containing a file named readme.txt.",
      check: 'test -d "$HOME/projects" && test -f "$HOME/projects/readme.txt"',
    },
  },
  {
    id: "grep-pipes",
    title: "grep and pipes",
    summary: "Search text and chain small tools together with |.",
    steps: [
      { text: "`cat` prints a file. `less` pages through long ones (press `q` to quit).", cmd: "cat ~/practice/fruits.txt" },
      { text: "`grep PATTERN FILE` prints matching lines. `-c` counts them and `-i` ignores case.", cmd: "grep ERROR ~/practice/logs/app.log" },
      { text: "A pipe `|` feeds one command's output into the next. Count how often each fruit appears:", cmd: "sort ~/practice/fruits.txt | uniq -c | sort -rn" },
      { text: "`>` writes output to a file (overwriting) and `>>` appends.", cmd: "echo hello > ~/notes.txt && cat ~/notes.txt" },
      { text: "`wc -l` counts lines. How many log lines are not INFO?", cmd: "grep -v INFO ~/practice/logs/app.log | wc -l" },
    ],
    task: {
      goal: "Create ~/notes.txt containing the word hello.",
      check: 'test -f "$HOME/notes.txt" && grep -q hello "$HOME/notes.txt"',
    },
  },
  {
    id: "git-basics",
    title: "git basics",
    summary: "Commits, branches, merges and a local remote, all offline.",
    steps: [
      { text: "Every git command runs inside a repository. Start a new one:", cmd: "mkdir -p ~/myrepo && cd ~/myrepo && git init" },
      { text: "Create a file, stage it with `git add`, then record it with `git commit`.", cmd: 'echo "# My repo" > README.md && git add README.md && git commit -m "First commit"' },
      { text: "Make a second commit so there is some history.", cmd: 'echo "More text" >> README.md && git commit -am "Second commit"' },
      { text: "`git log --oneline` shows the history, newest first.", cmd: "git log --oneline" },
      { text: "Branch off, commit, then merge back into the main branch.", cmd: "git switch -c idea 2>/dev/null || git checkout -b idea" },
      { text: "The Git playground preset has a bare repo at `~/remote.git` to practise `git push` and `git pull` without internet." },
    ],
    task: {
      goal: "Make at least two commits in ~/myrepo.",
      check: 'test "$(git -C "$HOME/myrepo" rev-list --count HEAD 2>/dev/null || echo 0)" -ge 2',
    },
  },
  {
    id: "bash-scripting",
    title: "Bash scripting",
    summary: "Turn commands into reusable scripts with variables and loops.",
    steps: [
      { text: "A script is a text file of commands. The first line `#!/bin/bash` says which interpreter runs it." },
      { text: "Create a script with a heredoc (or open it in the editor from the Files panel):", cmd: "printf '#!/bin/bash\\necho \"Hello from $USER\"\\n' > ~/hello.sh" },
      { text: "Make it executable with `chmod +x`, then run it with its path.", cmd: "chmod +x ~/hello.sh && ~/hello.sh" },
      { text: "Variables: `name=value` (no spaces), then use `$name`. Loops: `for x in a b c; do echo $x; done`.", cmd: "for n in 1 2 3; do echo \"Item $n\"; done" },
      { text: "Arguments arrive as `$1`, `$2`, … and `$#` holds their count. Try `~/scripts/hello.sh` in the Bash preset." },
    ],
    task: {
      goal: "Create an executable ~/hello.sh that prints Hello.",
      check: 'test -x "$HOME/hello.sh" && "$HOME/hello.sh" | grep -q Hello',
    },
  },
];

export interface CheatGroup {
  title: string;
  items: Array<[cmd: string, what: string]>;
}

export const CHEAT_SHEET: CheatGroup[] = [
  {
    title: "Navigate",
    items: [
      ["pwd", "print working directory"],
      ["ls -la", "list all files with details"],
      ["cd dir", "change directory (cd .. up, cd ~ home)"],
      ["find . -maxdepth 2", "everything two levels deep (tree -L 2 on the custom image)"],
    ],
  },
  {
    title: "Files",
    items: [
      ["cat file", "print a file"],
      ["less file", "page through a file (q quits)"],
      ["cp src dst", "copy (-r for folders)"],
      ["mv src dst", "move or rename"],
      ["rm file", "delete (-r for folders)"],
      ["mkdir -p a/b", "create nested folders"],
      ["nano file", "edit a file (Ctrl+O save, Ctrl+X exit)"],
    ],
  },
  {
    title: "Search and text",
    items: [
      ["grep -rn text .", "search recursively with line numbers"],
      ["find . -name '*.txt'", "find files by name"],
      ["sort | uniq -c", "count duplicate lines"],
      ["wc -l file", "count lines"],
      ["head -n 5 / tail -f", "start / end of a file"],
      ["sed 's/a/b/g' file", "replace text"],
      ["awk -F, '{print $1}'", "print a column"],
    ],
  },
  {
    title: "git",
    items: [
      ["git status", "what changed"],
      ["git add -A && git commit -m msg", "stage and commit"],
      ["git log --oneline --graph --all", "history as a graph"],
      ["git switch -c name", "create a branch"],
      ["git merge name", "merge a branch"],
      ["git diff", "unstaged changes"],
    ],
  },
  {
    title: "Processes",
    items: [
      ["ps aux", "running processes"],
      ["top", "live process view (q quits)"],
      ["cmd &", "run in background"],
      ["Ctrl+C", "stop the running command"],
      ["history", "previous commands"],
    ],
  },
];
